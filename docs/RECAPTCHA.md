# Bật Google reCAPTCHA cho KEYNEST

Đã tích hợp **reCAPTCHA v2 Checkbox** (ô “Tôi không phải người máy”) cho đăng nhập email, đăng ký email và yêu cầu khôi phục mật khẩu. Backend xác minh CAPTCHA cho cả ba API. Widget nằm dưới mật khẩu khi đăng nhập, dưới nhập lại mật khẩu khi đăng ký và dưới email khi quên mật khẩu. Mục khôi phục qua email trong tài khoản cũng yêu cầu CAPTCHA. Google/Discord không cần CAPTCHA; làm mới token và 2FA cũng không yêu cầu CAPTCHA mới. Rate limit và CSRF vẫn hoạt động. Không sử dụng Turnstile, reCAPTCHA v3 hoặc Enterprise Assessments API.

## 1. Tạo key cho website

1. Mở https://www.google.com/recaptcha/admin/create và đăng nhập Google.
2. Label: `KEYNEST production`.
3. Chọn **Challenge (v2) / reCAPTCHA v2 → “I'm not a robot” Checkbox**. Không chọn v3/Score hoặc Invisible.
4. Domains: thêm `keynest.store` (không có https://, đường dẫn hoặc cổng). Giữ bật kiểm tra domain. Chọn/tạo Google Cloud project nếu Google yêu cầu.
5. Gửi biểu mẫu. Lấy **Site key** và **Secret key**. Nếu vào Cloud Console, chọn loại Challenge (v2) và lấy legacy secret key tương thích Siteverify; chỉ có mã project/API key Enterprise là chưa đủ cho adapter này.

Site key được gửi ra trình duyệt. Secret key chỉ điền trên backend, không đặt biến VITE_, không gửi lên GitHub hay chat.

## 2. Điền trên VPS

Trong **Bitvise → Terminal root**:

```bash
nano /opt/keynest/.env
```

Thêm hoặc sửa đúng một bộ biến (thay nội dung mẫu bằng key thật):

```dotenv
RECAPTCHA_ENABLED=true
RECAPTCHA_SITE_KEY=SITE_KEY_CUA_BAN
RECAPTCHA_SECRET_KEY=SECRET_KEY_CUA_BAN
```

Giữ `APP_ORIGIN=https://keynest.store`. Lưu Ctrl+O → Enter → Ctrl+X.

Deploy code mới qua GitHub Actions nếu chưa deploy; sau đó:

```bash
systemctl restart keynest
systemctl status keynest --no-pager
```

Site key được frontend lấy từ `/api/config`, nên thay key không cần build lại. Nếu có worker Kafka chạy thì nó cũng đọc config; nhớ điền đủ cả hai key khi bật.

## 3. Kiểm tra

1. Tải lại website, mở Đăng nhập: phải có widget tiếng Việt, nền tối.
2. Nút đăng nhập/đăng ký email chờ hoàn tất xác minh. Google/Discord bấm được ngay mà không cần CAPTCHA.
3. Tích checkbox rồi đăng nhập. Nếu sai mật khẩu, widget được làm mới để xác minh lại.
4. Thử đăng ký mới. Vẫn không gửi OTP/xác nhận email đăng ký.
5. Mở Quên mật khẩu: xác minh CAPTCHA trước khi gửi email khôi phục. Kiểm tra tương tự tại Tài khoản → Bảo mật → Khôi phục qua email.
6. Gọi API đăng nhập/đăng ký/quên mật khẩu thiếu header `X-Captcha-Token`: backend trả lỗi trước khi kiểm tra mật khẩu/tạo tài khoản/gửi email. Chỉ ẩn widget phía frontend không bỏ qua được backend.

Backend gọi Google Siteverify, kiểm tra success và hostname khớp APP_ORIGIN. Token reCAPTCHA chỉ dùng một lần, hết hạn sau 2 phút theo Google. Khi Google lỗi/mất mạng, không cho qua xác minh.

## 4. Chạy ở localhost

Tạo **một bộ key v2 riêng** tên `KEYNEST local`, thêm domain `localhost`. Trong `.env` máy cá nhân đặt bộ key local và `APP_ORIGIN=http://localhost:5173`, restart `npm run dev`, mở đúng `http://localhost:5173`. Nếu dùng OAuth local, thêm callback origin localhost tương ứng trong Supabase. Không đổi qua lại localhost và 127.0.0.1 giữa lúc đăng nhập.

Không dùng public test keys ở production: chúng luôn xác minh thành công, không chống spam. Code từ chối các test keys Google phổ biến khi NODE_ENV=production.

## Lỗi thường gặp

- **Invalid key type**: đã lấy key v3/Invisible/Enterprise không phù hợp. Dùng v2 Checkbox tương thích Siteverify.
- **Invalid domain for site key**: thêm domain đúng trong cấu hình Google.
- **Widget không tải**: kiểm tra mạng/tiện ích chặn nội dung và Console. CSP backend đã cho phép script/frame/connect của Google reCAPTCHA; Nginx hoặc proxy tự thêm CSP khác cũng phải cho phép.
- **Đã tích nhưng backend từ chối**: kiểm tra cặp Site/Secret cùng widget, APP_ORIGIN khớp hostname đang truy cập. Xác minh lại nếu token hết hạn/đã dùng.
- **Không thấy widget**: kiểm tra /api/config có captcha.enabled=true; restart API sau đổi .env, kiểm tra deploy đã cập nhật code.

Mặc định `.env.example` tắt vì cần key riêng. Chưa điền key thì tính năng chưa bảo vệ đăng nhập thực tế. reCAPTCHA giảm spam, không bảo đảm chặn mọi bot.

Tài liệu Google: [Hiển thị v2](https://developers.google.com/recaptcha/docs/display), [Siteverify](https://developers.google.com/recaptcha/docs/verify), [Domain/localhost](https://developers.google.com/recaptcha/docs/domain_validation), [CSP và test keys](https://developers.google.com/recaptcha/docs/faq).
