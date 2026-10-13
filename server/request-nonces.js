import { AppError } from './security.js';

const UNAVAILABLE = 'Không thể kiểm tra yêu cầu an toàn lúc này. Vui lòng thử lại sau.';

// Demo/tests only. Production must share the atomic database claim across replicas.
export function createMemoryNonceStore(clock = () => Date.now()) {
  const used = new Map();
  return {
    async consume(hash, expiresAt) {
      const now = clock();
      for (const [key, expires] of used) if (expires <= now) used.delete(key);
      if (expiresAt <= now || used.has(hash)) return false;
      if (used.size >= 10000) throw new AppError(UNAVAILABLE, 503);
      used.set(hash, expiresAt);
      return true;
    },
  };
}

export function createSupabaseNonceStore(store) {
  return {
    async consume(hash, expiresAt) {
      try {
        const { data, error } = await store.client.rpc('consume_password_request_nonce', {
          p_nonce_hash: hash, p_expires_at: new Date(expiresAt).toISOString(),
        });
        if (error || typeof data !== 'boolean') throw new Error();
        return data;
      } catch { throw new AppError(UNAVAILABLE, 503); }
    },
  };
}
