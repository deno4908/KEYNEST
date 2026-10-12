import { AppError } from "./security.js";

const MAX_RECOVERY_AGE_MS = 60 * 60 * 1000;

export function createPasswordRecovery({
  config,
  makeAuthClient,
  clock = () => Date.now(),
  logger = console,
}) {
  return {
    async request(email) {
      const { error } = await makeAuthClient().auth.resetPasswordForEmail(
        email,
        {
          redirectTo: `${config.origin}/reset-password`,
        },
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

    async complete(input) {
      const client = makeAuthClient();
      const result = input.token_hash
        ? await client.auth.verifyOtp({
            token_hash: input.token_hash,
            type: "recovery",
          })
        : await client.auth.setSession({
            access_token: input.access_token,
            refresh_token: input.refresh_token,
          });
      const { data, error } = result;
      if (error || !data?.user || !data?.session)
        throw new AppError("Liên kết đã hết hạn hoặc không hợp lệ.", 401);

      const recoverySentAt = Date.parse(data.user.recovery_sent_at || "");
      const age = clock() - recoverySentAt;
      if (
        !Number.isFinite(recoverySentAt) ||
        age < 0 ||
        age > MAX_RECOVERY_AGE_MS
      )
        throw new AppError("Liên kết đặt lại mật khẩu không hợp lệ.", 401);

      const updated = await client.auth.updateUser({
        password: input.password,
      });
      if (updated.error)
        throw new AppError(
          "Không thể đặt mật khẩu mới. Vui lòng thử lại.",
          400,
        );
      return data.session;
    },
  };
}
