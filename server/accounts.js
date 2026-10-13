import { Router } from "express";
import { z } from "zod";
import { AppError, verifyPassword } from "./security.js";
import { createPasswordHistory, changeDemoPassword } from './password-history.js';

export const strongPassword = z
  .string()
  .min(10, "Mật khẩu tối thiểu 10 ký tự.")
  .max(128)
  .regex(/[a-z]/, "Cần chữ thường.")
  .regex(/[A-Z]/, "Cần chữ hoa.")
  .regex(/[0-9]/, "Cần chữ số.");

// The token must already have been verified by Supabase.
export function isSocialSession(token) {
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url"));
    return claims.amr?.some((entry) => entry.method === "oauth") === true;
  } catch {
    return false;
  }
}
export function requirePasswordSession(req, res, next) {
  if (req.authToken && isSocialSession(req.authToken))
    return next(
      new AppError(
        "Bạn đăng nhập bằng Google hoặc Discord. Hãy quản lý mật khẩu tại nhà cung cấp đăng nhập.",
        403,
      ),
    );
  next();
}

export function accountRouter({
  operations,
  config,
  store,
  auth,
  limiter,
  makeAuthClient,
  setAuth,
  demoSession,
  passwordHistory = createPasswordHistory(store),
}) {
  const router = Router();
  router.get("/me/password-policy", auth, (req, res) =>
    res.json({ locked: !!req.authToken && isSocialSession(req.authToken) }),
  );
  router.post(
    "/me/password",
    auth,
    requirePasswordSession,
    limiter(5, 15 * 60000),
    async (req, res) => {
      const input = z
        .object({
          current_password: z.string().min(1).max(128),
          password: strongPassword,
          password_confirmation: z.string().max(128),
        })
        .strict()
        .refine(
          (v) => v.password === v.password_confirmation,
          "Mật khẩu nhập lại chưa khớp.",
        )
        .refine(
          (v) => v.password !== v.current_password,
          "Mật khẩu mới phải khác mật khẩu hiện tại.",
        )
        .parse(req.body);
      if (config.mode === "demo") {
        const user = store.db.users.find((u) => u.id === req.user.id);
        if (
          !user ||
          !verifyPassword(input.current_password, user.password_hash)
        )
          throw new AppError("Mật khẩu hiện tại không đúng.", 400);
        changeDemoPassword(user, input.password);
        store.db.sessions = store.db.sessions.filter(
          (s) => s.user_id !== user.id,
        );
        // Saves the new hash and replacement session together in one snapshot.
        demoSession(res, user.id);
      } else {
        // A stolen session alone must not be sufficient to change the password.
        const client = makeAuthClient({ timeoutMs: 15000 });
        const { data, error } = await client.auth.signInWithPassword({
          email: req.user.email,
          password: input.current_password,
        });
        if (error || !data.session || data.user?.id !== req.user.id)
          throw new AppError("Không thể xác minh mật khẩu hiện tại.", 400);
        let updated;
        try {
          updated = await passwordHistory.change(req.user.id, input.password, () => client.auth.updateUser({ password: input.password }));
        } catch (error) {
          await client.auth.signOut({ scope: 'local' });
          throw error;
        }
        if (updated.error) {
          await client.auth.signOut({ scope: "local" });
          throw new AppError(
            "Không thể đổi mật khẩu. Hãy thử lại hoặc dùng email khôi phục.",
            400,
          );
        }
        await operations?.revoke(req.user.id);
        setAuth(res, data.session);
      }
      res.json({ message: "Đã cập nhật mật khẩu." });
    },
  );
  return router;
}
