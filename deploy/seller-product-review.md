# Admin duyệt hàng của seller

Chạy migration `045_seller_product_review.sql` trước khi triển khai ứng dụng.

Migration đưa cả sản phẩm seller đang bán về chờ duyệt và ẩn khỏi cửa hàng. Sản phẩm của cửa hàng không có seller_id không bị ảnh hưởng. Đơn đã mua vẫn giữ nguyên.

Trong Admin → Sản phẩm, chọn Quản lý để kiểm tra thông tin/gói bán, kiểm tra hàng của seller trước khi chọn Duyệt mở bán. Từ chối phải có lý do ít nhất 10 ký tự, seller nhìn thấy lý do trong danh sách sản phẩm. Đây là quyết định kiểm hàng của admin, không phải hệ thống tự xác minh chất lượng hàng.

Sửa nội dung sản phẩm, thêm/sửa/xóa gói, nhập mã mới hoặc thay key dùng chung sẽ ẩn sản phẩm và yêu cầu duyệt lại. Thay đổi tồn kho do mua hàng không làm mất trạng thái đã duyệt. Seller có thể ẩn/mở sản phẩm đã được duyệt, nhưng không thể tự duyệt sản phẩm.

Lần duyệt dùng phiên bản dữ liệu đang xem. Nếu sản phẩm hoặc hàng đã thay đổi, tải lại và kiểm tra trước khi duyệt lại. Kết quả duyệt/từ chối được ghi audit log.

Chạy thêm `046_seller_review_notifications.sql` để gửi thông báo trong website cho seller khi duyệt/từ chối. Thông báo ghi cùng giao dịch với kết quả duyệt, có tên sản phẩm, lý do từ chối và liên kết về mục Sản phẩm. Không gửi email và không gửi bù các lần duyệt trước migration. Lặp cùng trạng thái/lý do không tạo thông báo mới; duyệt lại sau khi sửa hàng sẽ có thông báo mới.
