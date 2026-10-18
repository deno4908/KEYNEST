import { randomUUID } from "node:crypto";
import { AppError } from "./security.js";

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
    user.role !== "admin" &&
    ["processing", "completed"].includes(order.status) &&
    !item.seller_settled_at &&
    !item.seller_reversed_at &&
    (!deadline || Date.parse(deadline) > Date.now());
  let dispute = db.seller_disputes.find((d) => d.order_id === order.id);
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
        t.order_id === order.id &&
        t.kind === "warranty" &&
        ["open", "in_progress"].includes(t.status),
    );
    if (!ticket) {
      ticket = {
        id: randomUUID(),
        order_id: order.id,
        user_id: order.user_id,
        kind: "warranty",
        subject: `Yêu cầu hoàn tiền ${order.number}`,
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
      status: "open",
      resolution: "",
      created_at: new Date().toISOString(),
    };
    db.seller_disputes.push(dispute);
  } else if (["agree", "reject", "refund"].includes(action)) {
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
      dispute.status = "agreed";
    } else {
      if (
        user.role !== "admin" ||
        body.trim().length < 10 ||
        body.length > 2000
      )
        throw new AppError("Cần quản trị viên và lý do xử lý.", 403);
      if (action === "refund")
        store.refund(order.id, {
          actor,
          ticket_id: dispute.ticket_id,
          method: "wallet",
          reason: body.trim(),
          reference: "",
        });
      Object.assign(dispute, {
        status: action === "refund" ? "refunded" : "rejected",
        resolution: body.trim(),
        resolved_at: new Date().toISOString(),
      });
      store.audit(actor, `seller_dispute_${action}`, order.id);
    }
  } else if (action !== "read") throw new AppError("Thao tác không hợp lệ.");
  if (action !== "read") store.save();
  return {
    item_id: itemId,
    name: item.name,
    seller_name: item.seller_name,
    order_number: order.number,
    order_status: order.status,
    order_total: order.total,
    seller_hold_until: deadline,
    seller_settled_at: item.seller_settled_at,
    can_request: canRequest,
    can_message: actor === order.user_id || (actor === item.seller_id && user.role !== 'admin'),
    viewer_role: actor === order.user_id ? 'customer' : user.role === 'admin' ? 'admin' : 'seller',
    dispute: dispute
      ? dispute.item_id !== itemId &&
        actor !== order.user_id &&
        user.role !== "admin"
        ? { status: dispute.status, can_agree: false }
        : {
            ...dispute,
            can_agree:
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
