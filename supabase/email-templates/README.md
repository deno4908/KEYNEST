# Email KEYNEST

Trong Supabase Dashboard → Authentication → Email Templates (hoặc Emails → Templates), chọn mẫu tương ứng, thay Subject và dán toàn bộ HTML vào Body rồi lưu.

| File | Mẫu Supabase | Subject |
| --- | --- | --- |
| `recovery.html` | Reset Password | Đặt lại mật khẩu tài khoản KEYNEST |
| `otp.html` | Magic Link, khi ứng dụng dùng đăng nhập email OTP | Mã xác thực KEYNEST của bạn |

`{{ .Token }}` là mã OTP, `{{ .ConfirmationURL }}` là URL xác minh do Supabase tạo. Mẫu khôi phục mật khẩu dùng `{{ .RedirectTo }}` và `{{ .TokenHash }}` để đưa người dùng thẳng đến trang KEYNEST. Khi trang được mở, backend xác minh và tiêu thụ liên kết ngay, rồi cấp một vé đặt mật khẩu chỉ dùng một lần và chỉ giữ trong bộ nhớ trang. Vé và liên kết hết hạn sau 10 phút; yêu cầu gửi mới vô hiệu hóa liên kết và vé cũ. Không đổi thành `{{ .ConfirmationURL }}` vì trình quét liên kết của email có thể xác minh và dùng mất token trước người nhận. Giữ nguyên cú pháp, không hardcode token thật hoặc URL localhost.

**Trạng thái dự án:** khôi phục mật khẩu dùng liên kết tại `/reset-password`, vì vậy dùng `recovery.html`. Admin bắt buộc xác minh OTP email tại `/admin-verification`: dùng `otp.html` cho Magic Link. Không dùng OTP email thay mã 2FA Authenticator; admin bật 2FA cần cả hai. Giữ mẫu Confirm signup có liên kết xác nhận cho đăng ký; không thêm OTP vào đăng ký. Xem `docs/ADMIN-OTP.md` để thiết lập.

Trong URL Configuration, đặt Site URL bằng địa chỉ frontend và thêm redirect URL `http://127.0.0.1:5173/reset-password\?recovery_id=*` khi chạy local, hoặc `https://TEN-MIEN/reset-password\?recovery_id=*` khi deploy. Dấu `\?` khớp dấu hỏi theo cú pháp wildcard của Supabase; `*` khớp mã yêu cầu. Kiểm tra APP_ORIGIN khớp địa chỉ frontend. Áp dụng migration `supabase/migrations/027_password_recovery_links.sql`, rồi dán lại toàn bộ mẫu vào Supabase Dashboard → Authentication → Email Templates → Reset Password. Tắt click tracking trong nhà cung cấp SMTP để người nhận được chuyển thẳng đến KEYNEST; hostname tracking như `r.admin.keynest.store` do nhà cung cấp mail cấu hình, không phải từ HTML này. Gửi thử đến Gmail và thử liên kết thực tế; preview trên Dashboard không chứng minh email đã được gửi hoặc luồng xác thực đã hoàn tất.

Mẫu sử dụng bảng và inline CSS, không dùng JavaScript, font tải ngoài hay ảnh từ bên thứ ba. Gmail/ứng dụng email có thể điều chỉnh màu theo chế độ sáng/tối. Template không cấu hình SMTP; nếu chưa gửi được email, kiểm tra cấu hình gửi thư của Supabase riêng.

    Tài liệu: https://supabase.com/docs/guides/auth/auth-email-templates

## Cập nhật luồng khôi phục (migration 028)

1. Áp dụng `027_password_recovery_links.sql` nếu chưa chạy, sau đó chạy `028_password_recovery_delivery.sql` trong Supabase SQL Editor. Không chạy lại 027 nếu bảng đã tồn tại.
2. Triển khai backend và frontend cùng phiên bản. Backend dùng `APP_ORIGIN=https://keynest.store` và khóa `INVENTORY_ENCRYPTION_KEY` ổn định, giống nhau trên mọi instance.
3. Supabase Authentication → URL Configuration: Site URL chỉ là `https://keynest.store`; thêm Redirect URL `https://keynest.store/reset-password\?recovery_id=*`. Không điền token vào Site URL.
4. Dán lại toàn bộ `recovery.html` vào Reset Password trên Supabase. Template mới đặt token trong phần `#token_hash=...&type=recovery`; mã yêu cầu vẫn nằm trong `?recovery_id=...`. Backend bắt buộc có mã yêu cầu nên gửi email từ chức năng Quên mật khẩu của website, không từ nút gửi recovery trên Dashboard.
5. Tắt click tracking trong Brevo/SendinBlue, yêu cầu email mới và mở một lần trong 10 phút. Chờ ít nhất 90 giây giữa hai yêu cầu gửi. Nếu Supabase cấu hình thời gian chờ gửi dài hơn, cần chờ theo giới hạn đó.

Backend chỉ thay thế mã yêu cầu sau khi dịch vụ gửi thư chấp nhận yêu cầu. Liên kết và vé cũ bị vô hiệu hóa khi yêu cầu mới được ghi nhận thành công. Việc mở trang tiêu thụ liên kết; reload cần email mới. Giao diện hiển thị lỗi dịch vụ riêng thay vì coi mọi lỗi là hết hạn. Thời hạn 10 phút tính từ lúc yêu cầu email, không được gia hạn khi mở trang.

Khi điều tra 401, log backend `Password recovery rejected` có `stage: provider` (Supabase từ chối token, kèm code/status) hoặc `stage: generation` (mã yêu cầu cũ, hết hạn, đã mở, hoặc khóa HMAC không khớp). Log này không chứa token, email hay mật khẩu. Không dùng lại curl xác minh vì token chỉ dùng một lần.
