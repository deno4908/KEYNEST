import { createECDH, hkdfSync, createHash } from 'node:crypto';
import { compactDecrypt, importJWK } from 'jose';
import { AppError } from './security.js';

export const PASSWORD_PATHS = ['/auth/login', '/auth/register', '/auth/reset', '/me/password'];

// Derive a separate encryption key so replicas share it without publishing or
// reusing the inventory key. The wire format is standard JWE, implemented by jose.
export function createPasswordTransport(secret, clock = () => Date.now()) {
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
    publicKey: () => ({ jwk, kid, timestamp: clock(), ttl: 120000 }),
    async open(value, path) {
      try {
        if (typeof value !== 'string' || value.length > 12000) throw new Error();
        const { plaintext, protectedHeader } = await compactDecrypt(value, await key, {
          keyManagementAlgorithms: ['ECDH-ES'], contentEncryptionAlgorithms: ['A256GCM'],
        });
        const payload = JSON.parse(new TextDecoder().decode(plaintext));
        const now = clock();
        if (protectedHeader.kid !== kid || protectedHeader.typ !== 'keynest-password+jwe' ||
            payload.path !== path || !Number.isSafeInteger(payload.iat) ||
            payload.iat > now + 5000 || payload.iat < now - 120000 ||
            !payload.body || typeof payload.body !== 'object' || Array.isArray(payload.body)) throw new Error();
        return payload.body;
      } catch {
        throw new AppError('Yêu cầu mật khẩu không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.', 400);
      }
    },
    async middleware(req, res, next) {
      try {
        // Plain requests remain supported for an already-open older frontend.
        // New clients never fall back to cleartext when encryption fails.
        if (req.method === 'POST' && PASSWORD_PATHS.includes(req.path) && req.body?.encrypted_credentials !== undefined) {
          if (Object.keys(req.body).length !== 1) throw new AppError('Yêu cầu không hợp lệ.', 400);
          req.body = await this.open(req.body.encrypted_credentials, req.path);
        }
        next();
      } catch (error) { next(error); }
    },
  };
}
