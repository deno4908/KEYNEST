import { AppError } from "./security.js";

export function createPasswordRecovery({
  config,
  makeAuthClient,
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
      const { data, error } = await client.auth.verifyOtp({
        token_hash: input.token_hash,
        type: "recovery",
      });
      if (error || !data?.user || !data?.session)
        throw new AppError("Liên kết đã hết hạn hoặc không hợp lệ.", 401);

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
