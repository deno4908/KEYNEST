export function PreorderNote({
  item,
}: {
  item: { is_preorder?: boolean; expected_delivery?: string | null };
}) {
  if (!item.is_preorder) return null;
  const date = item.expected_delivery?.split("-").reverse().join("/");
  return (
    <p className="info-note">
      Đặt trước · Dự kiến giao {date || "đang cập nhật"}. Thanh toán trước, nhận
      sản phẩm khi cửa hàng giao hàng.
    </p>
  );
}
