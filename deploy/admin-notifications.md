# Thông báo công việc cho admin

Sau khi cập nhật ứng dụng, chạy các migration còn thiếu theo thứ tự, gồm
`053_checkout_cart.sql` và `054_admin_event_notifications.sql` trong Supabase SQL Editor.
Migration 054 tạo thông báo trong cùng giao dịch với nghiệp vụ, không cần bật
Supabase Realtime hay cấp thêm quyền cho trình duyệt.

Admin nhận thông báo khi:

- Có yêu cầu hỗ trợ/bảo hành mới hoặc khách/seller gửi thêm trao đổi hỗ trợ.
- Có đơn đặt trước chờ thanh toán và khi đơn đã thanh toán.
- Có đơn hàng thanh toán thành công, kèm nhắc giao thủ công nếu cần.
- Sản phẩm seller mới hoặc nội dung sửa đổi đang chờ duyệt.
- Seller gửi yêu cầu rút tiền.
- Có yêu cầu hoàn tiền sản phẩm cần theo dõi/can thiệp.
- Có giao dịch thanh toán cần đối soát.

Mỗi admin đang hoạt động có bản thông báo riêng. Đánh dấu đã đọc ở tài khoản này
không ảnh hưởng admin khác; đọc lại hoặc gửi lại nghiệp vụ không tạo bản trùng.
Migration bổ sung thông báo cho công việc hiện còn chờ trước lúc cập nhật.

Avatar admin đếm tất cả thông báo chưa đọc, tối đa hiển thị `99+`, tự cập nhật
10 giây một lần khi tab đang mở và cập nhật khi quay lại tab. Xem và đánh dấu
đã đọc tại **Tài khoản → Tổng quan → Thông báo mới**. Bấm liên kết công việc
không tự đánh dấu đã đọc. Các liên kết mở đúng mục quản trị và chi tiết đơn/yêu cầu.

Kiểm tra đã thực hiện bằng PostgreSQL cục bộ, API demo và trình duyệt. Cần áp dụng
migration trên Supabase và cập nhật ứng dụng trên VPS để có hiệu lực production.
