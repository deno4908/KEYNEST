# Xác thực hai bước

Chạy ứng dụng với `APP_MODE=supabase`. Trong Supabase Dashboard, Authentication → Multi-Factor Authentication, bật đăng ký và xác minh TOTP nếu đang tắt. Không cần migration SQL hoặc khóa mới trong `.env`.

Người dùng vào Tài khoản → Đăng nhập & bảo mật → Bật 2FA, quét QR bằng ứng dụng Authenticator và nhập mã 6 chữ số. Chỉ sau khi xác minh thành công mới bật bảo vệ. Có thể thêm thiết bị dự phòng. Gỡ thiết bị yêu cầu mã mới từ thiết bị đó; gỡ thiết bị cuối cùng sẽ tắt 2FA.

Khi đăng nhập bằng mật khẩu, Google hoặc Discord, phiên có factor đã xác minh nhưng chưa đạt `aal2` bị chặn tại middleware API và chuyển tới `/two-factor`. Backend xác minh access token bằng Supabase trước khi đọc mức xác thực. Không tin cờ bật 2FA từ frontend hoặc user metadata. QR/secret chỉ trả trong bước thiết lập với Cache-Control no-store, không lưu vào localStorage. Mã sai bị giới hạn tốc độ; token phiên nâng cấp chỉ lưu cookie HttpOnly.

Lưu khóa thiết lập ở nơi an toàn hoặc thêm thiết bị dự phòng trước khi đổi điện thoại. Chưa có luồng tự phục hồi bằng mã dự phòng trong giao diện. Không dùng email khôi phục mật khẩu để bỏ qua 2FA. Bản demo không cung cấp 2FA giả lập.

Kiểm thử tự động: `node --test tests/mfa.test.js`. Cần thử thêm trên dự án Supabase thật với một tài khoản thử nghiệm: bật TOTP, đăng xuất, đăng nhập bằng từng provider, kiểm tra không truy cập được ví/đơn hàng trước khi nhập mã, nhập mã sai, mã đúng, thêm thiết bị dự phòng và gỡ thiết bị. Không sử dụng cookie/token thật trong báo lỗi.

Tham khảo: https://supabase.com/docs/guides/auth/auth-mfa/totp
