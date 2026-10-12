import { createHmac, randomUUID } from "node:crypto";
import { AppError, decrypt, digest, encrypt, opaque } from "./security.js";

const MAX_RECOVERY_AGE_MS = 10 * 60 * 1000;
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
    async issueLink({ emailHash: hash, recoveryId, expiresAt }) {
      const expiredBefore = new Date(
        Date.parse(expiresAt) - MAX_RECOVERY_AGE_MS,
      ).toISOString();
      const { error: cleanupError } = await table("password_recovery_links")
        .delete()
        .lt("expires_at", expiredBefore);
      if (cleanupError) throw new AppError(STORAGE_ERROR, 503);
      const { error } = await table("password_recovery_links").upsert(
        {
          email_hash: hash,
          recovery_id: recoveryId,
          expires_at: expiresAt,
          consumed_at: null,
        },
        { onConflict: "email_hash" },
      );
      if (error) throw new AppError(STORAGE_ERROR, 503);
    },

    async consumeLink({ emailHash: hash, recoveryId, now }) {
      const { data, error } = await table("password_recovery_links")
        .update({ consumed_at: now })
        .eq("email_hash", hash)
        .eq("recovery_id", recoveryId)
        .is("consumed_at", null)
        .gt("expires_at", now)
        .select("expires_at")
        .maybeSingle();
      if (error) throw new AppError(STORAGE_ERROR, 503);
      return data;
    },

    async createTicket(ticket) {
      const { error } = await table("password_recovery_tickets").insert(ticket);
      if (error) throw new AppError(STORAGE_ERROR, 503);
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
}) {
  return {
    async request(email) {
      const now = clock();
      const recoveryId = randomUUID();
      const expiresAt = new Date(now + MAX_RECOVERY_AGE_MS).toISOString();
      try {
        await repository.issueLink({
          emailHash: emailHash(email, config.encryption),
          recoveryId,
          expiresAt,
        });
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(STORAGE_ERROR, 503);
      }

      const redirectTo = new URL("/reset-password", config.origin);
      redirectTo.searchParams.set("recovery_id", recoveryId);
      const { error } = await makeAuthClient().auth.resetPasswordForEmail(
        email,
        { redirectTo: redirectTo.toString() },
      );
      if (error) {
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
    },

    async redeem(input) {
      const client = makeAuthClient();
      const { data, error } = await client.auth.verifyOtp({
        token_hash: input.token_hash,
        type: "recovery",
      });
      if (error || !data?.user?.email || !data?.session)
        throw new AppError(INVALID_LINK, 401);

      const nowMs = clock();
      const now = new Date(nowMs).toISOString();
      let link;
      try {
        link = await repository.consumeLink({
          emailHash: emailHash(data.user.email, config.encryption),
          recoveryId: input.recovery_id,
          now,
        });
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(STORAGE_ERROR, 503);
      }
      if (!link?.expires_at || Date.parse(link.expires_at) <= nowMs)
        throw new AppError(INVALID_LINK, 401);

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
      const now = new Date(clock()).toISOString();
      let claimed;
      try {
        claimed = await repository.claimTicket(digest(input.ticket), now);
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(STORAGE_ERROR, 503);
      }
      if (!claimed?.user_id || !claimed?.encrypted_session)
        throw new AppError(INVALID_LINK, 401);

      let session;
      try {
        session = JSON.parse(
          decrypt(claimed.encrypted_session, config.encryption),
        );
      } catch {
        throw new AppError(STORAGE_ERROR, 503);
      }

      const client = makeAuthClient();
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
    },
  };
}
