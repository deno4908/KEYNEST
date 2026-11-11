import { Router } from 'express';
import { z } from 'zod';
import { captchaGuard } from './captcha.js';
import { AppError } from './security.js';

export function loginRecoveryRouter({ config, recovery, fetcher = fetch }) {
  const router = Router();
  // Both email delivery and OTP redemption require an actual CAPTCHA. Disabling
  // the site's optional login widget must never bypass this recovery requirement.
  router.use((req, res, next) => {
    if (config.mode !== 'supabase') return next(new AppError('OTP email cần Supabase Auth.', 400));
    if (!config.captcha.enabled) return next(new AppError('Xác minh CAPTCHA chưa được cấu hình. Vui lòng liên hệ hỗ trợ.', 503));
    next();
  }, captchaGuard(config.captcha, fetcher));
  router.post('/send', async (req, res) => {
    const { email } = z.object({ email: z.email().max(254).transform(value => value.toLowerCase()) }).strict().parse(req.body);
    res.json(await recovery.requestOtp(email));
  });
  router.post('/verify', async (req, res) => {
    const input = z.object({ challenge: z.string().min(32).max(4096), code: z.string().regex(/^\d{6,10}$/) }).strict().parse(req.body);
    res.json(await recovery.redeemOtp(input));
  });
  return router;
}
