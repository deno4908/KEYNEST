import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { z, ZodError } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { socialMetadata, metadataHead, injectMetadata } from './social-preview.js';
import { injectPublicInformation } from './public-information.js';
import { resolve } from "node:path";
import { config } from "./config.js";
import { createOAuthRouter } from "./oauth.js";
import { mfaRouter, needsMfa } from "./mfa.js";
import { createAdminOtp } from "./admin-otp.js";
import { createReceiptWorker } from './order-receipts.js';
import { createPaymentRouting } from './payment-routing.js';
import { sellersRouter } from './sellers.js';
import { requirePasswordSession } from "./accounts.js";
import { createPasswordRecovery } from "./password-recovery.js";
import { createPasswordTransport } from './password-transport.js';
import { createSupabaseNonceStore } from './request-nonces.js';
import { apiAccessGuard } from './api-access.js';
import { registerSupabase } from "./registration.js";
import { bearerToken, verifyBearer, sendSession } from "./bearer.js";
import { captchaGuard } from './captcha.js';
import { accountRouter, strongPassword } from "./accounts.js";
import { catalogQuery } from "./catalog.js";
import { createSteamArt } from './steam-art.js';
import { categoryId, createCategories, categoriesRouter } from './categories.js';
import { deleteAdminRecord } from './admin-deletion.js';
import { createOperations, operationsRouter } from "./operations.js";
import { createBankPayments } from "./bank-payments.js";
import { createPay2SRouter } from "./pay2s.js";
import {
  infrastructureConfig,
  createInfrastructure,
  createPaymentIngress,
} from "./infrastructure.js";
import { productImages } from "../shared/product-images.js";
import { warrantyInfo } from "./warranty.js";
import { isStoreImage, mediaRouter } from "./media.js";
import { DemoStore } from "./demo-store.js";
import { SupabaseStore, makeAuthClient } from "./supabase-store.js";
import {
  AppError,
  digest,
  opaque,
  requireOrigin,
  safeEqual,
  verifyPassword,
} from "./security.js";

export const store =
  config.mode === "demo"
    ? new DemoStore(
        config.encryption,
        process.env.DEMO_DATA_PATH || ".data/demo.json",
      )
    : new SupabaseStore();
if (config.mode === 'supabase') {
  // Do not pass deployment health checks with an incompatible payment schema.
  const { error } = await store.client.from('payment_routes').select('payment_id,qr_kind').limit(0)
    .abortSignal(AbortSignal.timeout(10000));
  if (error) throw new Error('Không truy cập được payment_routes/qr_kind. Kiểm tra kết nối Supabase và áp dụng migration 037, 038 theo đúng thứ tự trước khi triển khai.');
}
export const bankPayments = createBankPayments({
  config,
  store,
});
const paymentRouting = createPaymentRouting({store,config});
const infraConfig = infrastructureConfig();
export const infrastructure = await createInfrastructure(infraConfig);
const paymentIngress = createPaymentIngress({
  config,
  bankPayments,
  producer: infrastructure.producer,
  topic: infraConfig.topic,
});
export const operations = createOperations(store);
const categoryStore = createCategories(store);
export const app = express();
app.disable("x-powered-by");
if (config.trustProxy) app.set("trust proxy", config.trustProxy);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", ...(config.captcha.enabled ? ['https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/'] : [])],
        frameSrc: ["'self'", ...(config.captcha.enabled ? ['https://www.google.com/recaptcha/', 'https://recaptcha.google.com/recaptcha/'] : [])],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: [
          "'self'",
          "data:",
          "blob:",
          "https://shared.fastly.steamstatic.com",
          "https://vietqr.app",
          "https://*.googleusercontent.com",
          "https://cdn.discordapp.com",
          "https://media.discordapp.net",
        ],
        connectSrc: ["'self'", ...(config.captcha.enabled ? ['https://www.google.com/recaptcha/'] : [])],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        ...(config.production ? {} : { upgradeInsecureRequests: null }),
      },
    },
  }),
);
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
let limiterNumber = 0;
const limiter = (limit, windowMs = 60000, scope = `route-${limiterNumber++}`) =>
  rateLimit({
    store: infrastructure.rateStore(scope),
    passOnStoreError: false,
    // Only auth middleware may set req.user; never trust a client-supplied ID.
    keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : `ip:${ipKeyGenerator(req.ip || 'unknown')}`,
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req, res) => {
      const retryAfter = Math.max(
        1,
        Math.ceil(
          ((req.rateLimit.resetTime?.getTime() || Date.now() + windowMs) -
            Date.now()) /
            1000,
        ),
      );
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        error: `Bạn thao tác quá nhanh. Vui lòng thử lại sau ${retryAfter < 60 ? `${retryAfter} giây` : `${Math.ceil(retryAfter / 60)} phút`}.`,
        code: "RATE_LIMITED",
        retry_after: retryAfter,
      });
    },
  });
