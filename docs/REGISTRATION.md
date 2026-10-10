# Đăng ký không xác nhận email

1. Supabase → SQL Editor → chạy toàn bộ `supabase/migrations/017_registration.sql` sau migration 016.
2. Deploy code mới, khởi động lại API.
3. Đăng ký email mới: backend tạo bằng `auth.admin.createUser` với `email_confirm: true`, sau đó đăng nhập bằng mật khẩu. Không gửi OTP, magic link hay email xác nhận đăng ký. Không cần tắt Confirm email toàn bộ project.
4. Thử lại cùng email; thử tên cũ khác chữ hoa/thường hoặc khoảng trắng đầu/cuối: phải nhận lỗi trùng.

Tên ở form đăng ký được giữ riêng trong `profiles.registration_name`, duy nhất và không đổi theo tên hiển thị. Đăng nhập hiện vẫn dùng EMAIL và mật khẩu, chưa có đăng nhập bằng tên. Tên hiển thị từ Google/Discord có thể trùng (hai người có cùng tên thật). Migration giữ nguyên mọi tài khoản cũ; với các tên cũ đã trùng, giữ một bản dành chỗ để chặn đăng ký thêm tên đó, không xóa tài khoản hay sửa đơn hàng.

Email trùng được kiểm tra cả tài khoản Auth chưa xác nhận. Không tự ghi đè mật khẩu hoặc xác nhận lại tài khoản cũ khi người khác đăng ký cùng email. Nếu tự đăng ký thử trước đây và quên mật khẩu, dùng khôi phục mật khẩu.

Quyết định bỏ xác nhận có nghĩa email đăng ký chưa được chứng minh thuộc về người đăng ký. MFA khi đăng nhập và chức năng khôi phục mật khẩu vẫn hoạt động theo cấu hình riêng.

Nguồn: https://supabase.com/docs/reference/javascript/auth-admin-createuser
