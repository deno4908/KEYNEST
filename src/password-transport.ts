import { CompactEncrypt, importJWK } from 'jose';

export async function protectPasswordRequest(path: string, body: unknown) {
  if (!globalThis.crypto?.subtle) throw new Error('Cần kết nối HTTPS để gửi mật khẩu an toàn.');
  const response = await fetch('/api/auth/password-key', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error('Không thể bảo vệ yêu cầu mật khẩu. Vui lòng thử lại.');
  const { jwk, kid, timestamp, nonce } = await response.json();
  if (typeof nonce !== 'string') throw new Error('Vui lòng tải lại trang sau khi hệ thống cập nhật.');
  const publicKey = await importJWK(jwk, 'ECDH-ES');
  const plaintext = new TextEncoder().encode(JSON.stringify({ path, iat: timestamp, nonce, body }));
  const encrypted_credentials = await new CompactEncrypt(plaintext)
    .setProtectedHeader({ alg: 'ECDH-ES', enc: 'A256GCM', kid, typ: 'keynest-password+jwe' })
    .encrypt(publicKey);
  return { encrypted_credentials };
}
