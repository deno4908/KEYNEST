import { createHmac, randomUUID } from "node:crypto";
import { AppError, decrypt, digest, encrypt, opaque } from "./security.js";
import { createPasswordHistory } from './password-history.js';

const INVALID_LINK =
  "Liên kết đã hết hạn hoặc không hợp lệ. Hãy yêu cầu email khôi phục mới.";
const STORAGE_ERROR =
  "Không thể xác minh liên kết lúc này. Vui lòng thử lại sau.";

function emailHash(email, key) {
  return createHmac("sha256", Buffer.from(key, "hex"))
    .update(email.trim().toLowerCase())
    .digest("hex");
}

export function createSupabaseRecoveryRepository(store) {
  const table = (name) => store.client.from(name);
  return {
    async reserveSend(hash, recoveryId) {
      const { data, error } = await store.client.rpc('reserve_password_recovery', {
        p_email_hash: hash, p_recovery_id: recoveryId,
      });
      if (error) throw new AppError(STORAGE_ERROR, 503);
      if (!data) throw new AppError('Vui lòng chờ 90 giây trước khi yêu cầu email mới.', 429);
    },
    async finishSend(hash, recoveryId, sent) {
      const { data, error } = await store.client.rpc('finish_password_recovery', {
        p_email_hash: hash, p_recovery_id: recoveryId, p_sent: sent,
      });
      if (error || !data) throw new AppError(STORAGE_ERROR, 503);
    },
    async findLink({ emailHash: hash, recoveryId, now }) {
      const { data, error } = await table("password_recovery_links")
        .select("expires_at")
        .eq("email_hash", hash)
        .eq("recovery_id", recoveryId)
        .is("consumed_at", null)
        .gt("expires_at", now)
        .maybeSingle();
      if (error) throw new AppError(STORAGE_ERROR, 503);
      return data;
    },

    async createTicket(ticket) {
      const { data, error } = await store.client.rpc('redeem_password_recovery', { p_ticket: ticket });
      if (error) throw new AppError(STORAGE_ERROR, 503);
      if (!data) throw new AppError(INVALID_LINK, 401);
    },

    async inspectTicket(ticketHash) {
      const { data, error } = await store.client.rpc('inspect_password_recovery_reset', { p_ticket_hash: ticketHash });
      if (error) throw new AppError(STORAGE_ERROR, 503);
      return Array.isArray(data) ? data[0] || null : data || null;
    },

    async claimTicket(ticketHash, now) {
      const { data, error } = await store.client.rpc(
        "claim_password_recovery_reset",
        { p_ticket_hash: ticketHash, p_now: now },
      );
      if (error) throw new AppError(STORAGE_ERROR, 503);
      return Array.isArray(data) ? data[0] || null : data || null;
    },
  };
}

export function createPasswordRecovery({
  config,
  makeAuthClient,
  store,
  repository = createSupabaseRecoveryRepository(store),
  clock = () => Date.now(),
  logger = console,
  passwordHistory = createPasswordHistory(store),
}) {
  return {
    async request(email) {
      email = email.trim().toLowerCase();
      const recoveryId = randomUUID();
      const hash = emailHash(email, config.encryption);
      try {
        await repository.reserveSend(hash, recoveryId);
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(STORAGE_ERROR, 503);
      }

      const redirectTo = new URL("/reset-password", config.origin);
      redirectTo.searchParams.set("recovery_id", recoveryId);
      let error;
      try {
        ({ error } = await makeAuthClient().auth.resetPasswordForEmail(
          email, { redirectTo: redirectTo.toString() },
        ));
      } catch (failure) { error = failure; }
      if (error) {
        await repository.finishSend(hash, recoveryId, false);
        const message = String(error.message || "").replace(
          /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
          "[redacted email]",
        );
        logger.error?.("Supabase recovery email failed:", {
          code: error.code || "unknown",
          status: error.status || 0,
          message: message.slice(0, 500),
        });
        throw new AppError(
          "Chưa thể gửi email đặt lại mật khẩu. Vui lòng thử lại sau.",
          502,
        );
      }
      await repository.finishSend(hash, recoveryId, true);
    },

    async redeem(input) {
      const client = makeAuthClient({ timeoutMs: 15000 });
      const { data, error } = await client.auth.verifyOtp({
        token_hash: input.token_hash,
        type: "recovery",
      });
      if (error || !data?.user?.email || !data?.session) {
        logger.warn?.('Password recovery rejected', { stage: 'provider', code: error?.code || 'missing_session', status: error?.status || 0 });
        if (error && (!error.status || error.status >= 500)) throw new AppError(STORAGE_ERROR, 503);
        throw new AppError(INVALID_LINK, 401);
      }

      const nowMs = clock();
      const now = new Date(nowMs).toISOString();
      let link;
      try {
        link = await repository.findLink({
          emailHash: emailHash(data.user.email, config.encryption),
          recoveryId: input.recovery_id,
          now,
        });
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(STORAGE_ERROR, 503);
      }
      if (!link?.expires_at || Date.parse(link.expires_at) <= nowMs) {
        logger.warn?.('Password recovery rejected', { stage: 'generation' });
        throw new AppError(INVALID_LINK, 401);
      }

      const ticket = opaque();
      try {
        await repository.createTicket({
          ticket_hash: digest(ticket),
          email_hash: emailHash(data.user.email, config.encryption),
          recovery_id: input.recovery_id,
          user_id: data.user.id,
          encrypted_session: encrypt(
            JSON.stringify(data.session),
            config.encryption,
          ),
          expires_at: link.expires_at,
        });
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(STORAGE_ERROR, 503);
      }
      return { ticket };
    },

    async complete(input) {
      const pending = await repository.inspectTicket(digest(input.ticket));
      if (!pending?.user_id) throw new AppError(INVALID_LINK, 401);
      return passwordHistory.change(pending.user_id, input.password, async () => {
        const now = new Date(clock()).toISOString();
        let claimed;
        try {
          claimed = await repository.claimTicket(digest(input.ticket), now);
        } catch (error) {
          if (error instanceof AppError) throw error;
          throw new AppError(STORAGE_ERROR, 503);
        }
        if (!claimed?.user_id || claimed.user_id !== pending.user_id || !claimed?.encrypted_session)
          throw new AppError(INVALID_LINK, 401);

        let session;
        try {
          session = JSON.parse(
            decrypt(claimed.encrypted_session, config.encryption),
          );
        } catch {
          throw new AppError(STORAGE_ERROR, 503);
        }

        const client = makeAuthClient({ timeoutMs: 15000 });
        const restored = await client.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        });
        if (restored.error || !restored.data?.session)
          throw new AppError(INVALID_LINK, 401);

        const updated = await client.auth.updateUser({
          password: input.password,
        });
        if (updated.error)
          throw new AppError(
            "Không thể đặt mật khẩu mới. Vui lòng yêu cầu liên kết khôi phục mới.",
            400,
          );
        return restored.data.session;
      });
    },
  };
}
