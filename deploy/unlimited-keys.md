# Gói vô hạn dùng chung key

Chạy migration `042_unlimited_shared_key.sql` sau 041, rồi triển khai bản mới.

Trong quản trị hoặc seller: sửa sản phẩm → Thêm gói → Cách giao → **Giao cùng một key · Không giới hạn**. Nhập key/link/dữ liệu dùng chung và lưu. Không cần nhập kho mã; mỗi đơn thanh toán thành công nhận cùng nội dung.

Mỗi lần mua vẫn giới hạn tối đa 10 đơn vị như các gói khác, nhưng không giới hạn tổng số lần bán. Dữ liệu dùng chung được lưu mã hóa ở bảng riêng, không xuất hiện trong API danh sách sản phẩm. Đơn đã tạo giữ bản dữ liệu của thời điểm tạo đơn; chỉnh key chỉ áp dụng cho đơn mới. Email biên nhận sử dụng dữ liệu của từng đơn.

Khi sửa gói, để trống ô key để giữ dữ liệu hiện tại. Dùng nút Ẩn để ngừng bán. Muốn đổi giữa kho hữu hạn và vô hạn, tạo gói mới để giữ lịch sử kho chính xác.
