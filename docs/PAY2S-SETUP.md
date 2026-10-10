# KEYNEST: setup Supabase + Pay2S/MBBank từ A đến Z

Backend đã dùng Pay2S Bank Webhook làm mặc định. Web2M đã được bỏ. SePay chỉ còn là tùy chọn tương thích. Chưa kết nối tài khoản ngân hàng thật trong quá trình phát triển này.

Khi cần xử lý nhiều callback, bật [Kafka + Redis](KAFKA-REDIS.md). Trong chế độ đó HTTP 200 xác nhận sự kiện đã vào Kafka; worker riêng mới cập nhật ví/đơn. Các mô tả ghi DB trước khi trả 200 bên dưới áp dụng chế độ trực tiếp mặc định.

## 1. Chuẩn bị dự án

Mở PowerShell tại thư mục dự án, dùng Node.js tương thích Vite 7 (môi trường kiểm thử dùng Node 24):

```powershell
npm install
npm run setup
npm run dev
```

`setup` tạo `.env` nếu chưa có, tự sinh khóa mã hóa kho; không ghi đè file cũ. Mở `http://127.0.0.1:5173`. Ban đầu `APP_MODE=demo`, chưa nhận tiền thật. Tài khoản demo: `student@keynest.local / Student123!`, admin `admin@keynest.local / Admin123!`. Các tài khoản này không được tạo trong Supabase.

## 2. Tạo Supabase

1. Tạo project riêng. Trong SQL Editor, chạy từng file `supabase/migrations/001_store.sql` đến `008_operations.sql` theo thứ tự tên. Database đã có 001–007 thì chỉ chạy 008; không chạy lại toàn bộ migration.
2. Lấy Project URL, public anon/publishable key và server service-role/secret key trong phần API của project.
3. Điền `.env`:

```dotenv
APP_MODE=supabase
NODE_ENV=development
PORT=3001
APP_ORIGIN=http://127.0.0.1:5173
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_PUBLIC_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_KEY
INVENTORY_ENCRYPTION_KEY=KEEP_THE_64_HEX_VALUE_GENERATED_BY_SETUP
BANK_PAYMENT_PROVIDER=pay2s
BANK_CODE=MB
BANK_ACCOUNT_NUMBER=YOUR_MBBANK_ACCOUNT_NUMBER
BANK_ACCOUNT_NAME=YOUR_ACCOUNT_HOLDER_NAME
PAY2S_WEBHOOK_TOKEN=
```

Giữ nguyên khóa mã hóa đã sinh; chuỗi `KEEP_THE...` ở ví dụ là lời nhắc, không phải giá trị để dán. Không thêm `VITE_` trước các secret. Không gửi mật khẩu ngân hàng, OTP, service-role key hoặc token webhook qua chat. Điền chúng trực tiếp vào cấu hình tương ứng.

4. Trong Authentication, bật email/password, cấu hình SMTP nếu dùng email thật; Site URL/Redirect URLs khớp origin website và `/reset-password`. OAuth tùy chọn theo [OAUTH.md](OAUTH.md).
5. Chạy `npm run seed` để nạp danh mục. Seed không nhập key demo vào kho Supabase.
6. Khởi động lại `npm run dev`. Đăng ký tài khoản thật trên web, xác minh email nếu bật, rồi cấp admin bằng SQL:

```sql
update public.profiles set role='admin'
where id=(select id from auth.users where email='YOUR_ADMIN_EMAIL');
```

Admin → Sản phẩm: kiểm tra giá, thời hạn bảo hành, nhập mã thật cho gói giao key; gói dịch vụ cần khai báo tồn kho và giao thủ công. Upload ảnh sử dụng backend Storage hiện có. Nếu không upload được, kiểm tra quyền service key và log backend, không mở quyền ghi bucket công khai.

## 3. Có địa chỉ HTTPS để nhận webhook

Pay2S phải gọi được backend từ Internet. `127.0.0.1` trên máy bạn không dùng làm URL webhook.

