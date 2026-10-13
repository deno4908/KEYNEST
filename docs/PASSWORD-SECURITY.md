# Mật khẩu và lịch sử 30 ngày

## Triển khai

1. Sau migrations 027 và 028, chạy `supabase/migrations/029_password_history.sql` trong Supabase SQL Editor **trước khi triển khai backend mới**. Thiếu migration, backend sẽ từ chối đổi/reset mật khẩu thay vì bỏ qua kiểm tra lịch sử.
2. Triển khai cả frontend và backend. Giữ `INVENTORY_ENCRYPTION_KEY` ổn định và giống nhau trên mọi replica. Không cần thêm secret; khóa vận chuyển riêng được dẫn xuất bằng HKDF với ngữ cảnh riêng.
3. Thử đổi A → B, rồi thử đặt lại A bằng Quên mật khẩu: phải bị từ chối; nhập C trên cùng trang phải thành công. Không chia sẻ request thực tế, mật khẩu, link hoặc vé khôi phục khi báo lỗi.

## Dữ liệu lưu và quy tắc

Supabase Auth vẫn quản lý mật khẩu hiện tại bằng bcrypt có salt. Trigger trên `auth.users` lưu **hash cũ**, không lưu mật khẩu rõ, khi cập nhật thành công. Transaction rollback không tạo lịch sử. Bảng lịch sử bật RLS và không cấp quyền cho `anon`/`authenticated`; các RPC đọc hash chỉ dành cho service role.

Mật khẩu hiện tại luôn bị chặn, dù đã dùng hơn 30 ngày. Mật khẩu đã thay thế bị chặn trong 30 × 24 giờ tính từ lần thay thế. Các hàng hết hạn được xóa khi kiểm tra hoặc đổi mật khẩu tiếp theo; không có lịch tự xóa hàng ngày. Hash cũ trước lúc áp dụng migration không thể khôi phục; mật khẩu hiện tại của tài khoản có sẵn vẫn được kiểm tra ngay.

Backend áp dụng quy tắc cho `/api/me/password` và `/api/auth/reset`, với lease theo user trong DB để tránh hai instance cùng kiểm tra và cập nhật. Lease tự hết hạn sau 2 phút nếu tiến trình lỗi; các lời gọi Auth trong luồng đổi mật khẩu có timeout 15 giây. Mật khẩu bị từ chối không tiêu thụ reset ticket. Demo dùng scrypt có salt, lưu lịch sử trong snapshot và loại bỏ toàn bộ hash khỏi hồ sơ trả về API.

Quy tắc lịch sử được thực thi bởi backend KEYNEST. Thay đổi trực tiếp qua Supabase Auth API hoặc Dashboard được ghi nhận bởi trigger nhưng không chạy kiểm tra lịch sử của backend; đây không phải cấu hình password-history toàn cục của Supabase. Không dùng Dashboard làm luồng đổi mật khẩu cho khách hàng.

## Mã hóa request trình duyệt

Frontend lấy public key tại `/api/auth/password-key`, rồi dùng thư viện `jose` và Web Crypto để tạo JWE `ECDH-ES` + `A256GCM`. JSON trên Network chứa `encrypted_credentials`, không chứa mật khẩu rõ. Mỗi request có khóa ephemeral và IV mới; server kiểm tra key ID, thuật toán, endpoint và hạn 120 giây. Client không chuyển về gửi rõ nếu mã hóa thất bại. Backend còn nhận request định dạng cũ để các tab đang mở không bị khóa khi cập nhật.

Đây là mã hóa thêm trên **HTTPS**, không phải hash phía client hay một bản sao giao thức Facebook. Server giải mã trong bộ nhớ để gọi Supabase Auth; database lưu hash. Người kiểm soát trình duyệt vẫn có thể đọc giá trị nhập. JWE chưa hết hạn vẫn có thể được phát lại, vì vậy xác thực, CAPTCHA, CSRF, giới hạn yêu cầu và vé reset một lần vẫn được giữ nguyên. Không log request body đã giải mã. Việc mã hóa không thay thế TLS hoặc bảo vệ chống XSS.

Tham khảo: [Supabase password security](https://supabase.com/docs/guides/auth/password-security), [jose](https://github.com/panva/jose), [bcrypt.js](https://github.com/dcodeIO/bcrypt.js).
