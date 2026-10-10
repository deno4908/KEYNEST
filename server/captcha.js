import { AppError } from './security.js';

export function captchaConfig(env = process.env) {
  if (env.RECAPTCHA_ENABLED && !['true', 'false'].includes(env.RECAPTCHA_ENABLED))
    throw new Error('RECAPTCHA_ENABLED phải là true hoặc false.');
  const enabled = env.RECAPTCHA_ENABLED === 'true';
  const siteKey = env.RECAPTCHA_SITE_KEY?.trim() || '';
  const secret = env.RECAPTCHA_SECRET_KEY?.trim() || '';
  const hostname = new URL(env.APP_ORIGIN || 'http://127.0.0.1:5173').hostname;
  if (enabled && (!siteKey || !secret)) throw new Error('Bật reCAPTCHA cần RECAPTCHA_SITE_KEY và RECAPTCHA_SECRET_KEY.');
  if (enabled && env.NODE_ENV === 'production' && (siteKey === '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI' || secret === '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe'))
    throw new Error('Không dùng reCAPTCHA test key trên production.');
  return { enabled, siteKey, secret, hostname };
}

export function captchaGuard(config, fetcher = fetch) {
  return async (req, res, next) => {
    try {
      if (!config.enabled) return next();
      const token = req.headers['x-captcha-token'];
      if (typeof token !== 'string' || !token.trim() || token.length > 8192)
        throw new AppError('Vui lòng hoàn thành reCAPTCHA.', 400);
      let result;
      try {
        const response = await fetcher('https://www.google.com/recaptcha/api/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ secret: config.secret, response: token }),
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error('Provider unavailable');
        result = await response.json();
      } catch {
        throw new AppError('Không thể kết nối reCAPTCHA. Vui lòng thử lại.', 503);
      }
      // Google verifies signature, expiry and single use. Also bind to this site.
      if (result?.success !== true || result.hostname !== config.hostname)
        throw new AppError('reCAPTCHA không hợp lệ hoặc đã hết hạn. Vui lòng xác minh lại.', 400);
      next();
    } catch (error) { next(error); }
  };
}