Để thử từ máy Windows, cài `cloudflared` theo [hướng dẫn Cloudflare](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/). Dừng `npm run dev` trước khi chạy Node cùng cổng 3001:

```powershell
npm run build
npm start
```

Mở terminal thứ hai:

```powershell
cloudflared tunnel --url http://localhost:3001
```

Cloudflare in ra một URL dạng `https://something.trycloudflare.com`. Đổi `APP_ORIGIN` thành URL này (không có dấu `/` cuối), cập nhật Supabase Auth URLs rồi khởi động lại Node. Dùng chính URL HTTPS đó để mở website; Node phục vụ cả `dist` và `/api`.

Quick Tunnel chỉ phù hợp thử nghiệm, đổi địa chỉ khi khởi động lại và không có cam kết uptime. Khi bán thật cần domain ổn định và backend Node luôn chạy. Không đặt trang đăng nhập/challenge của proxy trước đường dẫn webhook. Cấu hình `TRUST_PROXY` theo đúng số proxy tin cậy của cách triển khai; không đặt tùy tiện.

## 4. Liên kết MBBank trên Pay2S

Tạo tài khoản và chọn gói phù hợp theo [đăng ký Pay2S](https://docs.pay2s.vn/general/dang-ky-pay2s.html). Trong dashboard, mở Ngân hàng → Thêm tài khoản, chọn MBBank và thực hiện các bước xác thực trên dịch vụ. Kiểm tra giao dịch có xuất hiện trong Pay2S trước khi nối website. Tham khảo [thêm tài khoản ngân hàng](https://docs.pay2s.vn/general/them-tai-khoan-ngan-hang.html). Khả năng liên kết/gói phí cần kiểm tra trực tiếp với tài khoản của bạn.

## 5. Tạo webhook

Trong Pay2S, Webhooks → Thêm webhook:

- Chọn đúng tài khoản MBBank nhận tiền.
- Chọn sự kiện nhận tiền.
- URL: `https://YOUR_DOMAIN/api/webhooks/pay2s`.
- Lưu token bí mật được hiển thị khi tạo webhook; tài liệu ghi token chỉ hiển thị một lần. Nguồn: [Tạo Hook](https://docs.pay2s.vn/webhook/create-hook.html).

Điền token thuần vào `PAY2S_WEBHOOK_TOKEN` trong `.env`, **không** thêm `Bearer `. Số tài khoản trong `BANK_ACCOUNT_NUMBER` phải trùng tài khoản đã liên kết, giữ nguyên số 0 ở đầu. Khởi động lại Node.

```powershell
npm run check:config
```

Lệnh này chỉ kiểm tra cấu hình cục bộ, không xác minh token hay thực hiện giao dịch. Admin → Thanh toán & nạp ví có trạng thái cấu hình và thời điểm webhook hợp lệ gần nhất trong tiến trình hiện tại. “Đã cấu hình” chưa có nghĩa ngân hàng đã kết nối thành công.

Đây là tích hợp Bank Webhook: không cần PartnerCode/AccessKey của Partner API và không dùng Collection Link. Callback sử dụng Bearer token, nhận cả batch `transactions` và mẫu giao dịch đơn. Backend chỉ xác nhận thành công sau khi ghi nhận bền vững; lỗi DB trả 503 để Pay2S gửi lại. Cơ chế retry của Pay2S có giới hạn, cần kiểm tra giao dịch bỏ lỡ sau thời gian backend ngừng chạy. Nguồn: [kỹ thuật webhook](https://docs.pay2s.vn/webhook/tai-lieu-ky-thuat.html).

## 6. Thử toàn bộ luồng thật

Thực hiện trên website chạy `APP_MODE=supabase`:

1. Đăng nhập khách, vào Ví, tạo yêu cầu nạp với số tiền nhỏ phù hợp mức tối thiểu của web (10.000đ).
2. Kiểm tra QR: ngân hàng MB, tài khoản, tên người nhận, số tiền và nội dung `KN...`. Chuyển đúng nội dung và số tiền trước hạn 15 phút bằng tài khoản gửi của bạn.
3. Kiểm tra Pay2S thấy giao dịch và webhook nhận HTTP 200. Ví phải tăng đúng một lần và có bút toán lịch sử.
4. Mua sản phẩm bằng ví: trừ tiền, giảm kho, hiện key đúng người mua. Mua bằng chuyển khoản: chỉ giao sau khi callback xác nhận.
5. Nếu dashboard có thao tác gửi lại callback, kiểm tra gửi lại không cộng ví/giao key lần hai. Không tự giả lập webhook vào môi trường có tiền thật.
6. Thử bảo hành → admin phản hồi/hoàn ví. Hoàn ngân hàng ngoài hệ thống là thao tác ghi nhận sau khi bạn đã chuyển tiền, không có API tự chuyển tiền ra.

Các test tự động trong repo dùng dữ liệu cô lập, không chuyển tiền thật:

```powershell
npm test
npm run test:db
npm run test:ui
```

Chạy browser test chỉ khi backend ở demo; test chủ động từ chối Supabase.

## 7. Đưa lên môi trường hoạt động ổn định

Triển khai lên VPS hoặc dịch vụ hỗ trợ tiến trình Node dài hạn: cài dependencies, `npm run build`, start bằng `npm start`. Điền biến môi trường riêng của host:

```dotenv
NODE_ENV=production
APP_MODE=supabase
APP_ORIGIN=https://YOUR_DOMAIN
BANK_PAYMENT_PROVIDER=pay2s
BANK_CODE=MB
```

Cùng toàn bộ biến Supabase, ngân hàng, mã hóa và token từ các bước trên. Reverse proxy phải cấp HTTPS, giữ Authorization header, chuyển `/api` tới Node. Cập nhật URL webhook và Supabase Auth về domain thật. Không dùng Vite dev server để phục vụ production. Đặt cơ chế tự khởi động lại Node và sao lưu database cùng khóa mã hóa. Giữ token webhook ngoài source control; nếu lộ, thay token ở Pay2S và backend.

## 8. Xử lý lỗi

| Dấu hiệu | Kiểm tra |
| --- | --- |
| Webhook 401 | Token webhook sai, thiếu Bearer do proxy, token có khoảng trắng |
| Webhook 422 | Ngân hàng/số tài khoản không trùng cấu hình |
| Webhook 503 | Đang ở demo, thiếu cấu hình hoặc DB lỗi; chưa ghi nhận thành công toàn bộ batch |
| Webhook 400 | Payload sai kiểu, ID không hợp lệ, batch rỗng hoặc quá giới hạn |
| Web thao tác báo CSRF 403 | Origin trình duyệt khác `APP_ORIGIN`; khởi động lại sau đổi env |
| Webhook 200 nhưng ví/đơn chưa cập nhật | Kiểm tra event đối soát: sai số tiền, hết hạn, nội dung không tìm được mã duy nhất |
| Không có callback | Kiểm tra tài khoản liên kết, webhook bật, URL còn sống, backend/tunnel còn chạy |
| Tài khoản không truy cập được | Kiểm tra email xác minh, trạng thái khóa và phiên bị thu hồi |

Đối soát chỉ sau khi kiểm tra giao dịch nhận thật. Không sửa tay số dư hoặc trạng thái đơn để bỏ qua ledger. Nếu đổi từ nhà cung cấp cũ, tắt callback cũ và đối soát các yêu cầu đang chờ trước khi bật Pay2S; ID nhà cung cấp khác nhau không thể dùng để tự phát hiện cùng một giao dịch lịch sử.

Giới hạn hiện tại: chưa tự đồng bộ lịch sử ngân hàng qua polling; inbox là thông báo trong web, chưa gửi email/push; trường `method=sepay` trong dữ liệu đơn vẫn biểu thị chuyển khoản ngân hàng để tương thích schema cũ, nhà cung cấp thực sự do `BANK_PAYMENT_PROVIDER` quyết định.
