// Everything under /api is private unless deliberately exposed here. Public
// writes still have their own CAPTCHA, recovery-token or webhook verification.
export function isPublicApi(method, path) {
  path = path.toLowerCase().replace(/\/+$/, '') || '/';
  if (['GET', 'HEAD'].includes(method)) {
    return ['/health', '/config', '/region', '/steam-art', '/products', '/catalog', '/promotions',
      '/banners', '/categories', '/announcements', '/auth/password-key'].includes(path)
      || /^\/products\/[^/]+(?:\/(?:reviews|comments))?$/.test(path)
      || /^\/media\/[^/]+$/.test(path);
  }
  return method === 'POST' && ['/auth/login', '/auth/register', '/auth/forgot',
    '/auth/reset', '/auth/reset/verify', '/auth/refresh', '/auth/logout',
    '/webhooks/pay2s', '/webhooks/sepay'].includes(path);
}

export function apiAccessGuard({ auth, admin }) {
  return (req, res, next) => {
    if (isPublicApi(req.method, req.path)) return next();
    return auth(req, res, error => {
      if (error) return next(error);
      if (/^\/admin(?:\/|$)/i.test(req.path)) return admin(req, res, next);
      next();
    });
  };
}
