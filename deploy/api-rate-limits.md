# Giới hạn API và bản vá dependency — 06/11/2026

Middleware tại `server/rate-limits.js` được gắn trước parser JSON, cookie và mọi
lời gọi xác thực/Supabase. Sau `apiAccessGuard`, các API nhạy cảm còn có ngân sách
theo ID tài khoản đã xác thực. Không lấy ID từ body/header do người gọi cung cấp.
Thay ID đơn hàng/thanh toán, viết hoa đường dẫn hoặc thêm dấu `/` cuối không tạo
ngân sách mới. Những request lỗi cũng được tính để hạn chế thử liên tục.

## Ngân sách trước parser, theo IP

| Nhóm | Giới hạn |
| --- | --- |
| API thông thường | 240 request/phút |
| Đăng nhập và các endpoint Auth không được miễn | 20 request/15 phút, dùng chung |
| Đăng ký | Thêm 5 request/15 phút |
| Quên mật khẩu | Thêm 5 request/15 phút |
| Đổi mật khẩu qua liên kết khôi phục và xác minh liên kết | Thêm 10 request/15 phút, dùng chung |
| Đăng xuất, refresh, đọc trạng thái MFA/OTP và thao tác MFA/OTP | Ngân sách riêng 60 request/phút |
| POST webhook Pay2S/SePay | Ngân sách riêng 6.000 request/phút |

Các endpoint MFA/OTP vẫn giữ giới hạn chi tiết theo tài khoản và kiểm tra bảo mật
của từng router. `/auth/password-key` chỉ chịu giới hạn API thông thường.
Webhook vẫn bắt buộc xác thực nhà cung cấp và chống ghi nhận giao dịch trùng;
ngân sách riêng không thay thế các kiểm tra đó.

## Ngân sách cho API nhạy cảm, theo tài khoản

| Nhóm | Endpoint / thao tác | Giới hạn |
| --- | --- | --- |
| Đặt hàng | POST `/orders` | 15/phút |
| Nạp ví | POST `/wallet/topup` | 10/phút |
| Kiểm tra mã giảm giá | POST `/coupons/preview` | 40/phút |
| Hủy đơn | POST `/orders/:id/cancel` | 10/phút |
| Trạng thái QR | GET/HEAD `/payments/:id` | 60/phút, chung mọi ID |
| Hồ sơ | PATCH `/me` | 10/15 phút |
| Đổi mật khẩu | POST `/me/password` | 5/15 phút |
| Rút tiền người bán | POST `/seller/withdrawals` | 5/15 phút |
| Tiền quản trị | Hoàn tiền đơn, đối soát giao dịch, duyệt/từ chối rút tiền | 10/phút, dùng chung |
| Quyền quản trị | Khóa/mở khách hàng, thay vai trò người bán, thay phí | 10/15 phút, dùng chung |
| Thao tác ghi quản trị khác | POST/PUT/PATCH/DELETE `/admin/*` | 60/phút |
| Thao tác ghi người bán khác | POST/PUT/PATCH/DELETE `/seller/*` | 30/phút |

Mỗi nhóm trên còn có giới hạn IP trước xác thực bằng `max(30, 3 × giới hạn tài
khoản)`, trong cùng cửa sổ thời gian. Ví dụ nạp ví tối đa 30/phút/IP và
10/phút/tài khoản. Giới hạn API thông thường vẫn áp dụng đồng thời. Với thao tác
khớp nhiều nhóm, nhóm cụ thể được ưu tiên trước nhóm ghi chung.

Các giới hạn có sẵn cho giỏ hàng, hỗ trợ, bảo hành, bình luận, đánh giá, ảnh tải
lên, danh mục và router người bán vẫn giữ nguyên. Một request có thể chịu thêm
các giới hạn này. Polling QR 5 giây/lần dùng khoảng 12 request/phút, nằm trong
ngân sách 60/phút; nhiều tab cùng tài khoản chia sẻ ngân sách.

Khi bị chặn, API trả HTTP `429`, JSON `code: RATE_LIMITED`, `retry_after` và header
`Retry-After`. Giao diện hiện có dùng thời gian này để thông báo chờ. Ngân sách
session/webhook không bị tiêu hao bởi request API thông thường.

## Dependency và request body

- `express 5.3.0` với dependency khóa trong `package-lock.json`:
  `body-parser 2.4.0`, `qs 6.17.1`.
- `zod 4.6.7`, `express-rate-limit 8.7.3`, `ip-address 10.7.6`.
- `npm audit --omit=dev --audit-level=high` được chạy trong CI trước kiểm thử/build.
- JSON tối đa 100 KB. Parser JSON và parser ảnh đều dùng `inflate: false`;
  request body có `Content-Encoding: gzip/deflate/br` bị từ chối HTTP 415,
  `code: UNSUPPORTED_ENCODING`. Nén **response** tại Nginx/Cloudflare vẫn dùng được.
- Bản vá cho hai advisory:
  [body-parser](https://github.com/advisories/GHSA-27r3-jxmh-p828),
  [Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

## Triển khai

Không cần migration Supabase mới. Deploy source và lockfile cùng nhau bằng
pipeline hiện có (`npm ci`, kiểm thử, build, kích hoạt release).

Khi Redis tắt, bộ đếm nằm trong RAM từng tiến trình Node và reset lúc restart.
Với nhiều tiến trình/replica, cấu hình Redis hiện có để dùng chung bộ đếm; lỗi
Redis làm request dừng trước handler, không bỏ qua giới hạn. Không cần bật thêm
Redis chỉ để chạy bản một tiến trình trên VPS 1 GB.

IP lấy từ `req.ip`, theo `TRUST_PROXY` của ứng dụng. Khi chạy sau Nginx, chỉ tin số
hop thực tế; cấu hình mẫu ghi đè `X-Forwarded-For` bằng địa chỉ nguồn, và cổng
Node cần chỉ nhận lưu lượng qua proxy đã tin cậy. Nếu thêm Cloudflare phía trước,
cần cấu hình Nginx nhận IP thật từ đúng dải proxy Cloudflare trước khi dùng
`$remote_addr` cho giới hạn theo IP.

Đây là giới hạn request trong ứng dụng; không giới hạn số kết nối SSE đang mở và
không thay thế giới hạn kết nối/lưu lượng ở reverse proxy.
