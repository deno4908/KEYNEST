import { Router } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError, encrypt, decrypt } from "./security.js";
import { sessionMaxAge } from './bearer.js';

export function createAdminOtp({
  config,
  makeAuthClient,
  clock = () => Date.now(),
}) {
  const proofName = "kn_admin_verified",
    challengeName = "kn_admin_challenge";
  const options = {
    httpOnly: true,
    secure: config.production,
    sameSite: "strict",
    path: "/api",
  };
  // Bind ciphertext to its purpose: a send receipt is not verification proof.
  // v2 also invalidates old cookies that did not make this distinction.
  const key = (name) =>
    createHash("sha256")
      .update(config.encryption)
      .update("admin-email-otp-v2:")
      .update(name)
      .digest("hex");
  // req.authToken has already passed Supabase getUser verification.
  function identity(req) {
    const claims = JSON.parse(
      Buffer.from(req.authToken.split(".")[1], "base64url"),
    );
    if (!claims.session_id || claims.sub !== req.user.id || !req.authUser.email)
      throw new AppError("Phiên đăng nhập không hợp lệ.", 401);
    return {
      uid: req.user.id,
      sid: claims.session_id,
      email: req.authUser.email,
    };
  }
  function read(req, name) {
    try {
      if (
        !/^[a-f0-9]{24}:(?:[a-f0-9]{2})+:[a-f0-9]{32}$/.test(
          req.cookies[name] || "",
        )
      )
        return null;
      const value = JSON.parse(decrypt(req.cookies[name], key(name)));
      const own = identity(req);
      return value.uid === own.uid &&
        value.sid === own.sid &&
        value.email === own.email &&
        value.expires > clock()
        ? value
        : null;
    } catch {
      return null;
    }
  }
  const verified = (req) => !!read(req, proofName);
  function writeProof(res, own) {
    res.cookie(proofName, encrypt(JSON.stringify({ ...own, expires: clock() + sessionMaxAge }), key(proofName)),
      { ...options, maxAge: sessionMaxAge });
  }
  // Renew only an existing proof for the very same server-validated session.
  // Reloads/token rotation must not create another email challenge. A fresh
  // login (different session_id), logout or revoked session still requires OTP.
  function renew(req, res) {
    if (req.user?.role !== 'admin' || !verified(req)) return false;
    writeProof(res, identity(req));
    return true;
  }
  function clear(res) {
    res.clearCookie(proofName, options);
    res.clearCookie(challengeName, options);
  }
  function guard(req, res, next) {
    if (
      config.mode !== "supabase" ||
      req.user.role !== "admin" ||
      verified(req)
    )
      return next();
    const path = req.originalUrl.split("?")[0];
    if (
      [
        "/api/auth/admin-otp/status",
        "/api/auth/admin-otp/send",
        "/api/auth/admin-otp/verify",
        "/api/auth/mfa/status",
        "/api/auth/mfa/verify",
      ].includes(path)
    )
      return next();
    return res.status(403).json({
      error: "Admin cần xác minh OTP qua email.",
      code: "ADMIN_OTP_REQUIRED",
    });
  }
  function router({ auth, limiter }) {
    const r = Router();
    r.use(auth, (req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      if (config.mode !== "supabase")
        return next(new AppError("OTP email admin cần Supabase Auth.", 400));
      if (req.user.role !== "admin")
        return next(new AppError("Không có quyền quản trị.", 403));
      next();
    });
    r.get("/status", (req, res) => {
      const email = identity(req).email;
      const at = email.lastIndexOf("@");
      const challenge = read(req, challengeName);
      res.json({
        verified: verified(req),
        email: email.slice(0, 1) + "***" + email.slice(at),
        sent: !!challenge,
        retry_after: challenge
          ? Math.max(0, Math.ceil((challenge.sent + 60000 - clock()) / 1000))
          : 0,
      });
    });
    r.post(
      "/send",
      limiter(5, 15 * 60000, "admin-otp-send"),
      async (req, res) => {
        const previous = read(req, challengeName);
        if (previous && previous.sent + 60000 > clock())
          throw new AppError("Chờ 60 giây giữa hai lần gửi mã.", 429);
        const own = identity(req);
        const { error } = await makeAuthClient().auth.signInWithOtp({
          email: own.email,
          options: { shouldCreateUser: false },
        });
        if (error)
          throw new AppError(
            "Chưa gửi được OTP. Kiểm tra cấu hình email Supabase hoặc thử lại sau.",
            503,
          );
        res.cookie(
          challengeName,
          encrypt(
            JSON.stringify({
              ...own,
              sent: clock(),
              expires: clock() + 10 * 60000,
            }),
            key(challengeName),
          ),
          { ...options, maxAge: 10 * 60000 },
        );
        res.json({ sent: true, retry_after: 60 });
      },
    );
    r.post(
      "/verify",
      limiter(10, 15 * 60000, "admin-otp-verify"),
      async (req, res) => {
        const { code } = z
          .object({ code: z.string().regex(/^\d{6,10}$/) })
          .strict()
          .parse(req.body);
        if (!read(req, challengeName))
          throw new AppError("Hãy gửi mã mới từ phiên đăng nhập này.", 400);
        const own = identity(req);
        const client = makeAuthClient();
        const { data, error } = await client.auth.verifyOtp({
          email: own.email,
          token: code,
          type: "email",
        });
        if (error || !data.user || !data.session || data.user.id !== own.uid)
          throw new AppError(
            "Mã OTP không đúng, đã sử dụng hoặc hết hạn.",
            400,
          );
        // Email verification creates a temporary session. Keep the original
        // session (including OAuth method/AAL2) and revoke the temporary one.
        const revoked = await client.auth.signOut({ scope: "local" });
        if (revoked.error)
          throw new AppError(
            "Chưa hoàn tất xác minh. Vui lòng gửi lại mã.",
            503,
          );
        writeProof(res, own);
        res.clearCookie(challengeName, options);
        res.json({ verified: true });
      },
    );
    return r;
  }
  return { guard, verified, router, clear, renew };
}
