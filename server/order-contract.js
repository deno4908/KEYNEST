import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AppError } from './security.js';

const versions = new Map(['2026-11-06-v1', '2026-11-06-v2'].map(version => {
  const archive = JSON.parse(readFileSync(new URL(`../shared/legal-archive/${version}.json`, import.meta.url), 'utf8'));
  return [archive.version, archive];
}));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function orderContract(order, buyer) {
  const payload = typeof order.fingerprint === 'string' ? JSON.parse(order.fingerprint) : order.fingerprint;
  const consent = payload?.legal;
  const policy = consent ? versions.get(consent.version) : null;
  if (consent && (!policy || consent.terms !== true || consent.terms_sha256 !== hash(policy.terms) ||
      consent.privacy_sha256 !== hash(policy.privacy)))
    throw new AppError('Bản chính sách của đơn cần được đối chiếu. Vui lòng liên hệ hỗ trợ.', 409);
  // Whitelist contractual fields. Never serialize delivery keys, access tokens,
  // payment route secrets, other customers or the entire order object.
  const money = value => `${Number(value || 0).toLocaleString('vi-VN')} VND`;
  const lines = [
    'KEYNEST — BẢN THÔNG TIN GIAO DỊCH',
    `Mã đơn: ${order.number || order.id}`, `Mã tham chiếu: ${order.id}`,
    `Thời điểm tạo đơn: ${order.created_at}`, `Trạng thái tại lúc tải: ${order.status}`,
    `Mã tài khoản khách hàng: ${order.user_id || buyer.id || ''}`,
    `Tên hồ sơ tại lúc tải: ${buyer.name || ''}`, `Email hồ sơ tại lúc tải: ${buyer.email || ''}`,
    `Phương thức: ${order.method === 'wallet' ? 'Số dư mua hàng KEYNEST' : 'Chuyển khoản ngân hàng'}`,
    '', 'SẢN PHẨM',
    ...order.items.map(item => `${item.name} — ${item.variant_name}\nSố lượng: ${item.quantity}; đơn giá: ${money(item.price)}; thành tiền: ${money(item.price * item.quantity)}\nGiao hàng: ${item.delivery === 'key' ? 'Trực tuyến trong đơn hàng' : 'Sau khi xử lý dịch vụ'}; bảo hành: ${item.warranty_days || 0} ngày${item.expected_delivery ? `; giao dự kiến: ${item.expected_delivery}` : ''}${item.seller_name ? `; người bán: ${item.seller_name}` : ''}`),
    '', `Tạm tính: ${money(order.subtotal)}`, `Giảm giá: ${money(order.discount)}`,
    `Tổng thanh toán: ${money(order.total)}`, 'Phí thanh toán: 0 VND',
    `Ghi chú/thông tin dịch vụ: ${order.customer_note || ''}`, '', 'XÁC NHẬN ĐIỀU KIỆN GIAO DỊCH',
    ...(consent ? [
      `Khách hàng đã xác nhận bằng ô đồng ý khi gửi đơn. Phiên bản: ${consent.version}`,
      `Ghi nhận cùng giao dịch tạo đơn tại: ${order.created_at}`,
      `SHA-256 điều khoản: ${consent.terms_sha256}`, `SHA-256 chính sách: ${consent.privacy_sha256}`,
      '', 'ĐIỀU KHOẢN ÁP DỤNG', ...policy.terms.map(([title, body]) => `${title}\n${body}\n`),
      'CHÍNH SÁCH BẢO MẬT ÁP DỤNG', ...policy.privacy.map(([title, body]) => `${title}\n${body}\n`),
    ] : ['Đơn cũ không có bản ghi ô xác nhận theo cơ chế hiện tại; không suy diễn việc đã chấp thuận phiên bản chính sách mới.']),
    '', 'Hỗ trợ/khiếu nại: https://keynest.store/support',
    'Bản này lưu thông tin giao dịch; không phải hóa đơn thuế hoặc bằng chứng ngân hàng đã nhận tiền.',
  ];
  return { document: lines.join('\n'), version: consent?.version || null };
}
