import { createHmac, randomUUID } from 'node:crypto';
import { AppError } from './security.js';

export const recoveryEmailHash = (email, key) => createHmac('sha256', Buffer.from(key, 'hex'))
  .update(email.trim().toLowerCase()).digest('hex');
const unavailable = () => new AppError('Chưa thể kiểm tra bảo mật đăng nhập. Vui lòng thử lại sau.', 503);
function required(state) {
  if (state?.otp_required) throw Object.assign(new AppError('Bạn đã nhập sai nhiều lần. Hãy xác minh OTP email và CAPTCHA để đặt mật khẩu mới.', 429),
    { code: 'PASSWORD_RECOVERY_REQUIRED' });
  if (state?.busy) throw Object.assign(new AppError('Một lượt đăng nhập đang được kiểm tra. Vui lòng chờ rồi thử lại.', 429),
    { code: 'LOGIN_BUSY', retry_after: state.retry_after || 2 });
}
export function createLoginProtection({ config, store, clock = () => Date.now() }) {
  async function call(name, params) {
    try {
      const { data, error } = await store.client.rpc(name, params);
      if (error || !data) throw unavailable();
      return data;
    } catch { throw unavailable(); }
  }
  const memory = () => store.db.login_attempts ||= {};
  async function begin(hash, attempt) {
    if (config.mode !== 'demo') return call('begin_login_attempt', { p_email_hash: hash, p_attempt: attempt });
    const now = clock(), rows = memory();
    for (const [key, row] of Object.entries(rows)) if (!row.otp_required && row.started < now - 86400000 && !(row.lease > now)) delete rows[key];
    let row = rows[hash];
    if (row?.otp_required) return { otp_required: true };
    if (row?.lease > now) return { busy: true, retry_after: 2 };
    if (!row || row.started <= now - 900000) row = rows[hash] = { started: now, failures: 0 };
    Object.assign(row, { attempt, lease: now + 30000 });
    store.save();
    return { attempt_id: attempt };
  }
  async function finish(hash, attempt, outcome) {
    if (config.mode !== 'demo') return call('finish_login_attempt', { p_email_hash: hash, p_attempt: attempt, p_outcome: outcome });
    const rows = memory(), row = rows[hash], now = clock();
    if (!row || row.attempt !== attempt || row.lease <= now) throw unavailable();
    if (outcome === 'success') delete rows[hash];
    else {
      if (outcome === 'failure') row.failures++;
      if (row.failures >= 5) row.otp_required = true;
      row.attempt = null; row.lease = null;
    }
    store.save();
    return { otp_required: !!row.otp_required };
  }
  return {
    async assertPasswordAllowed(email) {
      const hash = recoveryEmailHash(email, config.encryption);
      required(config.mode === 'demo' ? memory()[hash] : await call('login_protection_state', { p_email_hash: hash }));
    },
    async otpBudget(email, action) {
      const state = await call('login_otp_budget', { p_email_hash: recoveryEmailHash(email, config.encryption), p_action: action });
      if (state.not_required) throw new AppError('Hãy đăng nhập hoặc dùng chức năng quên mật khẩu.', 400);
      if (state.locked) throw Object.assign(new AppError('Luồng OTP đang tạm khóa do quá nhiều lần thử. Vui lòng chờ hết thời gian hoặc liên hệ hỗ trợ.', 429),
        { code: 'RECOVERY_OTP_LOCKED', retry_after: state.retry_after });
    },
    async authenticate(email, check) {
      const hash = recoveryEmailHash(email, config.encryption), attempt = randomUUID();
      required(await begin(hash, attempt));
      let result;
      try { result = await check(); }
      catch (error) {
        const state = await finish(hash, attempt, error.status === 401 ? 'failure' : 'error');
        required(state);
        throw error;
      }
      try { required(await finish(hash, attempt, 'success')); }
      catch (error) {
        // A valid password must not issue app cookies if the shared gate failed.
        try { await result?.client?.auth.signOut({ scope: 'local' }); } catch { /* fail closed */ }
        throw error;
      }
      return result;
    },
  };
}
