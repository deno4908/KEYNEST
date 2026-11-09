import { randomUUID } from "node:crypto";
import { AppError } from "./security.js";
import { z } from 'zod';

export const conversationInput = z.object({
  action: z.enum(['message', 'request', 'agree', 'reject', 'refund']),
  body: z.string().trim().max(3000).default(''),
  request_id: z.uuid().optional(),
}).strict();

export function itemPaidAmount(order, itemId) {
  let cumulative = 0n;
  for (const item of [...order.items].sort((a,b) => a.id.localeCompare(b.id))) {
    const previous = cumulative;
    cumulative += BigInt(item.price) * BigInt(item.quantity);
    if (item.id === itemId) return order.subtotal ? Number(cumulative * BigInt(order.total) / BigInt(order.subtotal) - previous * BigInt(order.total) / BigInt(order.subtotal)) : 0;
  }
  throw new AppError('Không tìm thấy sản phẩm.', 404);
}

function refundItem(store, order, item, dispute, actor, reason) {
  if (!['processing','completed'].includes(order.status) || !order.paid_at || item.refunded_at || item.seller_reversed_at || item.seller_settled_at || dispute.amount !== itemPaidAmount(order,item.id)) throw new AppError('Sản phẩm không thể hoàn tiền hoặc đã hoàn trước đó.',409);
  const now = new Date().toISOString();
  const buyer = store.db.users.find(u => u.id === order.user_id);
  buyer.balance += dispute.amount;
  store.db.ledger.unshift({id:randomUUID(),user_id:buyer.id,amount:dispute.amount,description:`Hoàn sản phẩm ${order.number} · ${item.name} · ${item.id}`,created_at:now});
  Object.assign(item,{refund_amount:dispute.amount,refunded_at:now,seller_reversed_at:now});
  Object.assign(dispute,{status:'refunded',resolution:reason,resolved_at:now});
  if (order.items.every(i=>i.refunded_at)) Object.assign(order,{status:'refunded',refunded_at:now,refund_method:'wallet',refund_reason:reason,refund_ticket_id:dispute.ticket_id,refunded_by:actor});
  else if (order.status==='processing' && order.items.every(i=>i.delivered_at || i.refunded_at)) order.status='completed';
  const ticket = store.db.tickets.find(t=>t.id===dispute.ticket_id);
  if (ticket) Object.assign(ticket,{status:'closed',reply:reason,updated_at:now});
  store.db.notifications ||= [];
  for (const n of store.db.notifications) if ([`seller-refund:${item.id}`,`seller-refund:${order.id}`].includes(n.id)) n.read_at ||= now;
  for (const uid of [buyer.id,item.seller_id]) store.db.notifications.push({id:`seller-refund:done:${item.id}:${uid}`,user_id:uid,title:`Đã hoàn tiền sản phẩm · ${order.number}`,body:`${item.name} · ${dispute.amount} ₫ đã hoàn vào ví người mua.`,href:uid===buyer.id?`/orders/${order.id}`:'/seller?tab=sales',created_at:now});
  store.audit(actor,'refund_item_wallet',item.id);
}

