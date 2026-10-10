import { Router } from "express";
import { z } from "zod";
import { AppError } from "./security.js";

// Only call with a token already validated by Supabase getUser/signIn.
export function needsMfa(user, token) {
  if (!user.factors?.some((f) => f.status === "verified")) return false;
  try {
    return (
      JSON.parse(Buffer.from(token.split(".")[1], "base64url")).aal !== "aal2"
    );
  } catch {
    return true;
  }
}
export function mfaRouter({ config, auth, limiter, setAuth, fetcher = fetch }) {
  const router = Router();
  router.use(auth, (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (config.mode !== "supabase")
      return next(new AppError("2FA cần kết nối Supabase Auth.", 400));
    next();
  });
  const factors = (req) => req.authUser.factors || [];
  async function call(req, path, body, method = "POST", token = req.authToken) {
    const response = await fetcher(
      new URL(`/auth/v1/factors${path}`, config.url),
      {
        method,
        headers: {
          apikey: config.anon,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok)
      throw new AppError(
        "Không thể xác thực 2FA. Kiểm tra mã và thử lại; nếu mã vừa dùng, chờ mã mới.",
        400,
      );
    return response.status === 204 ? {} : response.json();
  }
  router.get("/status", (req, res) =>
    res.json({
      required: needsMfa(req.authUser, req.authToken),
      factors: factors(req)
        .filter((f) => f.status === "verified" && f.factor_type === "totp")
        .map((f) => ({ id: f.id, name: f.friendly_name || "Authenticator" })),
    }),
  );
  router.post(
    "/enroll",
    limiter(5, 15 * 60000, "mfa-enroll"),
    async (req, res) => {
      if (needsMfa(req.authUser, req.authToken))
        throw new AppError("Xác minh 2FA trước khi thêm thiết bị.", 403);
      // Remove abandoned, unverified TOTP registrations only.
      for (const f of factors(req).filter(
        (f) => f.status === "unverified" && f.factor_type === "totp",
      ))
        await call(req, `/${f.id}`, null, "DELETE");
      const data = await call(req, "", {
        factor_type: "totp",
        issuer: "KEYNEST",
        friendly_name: `KEYNEST ${Date.now()}`,
      });
      res.json({
        id: data.id,
        secret: data.totp.secret,
        qr: data.totp.qr_code,
      });
    },
  );
  router.post(
    "/verify",
    limiter(10, 15 * 60000, "mfa-verify"),
    async (req, res) => {
      const input = z
        .object({
          factor_id: z.uuid(),
          code: z.string().regex(/^\d{6}$/),
          remove: z.boolean().optional(),
        })
        .strict()
        .parse(req.body);
      const factor = factors(req).find(
        (f) => f.id === input.factor_id && f.factor_type === "totp",
      );
      if (
        !factor ||
        (input.remove && factor.status !== "verified") ||
        (needsMfa(req.authUser, req.authToken) && factor.status !== "verified")
      )
        throw new AppError("Thiết bị xác thực không hợp lệ.", 403);
      const challenge = await call(req, `/${factor.id}/challenge`, {});
      const session = await call(req, `/${factor.id}/verify`, {
        challenge_id: challenge.id,
        code: input.code,
      });
      if (!session.access_token || !session.refresh_token)
        throw new AppError("Không thể tạo phiên xác thực.", 502);
      if (input.remove)
        await call(req, `/${factor.id}`, null, "DELETE", session.access_token);
      setAuth(res, session);
      res.json({ success: true });
    },
  );
  return router;
}
