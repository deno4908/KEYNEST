import { rateLimit, ipKeyGenerator } from 'express-rate-limit';

const minute = 60000;
const write = method => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
// Match Express's default case-insensitive routing and optional trailing slash.
const pathOf = req => req.path.toLowerCase().replace(/\/+$/, '') || '/';
const webhook = path => ['/webhooks/pay2s', '/webhooks/sepay'].includes(path);
const sessionControl = (method, path) =>
  (['GET', 'HEAD'].includes(method) && ['/auth/mfa/status', '/auth/admin-otp/status'].includes(path)) ||
  (method === 'POST' && ['/auth/logout', '/auth/refresh', '/auth/mfa/enroll',
    '/auth/mfa/verify', '/auth/admin-otp/send', '/auth/admin-otp/verify'].includes(path));

// A bucket spans all IDs in its group: changing order/payment IDs cannot reset it.
const policies = [
  ['checkout', 15, minute, (m, p) => m === 'POST' && p === '/orders'],
  ['topup', 10, minute, (m, p) => m === 'POST' && p === '/wallet/topup'],
  ['coupon-preview', 40, minute, (m, p) => m === 'POST' && p === '/coupons/preview'],
  ['order-cancel', 10, minute, (m, p) => m === 'POST' && /^\/orders\/[^/]+\/cancel$/.test(p)],
  ['payment-status', 60, minute, (m, p) => ['GET', 'HEAD'].includes(m) && /^\/payments\/[^/]+$/.test(p)],
  ['profile-write', 10, 15 * minute, (m, p) => m === 'PATCH' && p === '/me'],
  ['password-change', 5, 15 * minute, (m, p) => m === 'POST' && p === '/me/password'],
  ['seller-withdraw', 5, 15 * minute, (m, p) => m === 'POST' && p === '/seller/withdrawals'],
  ['admin-money', 10, minute, (m, p) => m === 'POST' &&
    /^\/admin\/(?:orders\/[^/]+\/refund|reconcile\/[^/]+|sellers\/withdrawals\/[^/]+)$/.test(p)],
  ['admin-access', 10, 15 * minute, (m, p) => m === 'POST' &&
    /^\/admin\/(?:customers\/[^/]+\/access|sellers\/(?:role|fee))$/.test(p)],
  ['admin-write', 60, minute, (m, p) => write(m) && p.startsWith('/admin/')],
  ['seller-write', 30, minute, (m, p) => write(m) && p.startsWith('/seller/')],
];

export function createApiLimits({ rateStore = () => undefined } = {}) {
  let number = 0;
  const limiter = (limit, windowMs = minute, scope = `route-${number++}`) => {
    const property = `rateLimit:${scope}`;
    return rateLimit({
      store: rateStore(scope),
      passOnStoreError: false,
      // Early middleware has no req.user. Only verified auth may supply it later.
      keyGenerator: req => req.user?.id ? `user:${req.user.id}` : `ip:${ipKeyGenerator(req.ip || 'unknown')}`,
      windowMs, limit,
      identifier: scope,
      requestPropertyName: property,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (req, res) => {
        const retryAfter = Math.max(1, Math.ceil(
          ((req[property]?.resetTime?.getTime() || Date.now() + windowMs) - Date.now()) / 1000,
        ));
        res.setHeader('Retry-After', String(retryAfter));
        res.status(429).json({
          error: `Bạn thao tác quá nhanh. Vui lòng thử lại sau ${retryAfter < 60 ? `${retryAfter} giây` : `${Math.ceil(retryAfter / 60)} phút`}.`,
          code: 'RATE_LIMITED', retry_after: retryAfter,
        });
      },
    });
  };
  const general = limiter(240, minute, 'general');
  const webhooks = limiter(6000, minute, 'webhooks');
  const session = limiter(60, minute, 'session-control');
  const login = limiter(20, 15 * minute, 'auth-login');
  const register = limiter(5, 15 * minute, 'auth-register');
  const forgot = limiter(5, 15 * minute, 'auth-forgot');
  const recovery = limiter(10, 15 * minute, 'auth-recovery');
  const groups = policies.map(([scope, limit, windowMs, matches]) => ({
    matches,
    // An IP budget bounds unauthenticated work; verified users also have their
    // own tighter budget. Allow several customers behind the same NAT.
    ip: limiter(Math.max(30, limit * 3), windowMs, `${scope}-ip`),
    user: limiter(limit, windowMs, `${scope}-user`),
  }));
  const groupFor = req => groups.find(group => group.matches(req.method, pathOf(req)));

  return {
    limiter,
    // Mount before JSON/cookie parsing and any Supabase/auth/provider calls.
    early(req, res, next) {
      const path = pathOf(req);
      if (req.method === 'POST' && webhook(path)) return webhooks(req, res, next);
      if (sessionControl(req.method, path)) return session(req, res, next);
      general(req, res, error => {
        if (error) return next(error);
        if (path.startsWith('/auth/')) {
          if (['GET', 'HEAD'].includes(req.method) && path === '/auth/password-key') return next();
          const specific = req.method === 'POST' && ({
            '/auth/register': register, '/auth/forgot': forgot, '/auth/login-recovery/send': forgot,
            '/auth/reset': recovery, '/auth/reset/verify': recovery, '/auth/login-recovery/verify': recovery,
          })[path];
          return login(req, res, error => error ? next(error) : specific ? specific(req, res, next) : next());
        }
        const group = groupFor(req);
        return group ? group.ip(req, res, next) : next();
      });
    },
    // Mount immediately after the default API authentication/role guard.
    authenticated(req, res, next) {
      if (!req.user?.id) return next();
      const group = groupFor(req);
      return group ? group.user(req, res, next) : next();
    },
  };
}
