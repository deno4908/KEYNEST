import { randomUUID } from "node:crypto";
import { AppError } from "./security.js";
import { SELLER_TERMS_VERSION } from "../shared/seller-terms.js";

export function requireSeller(user) {
  if (user?.role !== "seller") throw new AppError("Cần quyền người bán.", 403);
  if (user.seller_terms_version !== SELLER_TERMS_VERSION)
    throw new AppError(
      "Hoàn tất hồ sơ và chấp nhận điều khoản người bán trước khi bán hàng.",
      403,
    );
}
export const sellerPublic = (user) =>
  user
    ? {
        id: user.id,
        name: user.seller_name || user.name,
      }
    : null;
export function snapshotSeller(store, product, buyer) {
  if (!product.seller_id) return {};
  const seller = store.db.users.find((user) => user.id === product.seller_id);
  requireSeller(seller);
  if (
    store.db.account_controls?.some(
      (c) => c.user_id === seller.id && c.suspended,
    )
  )
    throw new AppError("Người bán đang bị khóa.", 409);
  if (seller.id === buyer)
    throw new AppError("Không thể mua sản phẩm của chính mình.", 409);
  return {
    seller_id: seller.id,
    seller_name: seller.seller_name || seller.name,
    seller_fee_bps: store.db.seller_fee_bps ?? 700,
  };
}
export function settleSellerRevenue(store, order, reverse = false) {
  const items = [...order.items].sort((a, b) => a.id.localeCompare(b.id));
  let cumulative = 0;
  for (const item of items) {
    const previous = cumulative;
    cumulative += item.price * item.quantity;
    if (!item.seller_id) continue;
    const user = store.db.users.find((user) => user.id === item.seller_id);
    if (!user) throw new AppError("Không tìm thấy người bán.", 409);
    let amount;
    if (reverse) {
      if (item.seller_reversed_at) continue;
      if (!item.seller_settled_at) {
        item.seller_reversed_at = new Date().toISOString();
        continue;
      }
      for (const withdrawal of store.db.seller_withdrawals || []) {
        if (withdrawal.user_id !== user.id || withdrawal.status !== "pending")
          continue;
        withdrawal.status = "cancelled";
        withdrawal.reason = "Hủy để đối soát hoàn tiền đơn hàng.";
        withdrawal.resolved_at = new Date().toISOString();
        user.balance += withdrawal.amount;
        store.db.ledger.unshift({
          id: randomUUID(),
          user_id: user.id,
          amount: withdrawal.amount,
          description: `Hủy yêu cầu rút ${withdrawal.id} để đối soát`,
          created_at: new Date().toISOString(),
        });
      }
      const recovered = Math.min(user.balance, item.seller_net);
      user.balance -= recovered;
      user.seller_debt = (user.seller_debt || 0) + item.seller_net - recovered;
      item.seller_reversed_at = new Date().toISOString();
      amount = -recovered;
    } else {
      if (
        item.seller_settled_at ||
        !["processing", "completed"].includes(order.status)
      )
        continue;
      const gross = order.subtotal
        ? Number(
            (BigInt(cumulative) * BigInt(order.total)) /
              BigInt(order.subtotal) -
              (BigInt(previous) * BigInt(order.total)) / BigInt(order.subtotal),
          )
        : 0;
      const fee = Number(
        (BigInt(gross) * BigInt(item.seller_fee_bps)) / 10000n,
      );
      item.seller_gross = gross;
      item.seller_fee = fee;
      item.seller_net = gross - fee;
      // Old, already credited items stay credited. New revenue is never spendable
      // before delivery + 48 hours, or while an order refund is unresolved.
      item.seller_hold_until = item.delivered_at
        ? new Date(Date.parse(item.delivered_at) + 48 * 3600000).toISOString()
        : null;
      if (
        !item.seller_hold_until ||
        Date.parse(item.seller_hold_until) > Date.now() ||
        item.seller_reversed_at ||
        store.db.seller_disputes?.some(
          (d) =>
            d.order_id === order.id && ["open", "agreed"].includes(d.status),
        )
      )
        continue;
      const offset = Math.min(user.seller_debt || 0, item.seller_net);
      user.seller_debt = (user.seller_debt || 0) - offset;
      amount = item.seller_net - offset;
      user.balance += amount;
      item.seller_settled_at = new Date().toISOString();
    }
    store.db.ledger.unshift({
      id: randomUUID(),
      user_id: user.id,
      amount,
      description: `${reverse ? "Thu hồi doanh thu" : "Doanh thu sau phí / bù trừ"} ${order.number} · ${item.name}`,
      created_at: new Date().toISOString(),
    });
  }
}

export function releaseSellerFunds(store) {
  for (const order of store.db.orders) {
    if (
      ["processing", "completed"].includes(order.status) &&
      order.items.some(
        (i) => i.seller_id && !i.seller_settled_at && !i.seller_reversed_at,
      )
    )
      settleSellerRevenue(store, order);
  }
}
