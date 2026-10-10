# OTP email bắt buộc cho admin

Tạm tắt bằng `ADMIN_OTP_ENABLED=false` trong `.env`, sau đó khởi động lại backend. Bật lại bằng `true`. Cờ này chỉ điều khiển OTP email admin, không tắt Authenticator 2FA. Khi tắt, các API gửi/xác minh OTP email không hoạt động.

Trong chế độ Supabase, mỗi phiên admin mới phải xác minh OTP email, kể cả đăng nhập Google/Discord. Nếu đã bật TOTP, xác minh Authenticator trước rồi OTP email. Khách hàng và đăng ký không thêm bước nhập OTP.

## Thiết lập Supabase

1. Authentication → Email Templates → Magic Link: dán `supabase/email-templates/otp.html`. Subject: `Mã xác thực quản trị KEYNEST`.
2. Bật nhà cung cấp Email và cấu hình gửi thư/SMTP để gửi được tới email admin. Không tắt xác minh email đăng ký chỉ để sử dụng tính năng này; Confirm signup vẫn dùng liên kết theo cấu hình hiện tại.
3. Không thay Reset Password bằng mẫu OTP; giữ `recovery.html` cho đặt lại mật khẩu.
4. Khởi động lại backend. Đăng nhập bằng một tài khoản admin thử nghiệm. Hoàn tất Authenticator nếu đã bật, rồi chọn Gửi mã xác thực tại `/admin-verification`.

Không cần migration hay khóa mới. Khóa mã hóa backend hiện có bảo vệ cookie xác minh. Email nhận mã lấy từ người dùng đã được Supabase xác minh, không nhận email tùy ý từ frontend. Mỗi mã chỉ được Supabase chấp nhận một lần; cửa sổ xác minh ứng dụng tối đa 10 phút. Gửi lại cách nhau 60 giây, tối đa 5 lần/15 phút theo IP; xác minh tối đa 10 lần/15 phút theo IP.

Cookie HttpOnly xác minh gắn với user, email và session_id gốc, hết hạn sau 12 giờ, được xóa khi đăng xuất. Phiên đăng nhập mới luôn phải xác minh lại; tải lại trang hoặc refresh token của cùng phiên không gửi OTP lại. Mọi API có xác thực đều kiểm tra cổng admin OTP. Chỉ các API xác minh cần thiết được phép truy cập trước khi hoàn tất. Không lưu mã hay token vào localStorage.

Supabase verifyOtp tạo một phiên email tạm; backend thu hồi phiên tạm đó bằng signOut scope local và giữ nguyên phiên gốc cùng mức AAL2/OAuth. Cần kiểm tra thực tế nếu dự án Supabase bật giới hạn một phiên đồng thời vì phiên tạm có thể ảnh hưởng chính sách đó. Bản demo không gửi OTP và vẫn dùng tài khoản mẫu.

Kiểm tra trước khi sử dụng: admin password/OAuth, có/không 2FA, mã sai/hết hạn, gửi lại, đăng xuất đăng nhập lại, phiên khác không dùng được cookie xác minh cũ, khách hàng không bị yêu cầu OTP admin. Không gửi cookie hoặc mã thực vào log/báo lỗi.