const generalLimit = limiter(240, 60000, "general");
const webhookLimit = limiter(6000, 60000, "webhooks");
const sessionControlLimit = limiter(60, 60000, "session-control");
app.use("/api", (req, res, next) => {
  // Keep session status/logout available when ordinary API traffic is limited.
  if (
    (req.method === "GET" && req.path === "/auth/mfa/status") ||
    (req.method === "POST" && ["/auth/logout", "/auth/refresh"].includes(req.path))
  ) {
    return sessionControlLimit(req, res, next);
  }
  return ["/webhooks/pay2s", "/webhooks/sepay"].includes(req.path)
    ? webhookLimit(req, res, next)
    : generalLimit(req, res, next);
});
const loginLimit = limiter(20, 15 * 60000, "auth-login");
app.use("/api/auth", (req, res, next) => {
  // MFA reads must not consume the password/OAuth login budget. MFA writes
  // have their own limits; logout must remain available to a blocked session.
  if (
    (req.method === "GET" &&
      ["/mfa/status", "/admin-otp/status", "/password-key"].includes(req.path)) ||
    (req.method === "POST" &&
      [
        "/mfa/enroll",
        "/mfa/verify",
        "/admin-otp/send",
        "/admin-otp/verify",
        "/logout",
        "/refresh",
      ].includes(req.path))
  )
    return next();
  return loginLimit(req, res, next);
});
app.use("/api", (req, res, next) => {
  try {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !["/webhooks/sepay", "/webhooks/pay2s"].includes(req.path)
    )
      requireOrigin(
        req.headers.origin,
        config.origin,
        req.headers["x-app-request"],
      );
    next();
  } catch (e) {
    next(e);
  }
});
app.use("/api", createPay2SRouter({ config, bankPayments, paymentIngress }));
const cookieOpts = {
  httpOnly: true,
  secure: config.production,
  sameSite: "lax",
  path: "/api",
  maxAge: 7 * 86400000,
};
function setAuth(res, s) {
  sendSession(res, s, cookieOpts);
}
const verifyCaptcha = captchaGuard(config.captcha);
app.post(['/api/auth/login', '/api/auth/register', '/api/auth/forgot'], verifyCaptcha);
const passwordTransport = createPasswordTransport(config.encryption, undefined, {
  ...(config.mode === 'supabase' ? { nonceStore: createSupabaseNonceStore(store), requireEncrypted: true } : {}),
});
app.get('/api/auth/password-key', (req, res) => res.json(passwordTransport.publicKey()));
app.use("/api/auth/oauth", createOAuthRouter({ config, store, setAuth }));
function clearAuth(res) {
  adminOtp.clear(res);
  for (const name of ["kn_session", "kn_access", "kn_refresh"])
    res.clearCookie(name, { ...cookieOpts, maxAge: undefined });
}
function demoSession(res, id) {
  const token = opaque();
  store.db.sessions = store.db.sessions.filter((s) => s.expires > Date.now());
  store.db.sessions.push({
    token: digest(token),
    user_id: id,
    expires: Date.now() + 7 * 86400000,
  });
  store.save();
  res.cookie("kn_session", token, cookieOpts);
}
const adminOtp = createAdminOtp({ config, makeAuthClient });
const passwordRecovery = createPasswordRecovery({ config, makeAuthClient, store });
app.post('/api/auth/refresh', async (req, res) => {
  if (config.mode === 'demo') return res.json({ ok: true });
  if (!req.cookies.kn_refresh) return res.status(401).json({ error: 'Vui lòng đăng nhập.' });
  const client = makeAuthClient();
  const { data, error } = await client.auth.refreshSession({ refresh_token: req.cookies.kn_refresh });
  if (error || !data.session || !data.user) {
    clearAuth(res);
    return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn.' });
  }
  req.user = await store.profile(data.user.id);
  try {
    await operations.authorize(req, data.session.access_token);
  } catch (error) {
    if ([401, 403].includes(error.status)) clearAuth(res);
    throw error;
  }
  setAuth(res, data.session);
  res.json({ ok: true });
});
const authorized = Symbol('authorized-request');
const auth = async (req, res, next) => {
  try {
    if (req[authorized]) return next();
    let verifiedToken = req.cookies.kn_session;
    if (config.mode === "demo") {
      const s = store.db.sessions.find(
        (s) =>
          safeEqual(s.token, digest(req.cookies.kn_session || "")) &&
          s.expires > Date.now(),
      );
      if (!s) throw new AppError("Vui lòng đăng nhập.", 401);
      req.user = store.profile(s.user_id);
    } else {
      const verified = await verifyBearer(req, makeAuthClient());
      verifiedToken = verified.token;
      req.user = await store.profile(verified.user.id);
      req.authUser = verified.user;
      req.authToken = verifiedToken;
    }
    if (!req.user) throw new AppError('Vui lòng đăng nhập lại.', 401);
    await operations.authorize(req, verifiedToken);
    if (
      req.authUser &&
      needsMfa(req.authUser, verifiedToken) &&
      !req.originalUrl.split("?")[0].startsWith("/api/auth/mfa/")
    ) {
      return res
        .status(403)
        .json({ error: "Vui lòng xác minh hai bước.", code: "MFA_REQUIRED" });
    }
    return adminOtp.guard(req, res, error => {
      if (error) return next(error);
      req[authorized] = true;
      next();
    });
  } catch (e) {
    if (e.status === 401) return res.status(401).json({ error: e.message, code: 'AUTH_REQUIRED' });
    next(e);
  }
};
const admin = (req, res, next) =>
  req.user.role === "admin"
    ? next()
    : next(new AppError("Bạn không có quyền quản trị.", 403));
