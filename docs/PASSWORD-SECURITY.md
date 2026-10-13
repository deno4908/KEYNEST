# Mật khẩu và lịch sử 30 ngày

## Triển khai

1. Sau migrations 027 và 028, chạy `supabase/migrations/029_password_history.sql` trong Supabase SQL Editor **trước khi triển khai backend mới**. Thiếu migration, backend sẽ từ chối đổi/reset mật khẩu thay vì bỏ qua kiểm tra lịch sử.
2. Chạy tiếp `supabase/migrations/030_password_request_nonces.sql` để bật chống phát lại trên mọi replica. Thiếu migration hoặc không kết nối được kho nonce, yêu cầu mật khẩu bị từ chối với 503; không bỏ qua kiểm tra.
3. Triển khai cả frontend và backend. Giữ `INVENTORY_ENCRYPTION_KEY` ổn định và giống nhau trên mọi replica. Không cần thêm secret; khóa vận chuyển và khóa ký nonce được dẫn xuất bằng HKDF với ngữ cảnh riêng. Tab dùng frontend cũ phải tải lại trang.
4. Thử đổi A → B, rồi thử đặt lại A bằng Quên mật khẩu: phải bị từ chối; nhập C trên cùng trang phải thành công. Không chia sẻ request thực tế, mật khẩu, link hoặc vé khôi phục khi báo lỗi.

## Dữ liệu lưu và quy tắc

Supabase Auth vẫn quản lý mật khẩu hiện tại bằng bcrypt có salt. Trigger trên `auth.users` lưu **hash cũ**, không lưu mật khẩu rõ, khi cập nhật thành công. Transaction rollback không tạo lịch sử. Bảng lịch sử bật RLS và không cấp quyền cho `anon`/`authenticated`; các RPC đọc hash chỉ dành cho service role.

Mật khẩu hiện tại luôn bị chặn, dù đã dùng hơn 30 ngày. Mật khẩu đã thay thế bị chặn trong 30 × 24 giờ tính từ lần thay thế. Các hàng hết hạn được xóa khi kiểm tra hoặc đổi mật khẩu tiếp theo; không có lịch tự xóa hàng ngày. Hash cũ trước lúc áp dụng migration không thể khôi phục; mật khẩu hiện tại của tài khoản có sẵn vẫn được kiểm tra ngay.

Backend áp dụng quy tắc cho `/api/me/password` và `/api/auth/reset`, với lease theo user trong DB để tránh hai instance cùng kiểm tra và cập nhật. Lease tự hết hạn sau 2 phút nếu tiến trình lỗi; các lời gọi Auth trong luồng đổi mật khẩu có timeout 15 giây. Mật khẩu bị từ chối không tiêu thụ reset ticket. Demo dùng scrypt có salt, lưu lịch sử trong snapshot và loại bỏ toàn bộ hash khỏi hồ sơ trả về API.

Quy tắc lịch sử được thực thi bởi backend KEYNEST. Thay đổi trực tiếp qua Supabase Auth API hoặc Dashboard được ghi nhận bởi trigger nhưng không chạy kiểm tra lịch sử của backend; đây không phải cấu hình password-history toàn cục của Supabase. Không dùng Dashboard làm luồng đổi mật khẩu cho khách hàng.

## Mã hóa request trình duyệt

Frontend lấy public key và nonce ngẫu nhiên tại `/api/auth/password-key`, rồi dùng thư viện `jose` và Web Crypto để tạo JWE `ECDH-ES` + `A256GCM`. JSON trên Network chứa `encrypted_credentials`, không chứa mật khẩu rõ. Mỗi request có khóa ephemeral và IV mới; server kiểm tra key ID, thuật toán, endpoint và hạn 120 giây. Client không chuyển về gửi rõ nếu mã hóa thất bại. Backend Supabase bắt buộc JWE tại đăng nhập, đăng ký, reset và đổi mật khẩu; chỉ demo còn hỗ trợ request rõ để chạy kiểm thử cục bộ.

Nonce gồm 32 byte ngẫu nhiên, thời điểm cấp và chữ ký HMAC của server. Nonce nằm trong payload mã hóa, bị ràng buộc với thời điểm cấp; client không thể tự gia hạn. DB chỉ lưu SHA-256 của nonce cùng hạn dùng. RPC service-only ghi nhận lần dùng đầu tiên bằng khóa duy nhất, nên hai request đồng thời hoặc hai replica chỉ chấp nhận một lần. Request trùng trả 409, kể cả mã hóa lại bằng cùng nonce. Nonce được tiêu thụ trước khi chạy nghiệp vụ; nhập sai mật khẩu hoặc lỗi nghiệp vụ cần gửi request mới. Frontend tự xin nonce mới mỗi lần gửi, bao gồm khi thử lại sau làm mới phiên. Nonce hết hạn được dọn khi có request tiếp theo; demo giữ nonce trong bộ nhớ, không dùng cho production nhiều instance.

Đây là mã hóa thêm trên **HTTPS**, không phải hash phía client hay một bản sao giao thức Facebook. Server giải mã trong bộ nhớ để gọi Supabase Auth; database lưu hash. Người kiểm soát trình duyệt vẫn có thể đọc giá trị nhập và tạo request mới. Nonce chặn sử dụng lại request đã được tiếp nhận; nếu request bị lấy cắp trước khi gửi, bên gửi trước vẫn có thể thắng. Xác thực, CAPTCHA, CSRF, giới hạn yêu cầu và vé reset một lần vẫn cần thiết. Không log request body đã giải mã. Việc mã hóa không thay thế TLS hoặc bảo vệ chống XSS.

## API riêng tư

Lớp kiểm tra chung yêu cầu phiên hợp lệ cho mọi API không nằm trong danh sách công khai ở `server/api-access.js`; `/admin` kiểm tra thêm quyền admin. Xác thực Supabase kiểm tra token qua Auth, trạng thái tài khoản, phiên bị thu hồi và các bước MFA/OTP. Các handler đơn hàng, ví, hỗ trợ, phiên và seller tiếp tục lọc dữ liệu bằng ID người dùng đã xác thực; không lấy chủ sở hữu từ body của client. Router OAuth, refresh và webhook thanh toán chạy trước lớp kiểm tra chung và có cơ chế kiểm tra riêng. API công khai như đăng nhập, khôi phục và webhook không đòi phiên đăng nhập nhưng vẫn kiểm tra CAPTCHA, vé khôi phục hoặc chữ ký tương ứng. Nonce hiện áp dụng cho bốn endpoint mật khẩu; các mutation khác tiếp tục dùng xác thực, quyền và cơ chế idempotency sẵn có.

Tham khảo: [Supabase password security](https://supabase.com/docs/guides/auth/password-security), [jose](https://github.com/panva/jose), [bcrypt.js](https://github.com/dcodeIO/bcrypt.js).
