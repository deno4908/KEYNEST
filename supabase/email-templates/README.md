# Email KEYNEST

Trong Supabase Dashboard → Authentication → Email Templates (hoặc Emails → Templates), chọn mẫu tương ứng, thay Subject và dán toàn bộ HTML vào Body rồi lưu.

| File | Mẫu Supabase | Subject |
| --- | --- | --- |
| `recovery.html` | Reset Password | Đặt lại mật khẩu tài khoản KEYNEST |
| `otp.html` | Magic Link, khi ứng dụng dùng đăng nhập email OTP | Mã xác thực KEYNEST của bạn |

`{{ .Token }}` là mã OTP, `{{ .ConfirmationURL }}` là URL xác minh do Supabase tạo. Mẫu khôi phục mật khẩu dùng `{{ .RedirectTo }}` và `{{ .TokenHash }}` để đưa người dùng thẳng đến trang KEYNEST; backend chỉ xác minh token khi người dùng gửi mật khẩu mới. Không đổi thành `{{ .ConfirmationURL }}` vì trình quét liên kết của email có thể xác minh và dùng mất token trước người nhận. Giữ nguyên cú pháp, không hardcode token thật hoặc URL localhost. Không ghi thời hạn cố định vào email vì phụ thuộc cấu hình Auth.

**Trạng thái dự án:** khôi phục mật khẩu dùng liên kết tại `/reset-password`, vì vậy dùng `recovery.html`. Admin bắt buộc xác minh OTP email tại `/admin-verification`: dùng `otp.html` cho Magic Link. Không dùng OTP email thay mã 2FA Authenticator; admin bật 2FA cần cả hai. Giữ mẫu Confirm signup có liên kết xác nhận cho đăng ký; không thêm OTP vào đăng ký. Xem `docs/ADMIN-OTP.md` để thiết lập.

Trong URL Configuration, đặt Site URL bằng địa chỉ frontend và thêm redirect URL `http://127.0.0.1:5173/reset-password` khi chạy local, hoặc `https://TEN-MIEN/reset-password` khi deploy. Kiểm tra APP_ORIGIN khớp địa chỉ frontend. Sau khi cập nhật file, dán lại toàn bộ mẫu vào Supabase Dashboard → Authentication → Email Templates → Reset Password. Tắt click tracking trong nhà cung cấp SMTP để người nhận được chuyển thẳng đến KEYNEST; hostname tracking như `r.admin.keynest.store` do nhà cung cấp mail cấu hình, không phải từ HTML này. Gửi thử đến Gmail và thử liên kết thực tế; preview trên Dashboard không chứng minh email đã được gửi hoặc luồng xác thực đã hoàn tất.

Mẫu sử dụng bảng và inline CSS, không dùng JavaScript, font tải ngoài hay ảnh từ bên thứ ba. Gmail/ứng dụng email có thể điều chỉnh màu theo chế độ sáng/tối. Template không cấu hình SMTP; nếu chưa gửi được email, kiểm tra cấu hình gửi thư của Supabase riêng.

Tài liệu: https://supabase.com/docs/guides/auth/auth-email-templates