const uuid = z.uuid();
app.use('/api', apiAccessGuard({ auth, admin }));
app.use('/api', passwordTransport.middleware.bind(passwordTransport));
app.use("/api/auth/mfa", mfaRouter({ config, auth, limiter, setAuth }));
app.use('/api', categoriesRouter({ categories: categoryStore, auth, admin, limiter, store }));
app.use("/api/auth/admin-otp", adminOtp.router({ auth, limiter }));
app.use("/api", operationsRouter({ operations, auth, admin, limiter }));
app.use(
  "/api",
  mediaRouter({ store, mode: config.mode, auth, admin, limiter }),
);
const money = z.number().int().min(1000).max(100000000);
const email = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
const password = strongPassword;
app.use(
  "/api",
  accountRouter({
    operations,
    config,
    store,
    auth,
    limiter,
    makeAuthClient,
    setAuth,
    demoSession,
  }),
);
const credentials = z
  .object({ email, password: z.string().min(1).max(128) })
  .strict();
const orderSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            variant_id: uuid,
            quantity: z.number().int().min(1).max(10),
          })
          .strict(),
      )
      .min(1)
      .max(20)
      .refine(
        (items) =>
          new Set(items.map((i) => i.variant_id)).size === items.length,
        "Gói sản phẩm bị trùng.",
      ),
    method: z.enum(["wallet", "sepay"]),
    coupon: z
      .string()
      .max(32)
      .transform((v) => v.trim().toUpperCase())
      .default(""),
    customer_note: z.string().max(1000).default(""),
  })
  .strict();
const secretsSchema = z
  .object({
    secrets: z
      .array(z.string().trim().min(1).max(2000))
      .min(1)
      .max(100),
  })
  .strict();
const productSchema = z
  .object({
    id: uuid.optional(),
    slug: z
      .string()
      .min(2)
      .max(100)
      .regex(/^[a-z0-9-]+$/),
    name: z.string().trim().min(2).max(140),
    category: categoryId,
    platform: z.string().max(60),
    subcategory: z.string().trim().max(60).default(""),
    subtitle: z.string().max(200).default(""),
    description: z.string().max(5000).default(""),
    product_kind: z.enum(["key", "account", "source", "product", "service"]).optional(),
    usage_notes: z.string().trim().max(10000).optional(),
    image: z
      .string()
      .max(600)
      .refine(
        (v) =>
          v === "" ||
          isStoreImage(v) ||
          /^https:\/\/shared\.fastly\.steamstatic\.com\/[a-zA-Z0-9_./-]+$/.test(
            v,
          ),
        "Chọn ảnh đã tải lên, ảnh có sẵn hoặc ảnh Steam CDN.",
      ),
    featured: z.boolean(),
    active: z.boolean(),
  })
  .strict();
const variantSchema = z
  .object({
    id: uuid.optional(),
    name: z.string().trim().min(2).max(140),
    price: money,
    original_price: money,
    delivery: z.enum(["key", "manual"]),
    active: z.boolean().optional(),
    unlimited: z.boolean().optional(),
    shared_key: z.string().trim().max(2000).optional(),
    is_preorder: z.boolean().default(false),
    expected_delivery: z.iso.date().nullable().default(null),
    stock: z.number().int().min(0).max(100000),
    region: z.string().min(1).max(60),
    warranty_days: z.number().int().min(0).max(3650).optional(),
  })
  .strict().refine(v => !v.is_preorder || (v.delivery === 'manual' && !!v.expected_delivery),
    'Đặt trước cần giao thủ công và ngày giao dự kiến.')
  .refine(v => !v.unlimited || (v.delivery === 'key' && !v.is_preorder && (!!v.id || !!v.shared_key)), 'Gói vô hạn cần giao mã và một key dùng chung.');