// Authentication/MFA is enforced by the router; ownership is checked again here.
export async function sellerConversation(
  store,
  actor,
  itemId,
  action = "read",
  body = "",
  requestId = null,
) {
  if (!store.db)
    return store.query(
      store.client.rpc("seller_conversation", {
        p_actor: actor,
        p_item: itemId,
        p_action: action,
        p_body: body,
        p_request: requestId,
      }),
    );
  const db = store.db;
  db.seller_chat_messages ||= [];
  db.seller_disputes ||= [];
  const user = db.users.find((u) => u.id === actor);
  const order = db.orders.find((o) => o.items.some((i) => i.id === itemId));
  const item = order?.items.find((i) => i.id === itemId);
  if (
    !user ||
    db.account_controls?.some((c) => c.user_id === actor && c.suspended) ||
    !item?.seller_id ||
    db.users.some((u) => u.id === item.seller_id && u.role === "admin") ||
    (actor !== order.user_id &&
      actor !== item.seller_id &&
      user.role !== "admin")
  )
    throw new AppError("Không có quyền truy cập cuộc trò chuyện.", 403);
  const deadline = item.delivered_at
    ? new Date(Date.parse(item.delivered_at) + 48 * 3600000).toISOString()
    : null;
  const canRequest =
    (actor === order.user_id || (actor === item.seller_id && user.role !== 'admin')) &&
    ["processing", "completed"].includes(order.status) &&
    !!order.paid_at && !item.refunded_at &&
    !item.seller_settled_at &&
    !item.seller_reversed_at &&
    (!deadline || Date.parse(deadline) > Date.now());
  let dispute = db.seller_disputes.find((d) => d.item_id === itemId);
  if (action === "message") {
    if (user.role === 'admin' && actor !== order.user_id) throw new AppError('Quản trị viên chỉ được xem cuộc trò chuyện. Hãy phản hồi qua yêu cầu hỗ trợ.', 403);
    if (
      !body.trim() ||
      body.length > 3000 ||
      !requestId
    )
      throw new AppError("Tin nhắn không hợp lệ.");
    const existing = db.seller_chat_messages.find(
      (m) => m.author_id === actor && m.request_id === requestId,
    );
    if (
      existing &&
      (existing.item_id !== itemId || existing.body !== body.trim())
    )
      throw new AppError("Mã gửi đã được sử dụng.", 409);
    if (!existing) {
      const id = randomUUID();
      db.seller_chat_messages.push({
        id,
        item_id: itemId,
        author_id: actor,
        body: body.trim(),
        request_id: requestId,
        created_at: new Date().toISOString(),
      });
      db.notifications ||= [];
      const incoming = new Set(db.seller_chat_messages
        .filter(m => m.item_id === itemId && m.author_id !== actor)
        .map(m => `seller-chat:${m.id}`));
      for (const notice of db.notifications) {
        if (notice.user_id === actor && !notice.read_at && incoming.has(notice.id)) {
          notice.read_at = new Date().toISOString();
        }
      }
      db.notifications.push({
        id: `seller-chat:${id}`,
        user_id: actor === order.user_id ? item.seller_id : order.user_id,
        title: `Tin nhắn mới · ${order.number} · ${item.name}`,
        href:
          actor === order.user_id ? "/seller?tab=sales" : `/orders/${order.id}`,
        created_at: new Date().toISOString(),
      });
    }
  } else if (action === "request") {
    if (!canRequest || dispute || body.trim().length < 10 || body.length > 2000)
      throw new AppError(
        "Không thể yêu cầu hoàn tiền. Kiểm tra thời hạn hoặc liên hệ hỗ trợ.",
        409,
      );
    let ticket = db.tickets.find(
      (t) =>
        t.refund_item_id === itemId &&
        t.kind === "warranty" &&
        ["open", "in_progress"].includes(t.status),
    );
    if (!ticket) {
      ticket = {
        id: randomUUID(),
        order_id: order.id,
        refund_item_id: itemId,
        user_id: order.user_id,
        kind: "warranty",
        subject: `Hoàn tiền sản phẩm · ${item.name} · ${order.number}`,
        message: body.trim(),
        status: "open",
        priority: "normal",
        reply: "",
        messages: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      db.tickets.push(ticket);
    }
    dispute = {
      order_id: order.id,
      item_id: itemId,
      requested_by: actor,
      seller_id: item.seller_id,
      ticket_id: ticket.id,
      reason: body.trim(),
      amount: itemPaidAmount(order,itemId),
      status: "open",
      resolution: "",
      created_at: new Date().toISOString(),
    };
    db.seller_disputes.push(dispute);
    db.notifications ||= [];
    db.notifications.push({
      id: `seller-refund:${itemId}`,
      user_id: actor === order.user_id ? item.seller_id : order.user_id,
      title: `Yêu cầu hoàn tiền · ${order.number} · ${item.name}`,
      body: body.trim(),
      href: actor === order.user_id ? '/seller?tab=sales' : `/orders/${order.id}`,
      created_at: new Date().toISOString(),
    });
  } else if (["agree", "reject", "refund"].includes(action)) {
    if (action !== 'agree' && (user.role !== 'admin' || [order.user_id,item.seller_id].includes(actor))) throw new AppError('Cần quản trị viên không tham gia đơn hàng.',403);
    if (
      !dispute ||
      dispute.item_id !== itemId ||
      !["open", "agreed"].includes(dispute.status)
    )
      throw new AppError("Yêu cầu đã xử lý hoặc không tồn tại.", 409);
    if (action === "agree") {
      if (
        actor === dispute.requested_by ||
        ![order.user_id, dispute.seller_id].includes(actor)
      )
        throw new AppError("Chỉ bên còn lại được xác nhận đồng ý.", 403);
      if (Date.parse(dispute.created_at) + 48 * 3600000 <= Date.now()) throw new AppError('Yêu cầu quá 48 giờ, vui lòng chờ admin xử lý.',409);
      dispute.amount ??= itemPaidAmount(order,itemId);
      // refundItem validates before mutating balances or state.
      refundItem(store,order,item,dispute,actor,'Hai bên đã đồng ý. Đã hoàn tiền sản phẩm vào ví người mua.');
      dispute.agreed_by = actor;
    } else {
      if (
        user.role !== "admin" ||
        body.trim().length < 10 ||
        body.length > 2000
      )
        throw new AppError("Cần quản trị viên và lý do xử lý.", 403);
      if (action === 'refund') {
        dispute.amount ??= itemPaidAmount(order,itemId);
        refundItem(store,order,item,dispute,actor,body.trim());
      }
      Object.assign(dispute, {
        status: action === "refund" ? "refunded" : "rejected",
        resolution: body.trim(),
        resolved_at: new Date().toISOString(),
      });
      store.audit(actor, `seller_dispute_${action}`, order.id);
      if (action === 'reject') {
        const ticket = db.tickets.find(t=>t.id===dispute.ticket_id);
        if(ticket) Object.assign(ticket,{status:'closed',reply:body.trim(),updated_at:new Date().toISOString()});
      }
    }
  } else if (action !== "read") throw new AppError("Thao tác không hợp lệ.");
  if (action !== "read") store.save();
  return {
    item_id: itemId,
    name: item.name,
    variant_name: item.variant_name,
    quantity: item.quantity,
    refund_amount: dispute?.amount ?? itemPaidAmount(order,itemId),
    seller_name: item.seller_name,
    order_number: order.number,
    order_status: order.status,
    order_total: order.total,
    seller_hold_until: deadline,
    seller_settled_at: item.seller_settled_at,
    can_request: canRequest && !dispute,
    can_message: actor === order.user_id || (actor === item.seller_id && user.role !== 'admin'),
    viewer_role: actor === order.user_id ? 'customer' : user.role === 'admin' ? 'admin' : 'seller',
    dispute: dispute
      ? dispute.item_id !== itemId &&
        actor !== order.user_id &&
        user.role !== "admin"
        ? { status: dispute.status, can_agree: false }
        : {
            ...dispute,
            amount: dispute.amount ?? itemPaidAmount(order,itemId),
            response_due_at: new Date(Date.parse(dispute.created_at)+48*3600000).toISOString(),
            needs_admin: ['open','agreed'].includes(dispute.status) && Date.parse(dispute.created_at)+48*3600000<=Date.now(),
            can_resolve: user.role==='admin' && ![order.user_id,item.seller_id].includes(actor),
            can_agree:
              dispute.status === 'open' && Date.parse(dispute.created_at)+48*3600000>Date.now() &&
              dispute.item_id === itemId &&
              actor !== dispute.requested_by &&
              [order.user_id, dispute.seller_id].includes(actor),
          }
      : null,
    messages: db.seller_chat_messages
      .filter((m) => m.item_id === itemId)
      .slice(-200)
      .map(({ id, body, created_at, author_id }) => ({
        id,
        body,
        created_at,
        role: author_id === order.user_id ? "customer" : "seller",
      })),
  };
}
