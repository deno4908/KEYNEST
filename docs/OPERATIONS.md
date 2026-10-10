# Backend vận hành: migration 008

Chạy `008_operations.sql` sau 001–007. Demo tự bổ sung các collection khi khởi động. Các endpoint dưới đây dùng prefix `/api`, cookie đăng nhập; POST bắt buộc Origin đúng và `X-App-Request: keynest`.

| API | Chức năng |
| --- | --- |
| GET `/admin/customers` | Khách hàng, tìm `q` theo email; trạng thái khóa và lý do |
| GET `/admin/orders` | Đơn, người mua và tên/số lượng sản phẩm; không trả key |
| GET `/admin/tickets` | Hỗ trợ/bảo hành, người gửi, trạng thái, mức ưu tiên |
| POST `/admin/customers/:id/access` | `{suspended:boolean,reason:string}`; lý do 10–1000 ký tự |
| POST `/admin/inventory/:id/discard` | ID mã kho, `{reason:string}`; chỉ loại mã chưa gắn với đơn, giảm stock và ghi audit |
| GET `/me/sessions` | Tối đa 100 phiên từng truy cập API tài khoản; cờ current, thời điểm ghi nhận, user agent, trạng thái thu hồi |
| POST `/me/sessions/revoke` | `{id:UUID}` hoặc `{others:true}`; chỉ phiên của chính người dùng |
| GET `/notifications` | Inbox, phân trang, `unread=1` để lọc chưa đọc; tổng chưa đọc |
| POST `/notifications/read` | `{id:string}` hoặc `{all:true}`; chỉ thông báo của chính người dùng |

Danh sách admin và inbox có `page` mặc định 1, `page_size` mặc định 25, tối đa 100; trả `{items,total,page,page_size,pages}`. Admin orders tìm `q` theo mã đơn, tickets theo tiêu đề. Orders/tickets nhận `user_id`, `status`, `from`, `to` (ISO UTC); tickets nhận thêm `kind=support|warranty`, `priority=low|normal|high`. Không nhận trường tùy ý. Chi tiết đơn/ticket và inventory phân trang có sẵn ở endpoint tương ứng.

Customer UI nằm ở Admin → Khách hàng; inbox ở Tài khoản → Tổng quan; phiên ở Tài khoản → Đăng nhập & bảo mật. Trang danh sách đơn/hỗ trợ cũ vẫn dùng overview; API phân trang mới sẵn sàng cho các màn hình này. Loại mã kho hiện cung cấp qua API quản trị.

Khóa chỉ áp dụng khách hàng; không cho khóa admin hay tự nâng role. Nó chặn API đã xác thực và thu hồi phiên đã đăng ký trong registry. Mở khóa không phục hồi các phiên đã bị thu hồi. Đơn/số dư/lịch sử được giữ nguyên. Một request đã vượt kiểm tra trước thời điểm khóa có thể hoàn tất; thao tác khóa không hoàn tác giao dịch đang thực thi.

Supabase session ID chỉ đọc sau khi `getUser` xác minh access token; registry lưu hash ID, không lưu token. Refresh không làm sống lại phiên đã bị thu hồi trên backend. Thu hồi ở đây áp dụng API KEYNEST, không thay thế cơ chế hủy phiên tại Supabase Auth hoặc RLS trực tiếp. Registry chỉ ghi nhận phiên từng gọi API đã xác thực, không liệt kê mọi thiết bị của nhà cung cấp OAuth. Không suy diễn phiên có trong danh sách là còn online.

Notification SQL trigger ghi cùng transaction với đơn hàng thay đổi trạng thái, phản hồi admin và nạp ví thành công. Không đưa key/password vào thông báo. Demo tổng hợp thông báo từ dữ liệu hiện tại khi mở inbox và lưu trạng thái đọc; không tái tạo mọi chuyển trạng thái lịch sử. Dữ liệu trước migration không được backfill. Đây là inbox trong web, chưa có email/push hay websocket.

`account_controls`, `app_sessions`, `notifications` chỉ service role được truy cập; API áp dụng ownership. RPC thay đổi access/loại inventory kiểm tra actor admin, ghi audit và thực hiện transaction. Loại inventory khóa variant trước inventory theo thứ tự của checkout, không được xóa key đang giữ cho đơn, đã giao hoặc đã hoàn.
