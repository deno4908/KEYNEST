# Đăng nhập Google và Discord

Website dùng Supabase Auth qua backend Node.js. Cần `APP_MODE=supabase` và các biến Supabase trong `.env.example`. Trong demo, hai nút hiển thị thông báo chưa khả dụng; dùng email hoặc tài khoản mẫu để thử cửa hàng.

## Cấu hình

1. Tạo OAuth client trên Google Cloud và ứng dụng trên Discord Developer Portal. Đăng ký callback của nhà cung cấp là `https://<project-ref>.supabase.co/auth/v1/callback` (lấy URL chính xác từ Supabase Dashboard).
2. Trong Supabase Dashboard → Authentication → Sign In / Providers, bật Google và Discord, nhập Client ID và Client Secret tương ứng. Secret chỉ lưu ở Supabase, không đưa vào frontend.
3. Trong Supabase Authentication → URL Configuration, đặt Site URL bằng `APP_ORIGIN`, thêm `${APP_ORIGIN}/api/auth/oauth/callback` vào Redirect URLs, thay biến bằng địa chỉ thực. Ví dụ local: `http://127.0.0.1:5173/api/auth/oauth/callback`. Dùng cùng hostname khi mở website và cấu hình origin.
4. Trong `.env`, đặt `AUTH_GOOGLE_ENABLED=true` và/hoặc `AUTH_DISCORD_ENABLED=true` cho nhà cung cấp đã cấu hình. Khởi động lại Node.js. Production cần HTTPS.
5. Mở cửa hàng, chọn Google/Discord, chấp thuận đăng nhập. Thành công sẽ chuyển về `/account`; hồ sơ khách được tạo bởi trigger có sẵn trong migration `001_store.sql`.

Google có thể yêu cầu thêm người dùng thử trong OAuth consent screen khi ứng dụng chưa công khai. Với Discord, website yêu cầu quyền `identify email`. Không cấp role quản trị từ dữ liệu nhà cung cấp.

## Avatar Google/Discord

Sau các migration 001–008, chạy `supabase/migrations/009_oauth_avatar.sql` trong SQL Editor. Migration thêm `profiles.avatar_url`, lấy `avatar_url` hoặc `picture` từ metadata Supabase Auth, cập nhật ảnh cho tài khoản có sẵn và đồng bộ khi metadata thay đổi. Chỉ nhận URL HTTPS của CDN Google/Discord. Không lấy role hoặc số dư từ metadata.

Header và trang tài khoản hiển thị ảnh này. Nếu không có ảnh hoặc tải ảnh thất bại, hiển thị chữ cái tên. Ảnh được tải từ CDN nhà cung cấp; web không sao chép ảnh vào Storage. Sau khi chạy migration, tải lại trang hoặc đăng nhập lại; khi đổi avatar bên nhà cung cấp, đăng nhập OAuth lại để Supabase nhận metadata mới.

## Luồng và kiểm thử

Avatar tự chọn: chạy thêm `010_avatar_upload.sql`. Tài khoản → Thông tin cá nhân → Thay ảnh đại diện nhận JPG/PNG/WebP tối đa 4 MB, giải mã và chuyển WebP tối đa 512px, bỏ metadata. File binary được lưu trong bucket private `store-assets` đã tạo ở migration 006; hồ sơ chỉ lưu đường dẫn `/api/media/<UUID>.webp` và `avatar_source=upload`, không lưu base64. Backend phục vụ ảnh qua đường dẫn này; người dùng khác có đường dẫn có thể xem ảnh đại diện. Ảnh tự chọn được giữ khi đăng nhập OAuth lại. Demo lưu file trong thư mục uploads cục bộ. Các ảnh cũ/ảnh mồ côi chưa tự xóa để tránh xóa file còn được tham chiếu khi cập nhật đồng thời hoặc DB trả lỗi không rõ kết quả.

`POST /api/auth/oauth/:provider` yêu cầu Origin và `X-App-Request`, tạo PKCE S256 và cookie verifier được mã hóa, HttpOnly, SameSite=Lax, Secure ở production, hết hạn sau 10 phút. Supabase xử lý state của nhà cung cấp. Callback Node đổi code lấy session và lưu access/refresh token trong cookie HttpOnly của website; không đưa token vào localStorage hoặc URL chuyển hướng.

Phải hoàn tất trong trình duyệt đã bắt đầu đăng nhập. Mỗi trình duyệt giữ một giao dịch OAuth; bắt đầu lại thay thế giao dịch trước. Callback lỗi, hết hạn hoặc bị hủy chuyển về `/auth/error` với nút thử lại. Không đưa lỗi chi tiết của nhà cung cấp hoặc token ra trang lỗi.

`npm test` kiểm tra PKCE, cookie, callback giả mạo/hết hạn, callback thiếu cookie, replay và cấu hình bị tắt bằng dịch vụ Supabase giả lập. `npm run test:ui` kiểm tra nút social, thông báo lỗi, chuyển tab và xác nhận mật khẩu. Các test này **không xác minh tài khoản Google/Discord thật**; cần thử cả thành công và hủy đăng nhập trên dự án Supabase đã cấu hình trước khi triển khai.

Tài liệu chính thức: [Google](https://supabase.com/docs/guides/auth/social-login/auth-google), [Discord](https://supabase.com/docs/guides/auth/social-login/auth-discord), [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow).
