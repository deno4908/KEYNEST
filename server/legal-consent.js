import { createHash } from 'node:crypto';
import { z } from 'zod';
import { LEGAL_VERSION, terms, privacy } from '../shared/legal-content.js';
import { AppError } from './security.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const legalHashes = Object.freeze({ terms_sha256: hash(terms), privacy_sha256: hash(privacy) });
export const accountConsentSchema = z.object({
  version: z.literal(LEGAL_VERSION), terms: z.literal(true), account_data: z.literal(true),
}).strict();
export const orderConsentSchema = accountConsentSchema.omit({ account_data: true });

export function consentProof(value, scope) {
  const schema = scope === 'account' ? accountConsentSchema : orderConsentSchema;
  if (!schema.safeParse(value).success) {
    if (typeof value?.version === 'string' && value.version !== LEGAL_VERSION)
      throw new AppError('Điều khoản đã cập nhật. Vui lòng tải lại trang, đọc và xác nhận phiên bản mới.', 409);
    throw new AppError(scope === 'account'
      ? 'Vui lòng xác nhận điều khoản và xử lý dữ liệu cần thiết trước khi tạo tài khoản.'
      : 'Vui lòng đọc và tích đồng ý điều kiện giao dịch trước khi đặt hàng.', 400);
  }
  // Deterministic for order idempotency. The order's DB created_at is its receipt
  // timestamp; do not add a fresh timestamp to the order fingerprint on retries.
  return { ...schema.parse(value), ...legalHashes };
}

export function accountConsentRecord(value, source) {
  return { ...consentProof(value, 'account'), source, accepted_at: new Date().toISOString() };
}