app.use('/api', sellersRouter({ store, auth, admin, limiter, categoryStore, productSchema, variantSchema, secretsSchema }));
async function paymentInfo(p) {
  if (!p) return null;
  const route = await paymentRouting.prepare(p);
  const unmonitorableStaticTingee = route?.provider === 'tingee' &&
    route.qr_kind === 'static' &&
    (!route.va_account || !route.account || route.account !== route.va_account);
  const bank=route?.bank || config.bank, account=route?.account || config.account,
    accountName=route?.account_name || config.accountName;
  const query = new URLSearchParams({
    acc: account,
    bank,
    amount: String(p.amount),
    des: p.code,
    template: "compact",
    holder: accountName,
  });
  return {
    id:p.id,user_id:p.user_id,order_id:p.order_id,amount:p.amount,code:p.code,status:p.status,
    created_at:p.created_at,expires_at:route?.qr_expires_at || p.expires_at,
    provider:route?.provider || (route ? null : 'legacy'),
    qr_state:unmonitorableStaticTingee ? 'failed' : route?.state || 'ready',
    qr_kind:route?.qr_kind || null,
    bill_id:route?.bill_id || null,
    qr_url:
      route && (route.state!=='ready' || unmonitorableStaticTingee) ? null : route?.provider==='tingee' ? route.qr_image : config.mode === "supabase" && account
        ? `https://vietqr.app/img?${query}`
        : null,
    bank,
    account:route && (route.state!=='ready' || unmonitorableStaticTingee) ? '' : account,
    account_name:accountName,
    demo: config.mode === "demo",
  };
}
async function orderInfo(o) {
  const { fingerprint, idempotency, ...result } = o;
  return {
    ...result,
    payment: await paymentInfo(o.payment),
    items: o.items.map((i) => ({
      ...i,
      product_image: i.product_image || productImages[i.product_slug] || "",
      warranty_days: i.warranty_days ?? null,
      delivered_at: i.delivered_at ?? null,
      ...warrantyInfo(i, o.status),
    })),
  };
}
app.get("/api/health", (req, res) => res.json({ ok: true, mode: config.mode }));
const steamArt = createSteamArt();
app.get('/api/steam-art', async (req, res) => res.json({ items: await steamArt() }));
app.get("/api/config", (req, res) =>
  res.json({
    mode: config.mode,
    captcha: { enabled: config.captcha.enabled, site_key: config.captcha.enabled ? config.captcha.siteKey : null },
    payments_ready: config.mode === "demo" || bankPayments.status().ready,
    demo_accounts:
      config.mode === "demo"
        ? { customer: "student@keynest.local", admin: "admin@keynest.local" }
        : null,
  }),
);
app.get("/api/products", async (req, res) => {
  await store.expire();
  res.json(await store.products());
});
app.get("/api/catalog", async (req, res) => {
  const filters = catalogQuery.parse(req.query);
  await store.expire();
  res.json(await store.catalog(filters));
});
app.get("/api/products/:identifier", async (req, res) => {
  const identifier = z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/)
    .parse(req.params.identifier);
  await store.expire();
  const product = await store.product(identifier);
  if (!product) throw new AppError("Không tìm thấy sản phẩm.", 404);
  res.json(product);
});
app.get("/api/promotions", async (req, res) =>
  res.json(
    (await store.promotions()).sort(
      (a, b) =>
        Number(!!b.pinned) - Number(!!a.pinned) || a.code.localeCompare(b.code),
    ),
  ),
);
app.get("/api/banners", async (req, res) => res.json(await store.banners()));
app.get("/api/products/:id/reviews", async (req, res) =>
  res.json(
    await store.reviews(
      uuid.parse(req.params.id),
      z.coerce
        .number()
        .int()
        .min(1)
        .max(10000)
        .default(1)
        .parse(req.query.page),
    ),
  ),
);
app.get("/api/products/:id/comments", async (req, res) =>
  res.json(
    await store.comments(
      uuid.parse(req.params.id),
      z.coerce
        .number()
        .int()
        .min(1)
        .max(10000)
        .default(1)
        .parse(req.query.page),
    ),
  ),
);
app.post("/api/auth/login", async (req, res) => {
  const input = credentials.parse(req.body);
  let user;
  if (config.mode === "demo") {
    const u = store.db.users.find((u) => u.email === input.email);
    if (!u || !verifyPassword(input.password, u.password_hash))
      throw new AppError("Email hoặc mật khẩu không đúng.", 401);
    await operations.checkAccess(u.id);
    demoSession(res, u.id);
    user = store.profile(u.id);
  } else {
    const { data, error } =
      await makeAuthClient().auth.signInWithPassword(input);
    if (error)
      throw new AppError(
        "Email/mật khẩu không đúng hoặc email chưa xác minh.",
        401,
      );
    await operations.checkAccess(data.user.id);
    setAuth(res, data.session);
    user = await store.profile(data.user.id);
    if (needsMfa(data.user, data.session.access_token))
      return res.json({ mfa_required: true });
    if (user.role === "admin")
      return res.json({ admin_otp_required: true });
  }
  res.json(user);
});
app.post("/api/auth/register", async (req, res) => {
  const input = z
    .object({ email, password, name: z.string().trim().min(2).max(80) })
    .strict()
    .parse(req.body);
  if (config.mode === "demo") {
    const u = store.register(input.email, input.password, input.name);
    demoSession(res, u.id);
    return res.json({ user: u });
  }
  const result = await registerSupabase(store, makeAuthClient(), input);
  if (result.session) setAuth(res, result.session);
  res.json(result.user ? { user: result.user } : { message: result.message });
});
app.post(
  "/api/auth/forgot",
  (req, res, next) => {
    if (
      config.mode === "supabase" &&
      (req.headers.authorization || req.cookies.kn_refresh)
    )
      return auth(req, res, next);
    next();
  },
  requirePasswordSession,
  async (req, res) => {
    const input = z.object({ email }).strict().parse(req.body);
    if (config.mode === "demo")
      throw new AppError(
        "Demo không gửi email. Hãy dùng tài khoản mẫu hoặc đăng ký mới.",
      );
    await passwordRecovery.request(input.email);
    res.json({
      message: "Nếu email tồn tại, hướng dẫn đặt lại mật khẩu sẽ được gửi.",
    });
  },
);
app.post("/api/auth/reset/verify", async (req, res) => {
  if (config.mode === "demo")
    throw new AppError("Chức năng này cần Supabase Auth.");
  const input = z
    .object({
      token_hash: z.string().min(20).max(1024),
      type: z.literal("recovery"),
      recovery_id: z.string().uuid(),
    })
    .strict()
    .parse(req.body);
  res.json(await passwordRecovery.redeem(input));
});
app.post("/api/auth/reset", async (req, res) => {
  if (config.mode === "demo")
    throw new AppError("Chức năng này cần Supabase Auth.");
  const input = z
    .object({
      ticket: z.string().min(32).max(256),
      password,
    })
    .strict()
    .parse(req.body);
  const session = await passwordRecovery.complete(input);
  setAuth(res, session);
  res.json({ message: "Mật khẩu đã được cập nhật." });
});
app.get("/api/me", auth, async (req, res) => res.json(req.user));
app.patch("/api/me", auth, async (req, res) =>
  res.json(
    await store.updateProfile(
      req.user.id,
      z
        .object({ name: z.string().trim().min(2).max(80) })
        .strict()
        .parse(req.body),
    ),
  ),
);
app.post("/api/auth/logout", async (req, res) => {
  if (config.mode === "demo") {
    store.db.sessions = store.db.sessions.filter(
      (s) => !safeEqual(s.token, digest(req.cookies.kn_session || "")),
    );
    store.save();
  } else if (bearerToken(req) && req.cookies.kn_refresh) {
    const client = makeAuthClient();
    const { error } = await client.auth.setSession({
      access_token: bearerToken(req),
      refresh_token: req.cookies.kn_refresh,
    });
    if (!error) await client.auth.signOut({ scope: "local" });
  }
  clearAuth(res);
  res.json({ ok: true });
});
app.get("/api/orders", auth, async (req, res) =>
  res.json(await Promise.all((await store.orders(req.user.id)).map(orderInfo))),
);
app.post("/api/coupons/preview", auth, limiter(40), async (req, res) => {
  const input = z
    .object({
      code: z
        .string()
        .trim()
        .min(3)
        .max(32)
        .transform((v) => v.toUpperCase()),
      items: orderSchema.shape.items,
    })
    .strict()
    .parse(req.body);
  res.json(await store.quoteCoupon(req.user.id, input.code, input.items));
});
app.get("/api/orders/:id", auth, async (req, res) => {
  const id = uuid.parse(req.params.id);
  const order = (await store.orders(req.user.id, false, id))[0];
  if (!order) throw new AppError("Không tìm thấy đơn hàng.", 404);
  res.json({
    ...await orderInfo(order),
    warranty_requests: (await store.tickets(req.user.id)).filter(
      (t) => t.kind === "warranty" && t.order_id === id,
    ),
  });
});
app.post(
  "/api/orders/:id/warranty",
  auth,
  limiter(8, 15 * 60000),
  async (req, res) => {
    const payload = z
      .object({
        key_ids: z
          .array(uuid)
          .min(1)
          .max(200)
          .refine((ids) => new Set(ids).size === ids.length),
        message: z.string().trim().min(10).max(3000),
      })
      .strict()
      .parse(req.body);
    res
      .status(201)
      .json(
        await store.createWarranty(
          req.user.id,
          uuid.parse(req.params.id),
          payload,
        ),
      );
  },
);
app.post("/api/orders", auth, limiter(15), async (req, res) => {
  const payload = orderSchema.parse(req.body);
  const idempotency = uuid.parse(req.headers["idempotency-key"]);
  if (payload.method === "sepay") bankPayments.assertReady();
  const o = await store.createOrder(req.user.id, payload, idempotency);
  const result = (await store.orders(req.user.id)).find((x) => x.id === o.id);
  res.status(201).json(await orderInfo(result));
});
app.post("/api/orders/:id/cancel", auth, async (req, res) => {
  await store.cancel(req.user.id, uuid.parse(req.params.id));
  res.json({ ok: true });
});
app.get("/api/wallet", auth, async (req, res) => {
  const [profile, ledger, payments] = await Promise.all([
    store.profile(req.user.id), store.ledger(req.user.id), store.payments(req.user.id),
  ]);
  res.json({
    balance: profile.balance,
    ledger,
    payments: await Promise.all(payments
      .filter((p) => !p.order_id)
      .map(paymentInfo)),
  });
});
app.post("/api/wallet/topup", auth, limiter(10), async (req, res) => {
  const { amount } = z
    .object({ amount: z.number().int().min(10000).max(50000000).multipleOf(1000) })
    .strict()
    .parse(req.body);
  bankPayments.assertReady();
  res
    .status(201)
    .json(await paymentInfo(await store.createTopup(req.user.id, amount)));
});
app.post("/api/demo/pay/:id", auth, async (req, res) => {
  if (config.mode !== "demo") throw new AppError("Không tìm thấy.", 404);
  const p = store.db.payments.find(
    (p) => p.id === uuid.parse(req.params.id) && p.user_id === req.user.id,
  );
  if (!p) throw new AppError("Không tìm thấy giao dịch.", 404);
  res.json(await store.settle(`demo-${p.id}`, p.code, p.amount));
});
app.post("/api/webhooks/sepay", async (req, res) => {
  if (
    config.mode !== "supabase" ||
    config.paymentProvider !== "sepay" ||
    !config.webhook
  )
    throw new AppError("Webhook chưa cấu hình.", 503);
  if (!safeEqual(req.headers.authorization, `Apikey ${config.webhook}`))
    throw new AppError("Webhook không hợp lệ.", 401);
  const payload = z
    .object({
      id: z.number().int().positive(),
      accountNumber: z.string(),
      transferType: z.enum(["in", "out"]),
      transferAmount: z.number().int().positive().max(1000000000000),
      code: z.string().nullable().optional(),
      content: z.string().max(5000),
    })
    .passthrough()
    .parse(req.body);
  const result = await paymentIngress.accept("sepay", {
    id: String(payload.id),
    account: payload.accountNumber,
    direction: payload.transferType,
    currency: "VND",
    amount: payload.transferAmount,
    content: payload.content,
    code: payload.code,
  });
  res.json({ success: true, ...result });
});
app.get("/api/tickets", auth, async (req, res) =>
  res.json(await store.tickets(req.user.id)),
);
app.get("/api/tickets/:id", auth, async (req, res) => {
  const ticket = (
    await store.tickets(req.user.id, false, uuid.parse(req.params.id))
  )[0];
  if (!ticket) throw new AppError("Không tìm thấy yêu cầu hỗ trợ.", 404);
  res.json(ticket);
});
app.post(
  "/api/tickets/:id/messages",
  auth,
  limiter(15, 15 * 60000),
  async (req, res) => {
    const { body } = z
      .object({ body: z.string().trim().min(3).max(3000) })
      .strict()
      .parse(req.body);
    const id = uuid.parse(req.params.id);
    if (!(await store.tickets(req.user.id, false, id)).length) throw new AppError('Không tìm thấy yêu cầu.', 404);
    await store.addTicketMessage(req.user.id, id, body);
    res.status(201).json({ ok: true });
  },
);
app.post("/api/tickets", auth, limiter(5), async (req, res) =>
  res.status(201).json(
    await store.createTicket(
      req.user.id,
      z
        .object({
          subject: z.string().trim().min(3).max(120),
          message: z.string().trim().min(10).max(3000),
        })
        .strict()
        .parse(req.body),
    ),
  ),
);
app.post("/api/comments", auth, limiter(12, 15 * 60000), async (req, res) =>
  res.status(201).json(
    await store.createComment(
      req.user.id,
      z
        .object({
          product_id: uuid,
          body: z.string().trim().min(3).max(1000),
        })
        .strict()
        .parse(req.body),
    ),
  ),
);
app.post("/api/comments/:id/delete", auth, async (req, res) =>
  res.json(
    await store.deleteComment(
      req.user.id,
      req.user.role === "admin",
      uuid.parse(req.params.id),
    ),
  ),
);
app.post("/api/reviews", auth, limiter(12, 15 * 60000), async (req, res) =>
  res.status(201).json(
    await store.createReview(
      req.user.id,
      z
        .object({
          product_id: uuid,
          rating: z.number().int().min(1).max(5),
          comment: z.string().trim().min(3).max(1000),
        })
        .strict()
        .parse(req.body),
    ),
  ),
);
app.use("/api/admin", auth, admin);
for (const [path, kind, schema] of [
  ['categories', 'category', categoryId],
  ['coupons', 'coupon', z.string().min(3).max(32).regex(/^[A-Z0-9_-]+$/)],
  ['banners', 'banner', uuid],
]) {
  app.delete(`/api/admin/${path}/:id`, limiter(30, 60000, `delete-${kind}`), async (req, res) => {
    await deleteAdminRecord(store, req.user.id, kind, schema.parse(req.params.id));
    res.json({ ok: true });
  });
}
app.get("/api/admin/bank-payments/status", (req, res) =>
  res.json({
    ...bankPayments.status(),
    infrastructure: infrastructure.status(),
  }),
);
app.get("/api/admin/orders/:id", async (req, res) => {
  const id = uuid.parse(req.params.id);
  const order = (await store.orders(req.user.id, true, id))[0];
  if (!order) throw new AppError("Không tìm thấy đơn hàng.", 404);
  const [customer, tickets] = await Promise.all([
    store.profile(order.user_id),
    store.tickets(order.user_id),
  ]);
  res.json({
    ...await orderInfo(order),
    customer,
    warranty_requests: tickets.filter(
      (t) => t.kind === "warranty" && t.order_id === id,
    ),
  });
});
app.get("/api/admin/tickets/:id", async (req, res) => {
  const ticket = (
    await store.tickets(req.user.id, true, uuid.parse(req.params.id))
  )[0];
  if (!ticket) throw new AppError("Không tìm thấy yêu cầu hỗ trợ.", 404);
  res.json({ ...ticket, customer: await store.profile(ticket.user_id) });
});
app.get("/api/admin/inventory/:id", async (req, res) => {
  const filters = z
    .object({
      state: z.enum(["all", "available", "assigned"]).default("all"),
      page: z.coerce.number().int().min(1).max(10000).default(1),
      page_size: z.coerce.number().int().min(1).max(100).default(25),
    })
    .strict()
    .parse(req.query);
  res.json(await store.inventory(uuid.parse(req.params.id), filters));
});
app.get("/api/admin/overview", async (req, res) => {
  const data = await store.overview();
  res.json({
    ...data,
    orders: await Promise.all(data.orders.map(orderInfo)),
    products: await store.products(true),
  });
});
app.post("/api/admin/reconcile/:transaction", async (req, res) => {
  const transaction = z.string().min(1).max(100).parse(req.params.transaction);
  const input = z
    .object({ user_id: uuid, reason: z.string().trim().min(10).max(1000) })
    .strict()
    .parse(req.body);
  await store.reconcile(transaction, input.user_id, input.reason, req.user.id);
  res.json({ ok: true });
});
app.post("/api/admin/coupons", async (req, res) => {
  const input = z
    .object({
      code: z
        .string()
        .trim()
        .min(3)
        .max(32)
        .regex(/^[A-Z0-9_-]+$/),
      percent: z.number().int().min(1).max(90),
      max_discount: money,
      active: z.boolean(),
      expires_at: z.iso.datetime().nullable(),
      discount_type: z.enum(["percent", "fixed"]).default("percent"),
      fixed_amount: z.number().int().min(0).max(100000000).default(0),
      min_subtotal: z.number().int().min(0).max(100000000).default(0),
      total_limit: z
        .number()
        .int()
        .min(1)
        .max(1000000)
        .nullable()
        .default(null),
      per_user_limit: z
        .number()
        .int()
        .min(1)
        .max(1000000)
        .nullable()
        .default(null),
      starts_at: z.iso.datetime().nullable().default(null),
      category: categoryId.default("all"),
      product_ids: z.array(uuid).max(100).default([]),
      first_order_only: z.boolean().default(false),
    })
    .strict()
    .refine(
      (c) => c.discount_type !== "fixed" || c.fixed_amount >= 1000,
      "Số tiền giảm cố định tối thiểu 1.000đ.",
    )
    .refine(
      (c) =>
        !c.starts_at ||
        !c.expires_at ||
        Date.parse(c.starts_at) < Date.parse(c.expires_at),
      "Ngày kết thúc phải sau ngày bắt đầu.",
    )
    .parse(req.body);
  if (input.category !== 'all') await categoryStore.require(input.category);
  const result = await store.saveCoupon(input);
  await store.audit(req.user.id, "save_coupon", input.code);
  res.json(result);
});
app.post("/api/admin/products", async (req, res) => {
  const input = productSchema.parse(req.body);
  await categoryStore.require(input.category);
  const result = await store.saveProduct(input);
  await store.audit(req.user.id, "save_product", result.id);
  res.json(result);
});
app.delete("/api/admin/products/:id", async (req, res) => {
  const id = uuid.parse(req.params.id);
  await store.deleteProduct(id, req.user.id);
  res.json({ ok: true });
});
app.get("/api/admin/banners", async (req, res) =>
  res.json(await store.banners(true)),
);
app.post("/api/admin/banners", async (req, res) => {
  const input = z
    .object({
      id: uuid.optional(),
      title: z.string().trim().min(2).max(100),
      eyebrow: z.string().trim().max(60),
      description: z.string().trim().max(240),
      image: z
        .string()
        .max(600)
        .refine(isStoreImage, "Chọn ảnh đã tải lên hoặc ảnh Steam CDN hợp lệ."),
      href: z
        .string()
        .max(300)
        .refine(
          (v) =>
            /^\/(?:products\/[a-z0-9-]+|catalog(?:\?[^\s\\#]*)?|promotions|guide|wallet|support)$/.test(
              v,
            ) && !/[<>]/.test(v),
          "Liên kết phải trỏ tới một trang trong cửa hàng.",
        ),
      cta: z.string().trim().min(2).max(40),
      active: z.boolean(),
      sort_order: z.number().int().min(0).max(999),
    })
    .strict()
    .parse(req.body);
  const result = await store.saveBanner(input);
  await store.audit(req.user.id, "save_banner", result.id);
  res.json(result);
});
app.post("/api/admin/products/:id/variants", async (req, res) => {
  const id = uuid.parse(req.params.id);
  const result = await store.saveVariant(id, variantSchema.parse(req.body));
  await store.audit(req.user.id, "save_variant", id);
  res.json(result);
});
app.delete("/api/admin/variants/:id", async (req, res) => {
  const id = uuid.parse(req.params.id);
  await store.deleteVariant(id, req.user.id);
  res.json({ ok: true });
});
app.post("/api/admin/inventory/:id", async (req, res) => {
  const id = uuid.parse(req.params.id);
  const result = await store.importKeys(
    id,
    secretsSchema.parse(req.body).secrets,
  );
  await store.audit(req.user.id, "import_inventory", id);
  res.json(result);
});
app.post("/api/admin/orders/:id/fulfill", async (req, res) => {
  const id = uuid.parse(req.params.id);
  await store.fulfill(id, secretsSchema.parse(req.body).secrets);
  await store.audit(req.user.id, "fulfill_order", id);
  res.json({ ok: true });
});
app.post("/api/admin/orders/:id/refund", async (req, res) => {
  const id = uuid.parse(req.params.id);
  const input = z
    .object({
      ticket_id: uuid,
      method: z.enum(["wallet", "external"]),
      reason: z.string().trim().min(10).max(2000),
      reference: z.string().trim().max(200).default(""),
    })
    .strict()
    .refine(
      (v) => v.method !== "external" || v.reference.length >= 3,
      "Nhập mã giao dịch đã hoàn bên ngoài.",
    )
    .parse(req.body);
  await store.refund(id, { ...input, actor: req.user.id });
  res.json({ ok: true });
});
app.post("/api/admin/coupons/:code/pin", async (req, res) => {
  const code = z.string().min(3).max(32).parse(req.params.code);
  const { pinned } = z.object({ pinned: z.boolean() }).strict().parse(req.body);
  if (config.mode === "demo") {
    const coupon = store.db.coupons.find((c) => c.code === code);
    if (!coupon) throw new AppError("Không tìm thấy mã giảm giá.", 404);
    coupon.pinned = pinned;
    store.save();
  } else {
    const rows = await store.query(
      store.client
        .from("coupons")
        .update({ pinned })
        .eq("code", code)
        .select("code"),
    );
    if (!rows.length) throw new AppError("Không tìm thấy mã giảm giá.", 404);
  }
  await store.audit(req.user.id, pinned ? "pin_coupon" : "unpin_coupon", code);
  res.json({ pinned });
});
app.post("/api/admin/tickets/:id/reply", async (req, res) => {
  const id = uuid.parse(req.params.id);
  if (!(await store.tickets(req.user.id, true, id)).length) throw new AppError('Không tìm thấy yêu cầu.', 404);
  const { reply, status, priority } = z
    .object({
      reply: z.string().trim().min(3).max(3000),
      status: z.enum(["open", "in_progress", "closed"]).default("closed"),
      priority: z.enum(["low", "normal", "high"]).default("normal"),
    })
    .strict()
    .parse(req.body);
  await store.replyTicket(id, reply, req.user.id, status, priority);
  await store.audit(req.user.id, "reply_ticket", id);
  res.json({ ok: true });
});
app.delete('/api/admin/tickets/:id', async (req, res) => {
  const id = uuid.parse(req.params.id);
  if (!(await store.tickets(req.user.id, true, id)).length) throw new AppError('Không tìm thấy yêu cầu.', 404);
  await store.deleteTicket(id);
  await store.audit(req.user.id, 'delete_ticket', id);
  res.json({ ok: true });
});
app.use("/api", (req, res) =>
  res.status(404).json({ error: "Không tìm thấy API." }),
);
if (existsSync(resolve("dist/index.html"))) {
  const pageTemplate = readFileSync(resolve('dist/index.html'), 'utf8');
  app.get(['/share-preview', '/share-preview/products/:slug'], async (req, res) => {
    const path = req.params.slug ? `/products/${req.params.slug}` : '/';
    if (req.params.slug && !/^[a-z0-9-]{1,120}$/.test(req.params.slug)) return res.sendStatus(404);
    const meta = await socialMetadata(path, config.origin, store);
    if (!meta) return res.sendStatus(404);
    res.type('html').send(`<!doctype html><html lang="vi"><head><meta charset="utf-8">${metadataHead(meta)}</head><body></body></html>`);
  });
  app.use(express.static(resolve("dist"), { index: false, setHeaders(res, path) {
    if (/[\\/]images[\\/](share|products)[\\/]/.test(path)) res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  } }));
  app.get("/{*path}", async (req, res) => {
    const meta = await socialMetadata(req.path, config.origin, store);
    if (!meta) return res.status(404).type('html').send(pageTemplate);
    res.type('html').send(injectPublicInformation(injectMetadata(pageTemplate, meta), req.path));
  });
}
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === "entity.too.large")
    return res
      .status(413)
      .json({ error: "Tập tin quá lớn. Ảnh tải lên tối đa 8 MB." });
  if (err instanceof ZodError)
    return res
      .status(400)
      .json({ error: err.issues.map((i) => i.message).join(" ") });
  if (err.type === "entity.parse.failed")
    return res.status(400).json({ error: "JSON không hợp lệ." });
  if (err.type === "entity.too.large")
    return res.status(413).json({ error: "Dữ liệu quá lớn." });
  if (!(err instanceof AppError))
    console.error("Unexpected error:", err.message);
  res.status(err.status || 500).json({
    error:
      err instanceof AppError
        ? err.message
        : "Có lỗi hệ thống. Vui lòng thử lại.",
  });
});
if (process.env.NODE_ENV !== "test") {
  const server = app.listen(
    config.port,
    config.production ? "0.0.0.0" : "127.0.0.1",
    () =>
      console.log(
        `KEYNEST API http://127.0.0.1:${config.port} [${config.mode}]`,
      ),
  );
  const timer = setInterval(
    () =>
      Promise.resolve(store.expire()).catch((e) =>
        console.error("Expiry failed:", e.message),
      ),
    60000,
  );
  timer.unref();
  const receiptWorker = createReceiptWorker({ store, config });
  const receiptTimer = setInterval(() => void receiptWorker.tick(), 15000);
  receiptTimer.unref();
  void receiptWorker.tick();
  const tingeeTimer=setInterval(()=>void paymentRouting.tick(),2000);
  tingeeTimer.unref();
  void paymentRouting.tick();
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(timer);
    clearInterval(receiptTimer);
    clearInterval(tingeeTimer);
    const force = setTimeout(() => process.exit(1), 30000);
    force.unref();
    await new Promise((done) => server.close(done));
    await infrastructure.close();
    clearTimeout(force);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
