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

Chuông trên thanh đầu trang đếm tất cả loại thông báo cho cả khách hàng, người
bán và admin, tối đa `99+`. Bấm chuông để xem tối đa 8 thông báo chưa đọc gần nhất;
chọn **Mở hộp thư đầy đủ** để đến `/notifications`. Tài khoản vẫn có bản xem nhanh,
kênh người bán và khu vực admin có mục hộp thư riêng dùng cùng hệ thống.

Hộp thư đầy đủ có bộ lọc chưa đọc/tất cả/đã đọc, loại sự kiện, tìm theo tiêu đề,
phân trang 12 dòng và thao tác đánh dấu đã đọc/chưa đọc. Tổng kết quả là tổng
toàn bộ bộ lọc, không chỉ số dòng trên trang. Đánh dấu tất cả đã đọc áp dụng cho
toàn bộ hộp thư cá nhân, kể cả khi đang lọc. Bấm liên kết công việc không tự đánh
dấu đã đọc. Các liên kết nội bộ được kiểm tra trước khi hiển thị.

Một bộ tải chung cập nhật chuông và bản xem nhanh mỗi 10 giây khi tab hoạt động;
tạm dừng khi tab ẩn/mất mạng và cập nhật khi trở lại. Thao tác đọc được đồng bộ
giữa các tab cùng tài khoản bằng BroadcastChannel; không gửi nội dung thông báo
qua kênh này. Chuyển tài khoản khởi tạo hộp thư mới. Lỗi đồng bộ giữ số liệu gần
nhất và hiển thị trạng thái lỗi, không biến lỗi mạng thành số chưa đọc bằng 0.

`GET /api/notifications` nhận thêm `category` và `q` (tiêu đề, tối đa 120 ký tự).
`POST /api/notifications/unread` nhận `{ "id": "..." }`. Các thao tác luôn giới
hạn theo người đăng nhập; không có quyền đọc/ghi hộp thư người khác.

Trang tổng quan admin có thống kê 7/30/90 ngày theo múi giờ Việt Nam, dữ liệu từng
ngày có thể mở dưới biểu đồ và các hàng đợi công việc hiện tại. Chỉ số giá trị đơn
không phải lợi nhuận hay doanh thu thuần. Số chưa đọc độc lập với trạng thái công
việc. Cảnh báo kho chỉ tính gói giao mã hữu hạn đang bán, không tính gói dịch vụ
hoặc kho không giới hạn. Danh sách admin tải qua nhiều trang ở cơ sở dữ liệu để
không bị cắt theo giới hạn mặc định; nhật ký vẫn là 100 hoạt động gần nhất.

Giao diện hộp thư và bộ lọc mới không cần migration bổ sung. Các nguồn sự kiện
admin vẫn yêu cầu migration 054 nêu trên. Kiểm thử bao gồm API demo, truy vấn
Supabase, cách ly tài khoản, đọc/chưa đọc, nhiều tab và trình duyệt trên điện thoại.
