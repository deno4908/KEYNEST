// Stable event IDs are shared by demo producers and database triggers (all roles).
// Keep filtering in PostgreSQL so pagination/counts describe the whole inbox.
export const notificationGroups = {
  orders: [
    "order:",
    "seller-chat:",
    "seller-refund:",
    "admin:preorder:",
    "admin:order-paid:",
    "admin:dispute:",
  ],
  payments: ["topup:", "admin:payment-review:", "admin:withdrawal:"],
  support: [
    "reply:",
    "seller-reply:",
    "admin:ticket:",
    "admin:ticket-message:",
  ],
  catalog: ["seller-review:", "admin:product-review:"],
  announcements: ["campaign:"],
};
const labels = {
  orders: "Đơn hàng & trao đổi",
  payments: "Thanh toán & số dư",
  support: "Hỗ trợ",
  catalog: "Sản phẩm & kiểm duyệt",
  announcements: "Tin cửa hàng",
  system: "Khác",
};
export function noticeCategory(id) {
  return (
    Object.entries(notificationGroups).find(([, prefixes]) =>
      prefixes.some((p) => id.startsWith(p)),
    )?.[0] || "system"
  );
}
export function enrichNotice(notice) {
  const category = noticeCategory(notice.id);
  // Only internal application paths are actionable, including legacy records.
  const href =
    typeof notice.href === "string" &&
    /^\/(?!\/)/.test(notice.href) &&
    !/[\\\u0000-\u0020]/.test(notice.href)
      ? notice.href
      : "/notifications";
  const statusLabels = {
    pending: "Chờ thanh toán",
    processing: "Đang xử lý",
    completed: "Hoàn thành",
    refunded: "Đã hoàn tiền",
    cancelled: "Đã hủy",
    expired: "Hết hạn",
  };
  const title = notice.id.startsWith("order:")
    ? notice.title.replace(
        /: (pending|processing|completed|refunded|cancelled|expired)$/,
        (_, s) => `: ${statusLabels[s]}`,
      )
    : notice.title;
  return { ...notice, title, href, category, category_label: labels[category] };
}
export function filterNoticeQuery(query, category) {
  if (!category || category === "all") return query;
  if (category === "system") {
    for (const prefix of Object.values(notificationGroups).flat())
      query = query.not("id", "like", `${prefix}%`);
    return query;
  }
  return query.or(
    notificationGroups[category].map((p) => `id.like.${p}%`).join(","),
  );
}
