import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { AppError, encrypt, decrypt } from "./security.js";

// Supabase manages provider state. S256 PKCE binds the returned code to the
// browser that started login; the verifier never leaves an HttpOnly cookie.
export function createOAuthRouter({ config, store, setAuth, fetcher = fetch }) {
  const router = Router();
  const cookieName = "kn_oauth";
  const cookieOptions = {
    httpOnly: true,
    secure: config.production,
    sameSite: "lax",
    path: "/api/auth/oauth",
    maxAge: 10 * 60000,
  };
  const encryptionKey = () =>
    createHash("sha256")
      .update(Buffer.from(config.encryption, "hex"))
      .update("keynest/oauth/v1")
      .digest("hex");
  const transactionSchema = z.object({
    verifier: z.string().regex(/^[a-zA-Z0-9_-]{43,128}$/),
    provider: z.enum(["google", "discord"]),
    expires: z.number().int(),
  });
  router.post("/:provider", async (req, res) => {
    const provider = z.enum(["google", "discord"]).parse(req.params.provider);
    if (config.mode !== "supabase")
      throw new AppError(
        "Đăng nhập Google và Discord chưa khả dụng trong bản demo. Bạn có thể dùng email hoặc tài khoản mẫu.",
        503,
      );
    if (!config.oauthProviders[provider])
      throw new AppError(
        `Cửa hàng chưa bật đăng nhập ${provider === "google" ? "Google" : "Discord"}. Vui lòng dùng email.`,
        503,
      );
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorize = new URL("/auth/v1/authorize", config.url);
    authorize.search = new URLSearchParams({
      provider,
      redirect_to: `${config.origin}/api/auth/oauth/callback`,
      code_challenge: challenge,
      code_challenge_method: "s256",
      ...(provider === "google"
        ? { access_type: "online" }
        : { scopes: "identify email" }),
    }).toString();
    res.cookie(
      cookieName,
      encrypt(
        JSON.stringify({
          verifier,
          provider,
          expires: Date.now() + 10 * 60000,
        }),
        encryptionKey(),
      ),
      cookieOptions,
    );
    res.json({ url: authorize.toString() });
  });
  router.get("/callback", async (req, res) => {
    res.setHeader("Referrer-Policy", "no-referrer");
    res.clearCookie(cookieName, { ...cookieOptions, maxAge: undefined });
    const failure = () => res.redirect(303, `${config.origin}/auth/error`);
    if (config.mode !== "supabase") return failure();
    try {
      if (
        req.query.error ||
        typeof req.query.code !== "string" ||
        req.query.code.length > 2048 ||
        !req.query.code ||
        !req.cookies[cookieName]
      )
        return failure();
      const transaction = transactionSchema.parse(
        JSON.parse(decrypt(req.cookies[cookieName], encryptionKey())),
      );
      if (
        transaction.expires < Date.now() ||
        !config.oauthProviders[transaction.provider]
      )
        return failure();
      const response = await fetcher(
        new URL("/auth/v1/token?grant_type=pkce", config.url),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: config.anon },
          body: JSON.stringify({
            auth_code: req.query.code,
            code_verifier: transaction.verifier,
          }),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) return failure();
      const session = z
        .object({
          access_token: z.string().min(1),
          refresh_token: z.string().min(1),
          user: z.object({ id: z.uuid() }),
        })
        .parse(await response.json());
      const profile = await store.profile(session.user.id);
      if (!profile) return failure();
      setAuth(res, session);
      return res.redirect(303, `${config.origin}/account`);
    } catch {
      // Never echo provider errors, codes or tokens into logs or redirect URLs.
      return failure();
    }
  });
  return router;
}
