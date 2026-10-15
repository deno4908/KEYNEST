export function PreorderNote({
  item,
}: {
  item: { is_preorder?: boolean; expected_delivery?: string | null; delivered_at?: string | null };
}) {
  if (!item.is_preorder || item.delivered_at) return null;
  const date = item.expected_delivery?.split("-").reverse().join("/");
  return (
    <p className="info-note">
      Đặt trước · Dự kiến giao {date || "đang cập nhật"}. Thanh toán trước, nhận
      sản phẩm khi cửa hàng giao hàng.
    </p>
  );
}
