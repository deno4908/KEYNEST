import { randomUUID } from 'node:crypto';
import { AppError } from './security.js';
import { requireSeller } from './seller-accounting.js';

export function createSellerNameRequests(store) {
  if (store.db) store.db.seller_name_requests ||= [];
  const notice = (user_id, id, title, body, href) => {
    store.db.notifications ||= [];
    store.db.notifications.push({ user_id, id, title, body, href, created_at: new Date().toISOString() });
  };
  return {
    async latest(uid) {
      if (store.db) return store.db.seller_name_requests.find(r => r.user_id === uid) || null;
      const rows = await store.query(store.client.from('seller_name_requests').select('*')
        .eq('user_id', uid).order('created_at', { ascending: false }).order('id').limit(1));
      return rows[0] || null;
    },
    async pending() {
      if (store.db) return store.db.seller_name_requests.filter(r => r.status === 'pending');
      return store.completeQuery(store.client.from('seller_name_requests').select('*')
        .eq('status', 'pending').order('created_at').order('id'));
    },
    async submit(uid, name) {
      if (!store.db) return store.query(store.client.rpc('request_seller_name', { p_actor: uid, p_name: name }));
      const user = store.db.users.find(u => u.id === uid);
      requireSeller(user);
      if (store.db.account_controls?.some(c => c.user_id === uid && c.suspended)) throw new AppError('Tài khoản đang bị khóa.', 403);
      name = name.trim();
      if (name.length < 2 || name.length > 80) throw new AppError('Tên gian hàng cần từ 2 đến 80 ký tự.');
      const pending = store.db.seller_name_requests.find(r => r.user_id === uid && r.status === 'pending');
      if (pending) {
        if (pending.requested_name === name) return pending;
        throw new AppError('Bạn đã có yêu cầu đổi tên đang chờ duyệt.', 409);
      }
      if (name === (user.seller_name || user.name)) throw new AppError('Tên mới trùng với tên đang hiển thị.', 409);
      const request = { id: randomUUID(), user_id: uid, current_name: user.seller_name || user.name,
        requested_name: name, status: 'pending', reason: '', created_at: new Date().toISOString(), resolved_at: null, resolved_by: null };
      store.db.seller_name_requests.unshift(request);
      for (const admin of store.db.users.filter(u => u.role === 'admin' && !store.db.account_controls?.some(c => c.user_id === u.id && c.suspended))) {
        notice(admin.id, `admin:seller-name:${request.id}:${admin.id}`, 'Yêu cầu đổi tên gian hàng',
          `${request.current_name} → ${name}`, '/admin?tab=sellers');
      }
      store.audit(uid, 'seller_name_requested', request.id);
      store.save();
      return request;
    },
    async review(actor, id, status, reason) {
      if (!store.db) return store.query(store.client.rpc('review_seller_name', {
        p_actor: actor, p_request: id, p_status: status, p_reason: reason,
      }));
      const admin = store.db.users.find(u => u.id === actor);
      if (admin?.role !== 'admin' || store.db.account_controls?.some(c => c.user_id === actor && c.suspended)) throw new AppError('Cần quyền quản trị.', 403);
      const request = store.db.seller_name_requests.find(r => r.id === id);
      if (!request || request.status !== 'pending') throw new AppError('Yêu cầu đã được xử lý hoặc không tồn tại.', 409);
      if (!['approved', 'rejected'].includes(status) || (status === 'rejected' && reason.trim().length < 3)) throw new AppError('Nhập kết quả và lý do xét duyệt hợp lệ.');
      const seller = store.db.users.find(u => u.id === request.user_id);
      if (status === 'approved') {
        requireSeller(seller);
        if (store.db.account_controls?.some(c => c.user_id === seller.id && c.suspended)) throw new AppError('Tài khoản người bán đang bị khóa.', 409);
        if ((seller.seller_name || seller.name) !== request.current_name) throw new AppError('Tên hiện tại đã thay đổi. Không thể duyệt yêu cầu cũ.', 409);
        seller.seller_name = request.requested_name;
      }
      Object.assign(request, { status, reason: reason.trim(), resolved_at: new Date().toISOString(), resolved_by: actor });
      notice(request.user_id, `seller-name:${request.id}`, status === 'approved' ? 'Tên gian hàng đã được duyệt' : 'Yêu cầu đổi tên chưa được duyệt',
        status === 'approved' ? `Tên mới: ${request.requested_name}` : reason.trim(), '/seller?tab=profile');
      store.audit(actor, `seller_name_${status}`, id);
      store.save();
      return request;
    },
  };
}
