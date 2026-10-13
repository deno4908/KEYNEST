import { createECDH, hkdfSync, createHash, createHmac, randomBytes } from 'node:crypto';
import { compactDecrypt, importJWK } from 'jose';
import { AppError, digest, safeEqual } from './security.js';
import { createMemoryNonceStore } from './request-nonces.js';

export const PASSWORD_PATHS = ['/auth/login', '/auth/register', '/auth/reset', '/me/password'];

// Derive a separate encryption key so replicas share it without publishing or
// reusing the inventory key. The wire format is standard JWE, implemented by jose.
export function createPasswordTransport(secret, clock = () => Date.now(), {
  nonceStore = createMemoryNonceStore(clock), requireEncrypted = false,
} = {}) {
  const nonceKey = Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'hex'), 'keynest-password-nonce-v1', 'HMAC-SHA256', 32));
  const signNonce = value => createHmac('sha256', nonceKey).update(value).digest('hex');
  const ec = createECDH('prime256v1');
  for (let attempt = 0; ; attempt++) {
    const scalar = Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'hex'),
      'keynest-password-transport-v1', `P-256:${attempt}`, 32));
    try { ec.setPrivateKey(scalar); break; }
    catch { if (attempt >= 16) throw new Error('Cannot initialize password transport'); }
  }
  const point = ec.getPublicKey();
  const jwk = { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') };
  const kid = createHash('sha256').update(point).digest('hex').slice(0, 24);
  const key = importJWK({ ...jwk, d: Buffer.from(ec.getPrivateKey().toString('hex').padStart(64, '0'), 'hex').toString('base64url') }, 'ECDH-ES');
  return {
    publicKey() {
      const timestamp = clock();
      const nonce = `${randomBytes(32).toString('hex')}.${timestamp}`;
      return { jwk, kid, timestamp, ttl: 120000, nonce: `${nonce}.${signNonce(nonce)}` };
    },
    async open(value, path) {
      let payload;
      try {
        if (typeof value !== 'string' || value.length > 12000) throw new Error();
        const { plaintext, protectedHeader } = await compactDecrypt(value, await key, {
          keyManagementAlgorithms: ['ECDH-ES'], contentEncryptionAlgorithms: ['A256GCM'],
        });
        payload = JSON.parse(new TextDecoder().decode(plaintext));
        const now = clock();
        if (protectedHeader.kid !== kid || protectedHeader.typ !== 'keynest-password+jwe' ||
            payload.path !== path || !Number.isSafeInteger(payload.iat) ||
            payload.iat > now + 5000 || payload.iat < now - 120000 ||
            !payload.body || typeof payload.body !== 'object' || Array.isArray(payload.body)) throw new Error();
        if (typeof payload.nonce !== 'string' || !/^[a-f0-9]{64}\.\d{13}\.[a-f0-9]{64}$/.test(payload.nonce)) throw new Error();
        const [random, issued, signature] = payload.nonce.split('.');
        if (Number(issued) !== payload.iat || !safeEqual(signature, signNonce(`${random}.${issued}`))) throw new Error();
      } catch {
        throw new AppError('Yêu cầu mật khẩu không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.', 400);
      }
      if (!await nonceStore.consume(digest(payload.nonce), payload.iat + 120000))
        throw new AppError('Yêu cầu này đã được sử dụng hoặc hết hạn. Vui lòng gửi lại từ biểu mẫu.', 409);
      return payload.body;
    },
    async middleware(req, res, next) {
      try {
        if (req.method !== 'POST' || !PASSWORD_PATHS.includes(req.path.toLowerCase().replace(/\/+$/, ''))) return next();
        if (req.body?.encrypted_credentials !== undefined) {
          if (Object.keys(req.body).length !== 1) throw new AppError('Yêu cầu không hợp lệ.', 400);
          req.body = await this.open(req.body.encrypted_credentials, req.path.toLowerCase().replace(/\/+$/, ''));
        } else if (requireEncrypted) throw new AppError('Vui lòng tải lại trang để gửi yêu cầu mật khẩu an toàn.', 400);
        next();
      } catch (error) { next(error); }
    },
  };
}
