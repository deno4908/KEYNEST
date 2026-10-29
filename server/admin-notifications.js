import { createHash } from 'node:crypto';

// Demo equivalent of migration 054. Persist alongside the business change, never
// recreate a read notification, and give each administrator their own receipt.
export function syncAdminNotifications(db) {
  const admins = (db.users || []).filter(u => u.role === 'admin' &&
    !db.account_controls?.some(c => c.user_id === u.id && c.suspended));
  db.notifications ||= [];
  const known = new Set(db.notifications.map(n => n.id));
  const now = new Date().toISOString();
  function add(key, title, body, href, created_at = now, exclude) {
    for (const admin of admins) {
      const id = `admin:${key}:${admin.id}`;
      if (admin.id === exclude || known.has(id)) continue;
      db.notifications.push({ id, user_id: admin.id, title, body, href, created_at: created_at || now, read_at: null });
      known.add(id);
    }
  }
  for (const t of db.tickets || []) {
    if (t.deleted_at) continue;
    if (!t.refund_item_id && ['open', 'in_progress'].includes(t.status))
      add(`ticket:${t.id}`, `${t.kind === 'warranty' ? 'Yêu cầu bảo hành mới' : 'Yêu cầu hỗ trợ mới'} · ${t.subject}`,
        'Có yêu cầu cần kiểm tra và phản hồi.', `/admin?tab=tickets&ticket=${t.id}`, t.created_at);
    for (const m of t.messages || []) if (['customer', 'seller'].includes(m.role))
      add(`ticket-message:${m.id}`, `Phản hồi hỗ trợ mới · ${t.subject}`, 'Khách hàng hoặc người bán vừa gửi thêm trao đổi.',
        `/admin?tab=tickets&ticket=${t.id}`, m.created_at, m.author_id);
  }
  for (const o of db.orders || []) {
    const preorder = o.items.some(i => i.is_preorder);
    if (preorder && o.status === 'pending')
      add(`preorder:${o.id}`, `Đơn đặt trước mới · ${o.number}`, 'Khách đã đặt trước, đang chờ thanh toán.',
        `/admin?tab=orders&order=${o.id}`, o.created_at);
    if (o.paid_at && ['processing', 'completed'].includes(o.status))
      add(`order-paid:${o.id}`, `${preorder ? 'Đơn đặt trước đã thanh toán' : 'Đơn hàng đã thanh toán'} · ${o.number}`,
        o.items.some(i => i.delivery === 'manual' && !i.delivered_at && !i.refunded_at) ? 'Có sản phẩm cần giao thủ công. Kiểm tra thông tin và thời gian giao hàng.' : 'Đơn hàng đã được ghi nhận thanh toán.',
        `/admin?tab=orders&order=${o.id}`, o.paid_at);
  }
  for (const p of db.products || []) if (p.seller_id && (p.review_status || 'pending') === 'pending')
    add(`product-review:${p.id}:${p.review_version || 1}`, `Sản phẩm chờ duyệt · ${p.name}`,
      'Người bán đã gửi sản phẩm hoặc cập nhật nội dung cần kiểm tra lại.', '/admin?tab=products');
  for (const w of db.seller_withdrawals || []) if (w.status === 'pending')
    add(`withdrawal:${w.id}`, 'Yêu cầu rút tiền của người bán', `${w.amount} ₫ đang chờ xét duyệt.`, '/admin?tab=sellers', w.created_at);
  for (const d of db.seller_disputes || []) if (['open', 'agreed'].includes(d.status))
    add(`dispute:${d.item_id}`, 'Yêu cầu hoàn tiền sản phẩm', 'Hai bên đang trao đổi. Admin có thể can thiệp sớm; cần kiểm tra nếu quá 48 giờ.',
      '/admin?tab=sellers', d.created_at);
  for (const e of db.events || []) if (e.outcome === 'needs_review')
    add(`payment-review:${createHash('md5').update(String(e.transaction_id)).digest('hex')}`, 'Thanh toán cần đối soát',
      `${e.amount} ₫ chưa được tự động đối soát. Kiểm tra trước khi ghi có.`, '/admin?tab=payments', e.created_at);
}
