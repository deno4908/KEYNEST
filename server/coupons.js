import { AppError } from "./security.js";
export const couponDefaults = {
  discount_type: "percent",
  fixed_amount: 0,
  min_subtotal: 0,
  total_limit: null,
  per_user_limit: null,
  starts_at: null,
  product_ids: [],
  category: "all",
  first_order_only: false,
};
export const usesCoupon = (o) =>
  ["pending", "processing", "completed", "refunded"].includes(o.status);
export function couponStats(coupons, orders) {
  return coupons.map((c) => {
    const used = orders.filter((o) => o.coupon === c.code && usesCoupon(o));
    return {
      ...couponDefaults,
      ...c,
      used_count: used.filter((o) => o.status !== "pending").length,
      reserved_count: used.filter((o) => o.status === "pending").length,
    };
  });
}
export function calculateCoupon(coupon, uid, items, orders, now = Date.now()) {
  const c = { ...couponDefaults, ...coupon };
  if (
    !coupon ||
    !c.active ||
    (c.starts_at && Date.parse(c.starts_at) > now) ||
    (c.expires_at && Date.parse(c.expires_at) <= now)
  )
    throw new AppError("Mã giảm giá chưa có hiệu lực hoặc đã hết hạn.");
  const used = orders.filter((o) => o.coupon === c.code && usesCoupon(o));
  if (c.total_limit !== null && used.length >= c.total_limit)
    throw new AppError("Mã giảm giá đã hết lượt sử dụng.");
  if (
    c.per_user_limit !== null &&
    used.filter((o) => o.user_id === uid).length >= c.per_user_limit
  )
    throw new AppError("Bạn đã dùng hết lượt của mã giảm giá này.");
  if (
    c.first_order_only &&
    orders.some((o) => o.user_id === uid && usesCoupon(o))
  )
    throw new AppError("Mã chỉ dành cho đơn hàng đầu tiên.");
  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  if (subtotal < c.min_subtotal)
    throw new AppError(
      `Đơn hàng cần đạt ${c.min_subtotal.toLocaleString("vi-VN")} ₫ để dùng mã.`,
    );
  const eligible = items
    .filter(
      (i) =>
        (c.category === "all" || i.category === c.category) &&
        (!c.product_ids.length || c.product_ids.includes(i.product_id)),
    )
    .reduce((sum, i) => sum + i.price * i.quantity, 0);
  if (!eligible)
    throw new AppError("Mã không áp dụng cho sản phẩm trong giỏ hàng.");
  const discount = Math.min(
    eligible,
    Math.max(0, subtotal - 1000),
    c.discount_type === "fixed"
      ? c.fixed_amount
      : Math.min(Math.floor((eligible * c.percent) / 100), c.max_discount),
  );
  if (!discount)
    throw new AppError("Giá trị đơn chưa đủ để áp dụng mã giảm giá.");
  return { code: c.code, subtotal, discount, total: subtotal - discount };
}
