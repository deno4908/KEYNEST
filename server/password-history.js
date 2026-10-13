import { compare } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { AppError, hashPassword, verifyPassword } from './security.js';

export const PASSWORD_REUSE_ERROR = 'Mật khẩu mới không được trùng mật khẩu hiện tại hoặc mật khẩu đã dùng trong 30 ngày qua.';
const UNAVAILABLE = 'Không thể kiểm tra lịch sử mật khẩu lúc này. Vui lòng thử lại sau.';
const MONTH = 30 * 86400000;

export function changeDemoPassword(user, password, now = Date.now()) {
  const history = (user.password_history || []).filter(row => row.retired_at > now - MONTH);
  if ([user.password_hash, ...history.map(row => row.hash)].some(hash => verifyPassword(password, hash)))
    throw new AppError(PASSWORD_REUSE_ERROR, 400);
  const next = hashPassword(password);
  user.password_history = [...history, { hash: user.password_hash, retired_at: now }];
  user.password_hash = next;
}

export function createPasswordHistory(store) {
  return {
    async change(userId, password, update) {
      const lockId = randomUUID();
      let data, error;
      try {
        ({ data, error } = await store.client.rpc('begin_password_change', { p_user_id: userId, p_lock_id: lockId }));
      } catch { throw new AppError(UNAVAILABLE, 503); }
      if (error) throw new AppError(UNAVAILABLE, 503);
      if (!data) throw new AppError('Một yêu cầu đổi mật khẩu đang được xử lý. Vui lòng thử lại sau.', 409);
      try {
        const deadline = Date.now() + 30000;
        if (!Array.isArray(data.history)) throw new AppError(UNAVAILABLE, 503);
        for (const hash of [data.current_hash, ...data.history]) {
          if (!hash) continue;
          // Fail closed if Auth changes its hash format; never silently skip it.
          if (typeof hash !== 'string' || !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash))
            throw new AppError(UNAVAILABLE, 503);
          if (await compare(password, hash)) throw new AppError(PASSWORD_REUSE_ERROR, 400);
          if (Date.now() > deadline) throw new AppError(UNAVAILABLE, 503);
        }
        return await update();
      } finally {
        // A failed cleanup leaves a short lease, never an unlocked parallel write.
        try { await store.client.rpc('finish_password_change', { p_user_id: userId, p_lock_id: lockId }); }
        catch { /* lease expires automatically */ }
      }
    },
  };
}
