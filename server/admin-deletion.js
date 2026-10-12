import { AppError } from './security.js';

export async function deleteAdminRecord(store, actor, kind, id) {
  if (!['category', 'coupon', 'banner'].includes(kind)) throw new AppError('Thao tác không hợp lệ.', 400);
  if (!store.db) return store.query(store.client.rpc('delete_admin_record', { p_actor: actor, p_kind: kind, p_id: id }));
  if (!store.db.users.some(u => u.id === actor && u.role === 'admin')) throw new AppError('Cần quyền quản trị.', 403);
  const table = { category: 'categories', coupon: 'coupons', banner: 'banners' }[kind];
  const key = kind === 'coupon' ? 'code' : 'id';
  if (!store.db[table].some(row => row[key] === id)) throw new AppError('Không tìm thấy dữ liệu cần xóa.', 404);
  if (kind === 'category' && (store.db.products.some(p => p.category === id) || store.db.coupons.some(c => c.category === id)))
    throw new AppError('Danh mục còn sản phẩm hoặc mã giảm giá. Hãy chuyển chúng sang danh mục khác trước khi xóa.', 409);
  if (kind === 'coupon' && store.db.orders.some(o => o.coupon === id))
    throw new AppError('Mã đã gắn với đơn hàng. Hãy tắt mã để giữ lịch sử sử dụng.', 409);
  store.db[table] = store.db[table].filter(row => row[key] !== id);
  await store.audit(actor, `delete_${kind}`, id);
  store.save();
}
