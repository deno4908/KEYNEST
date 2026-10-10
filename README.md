# KEYNEST

Deploy từ GitHub private lên VPS không Docker: [hướng dẫn CI/CD từ A đến Z](docs/CICD-VPS.md).

Cửa hàng game key, gift card, nạp game và dịch vụ MMO/proxy. Frontend React + TypeScript; backend **Node.js + Express**; database và xác thực thật dùng **Supabase**. Thanh toán chuyển khoản **Pay2S/MBBank**, hoặc số dư ví nội bộ. Xem [setup Pay2S từ A đến Z](docs/PAY2S-SETUP.md) và [backend vận hành mới](docs/OPERATIONS.md).

## Chạy nhanh

Yêu cầu Node.js 22.12+ hoặc 24, npm.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Mở **http://127.0.0.1:5173**. API chạy tại `http://127.0.0.1:3001`. Dùng đúng địa chỉ trong `APP_ORIGIN`; nếu chuyển sang `localhost`, hãy sửa cấu hình origin rồi khởi động lại API.

Mặc định `APP_MODE=demo`: dữ liệu mẫu lưu ở `.data/demo.json`. Có nhãn demo và nút mô phỏng thanh toán; không nhận tiền thật. Demo chỉ phục vụ chạy thử, không phải Supabase dự phòng và bị chặn khi `NODE_ENV=production`.

| Vai trò    | Email                   | Mật khẩu      |
| ---------- | ----------------------- | ------------- |
| Khách hàng | `student@keynest.local` | `Student123!` |
| Quản trị   | `admin@keynest.local`   | `Admin123!`   |

Khách mẫu có 1.500.000đ mô phỏng. Tài khoản đăng ký mới bắt đầu với 0đ. Đăng nhập quản trị, vào **Tài khoản → Quản trị cửa hàng** hoặc `/admin`.

## Chức năng

Hướng dẫn quản trị banner, phân loại và bảng đối chiếu phạm vi: [docs/STOREFRONT.md](docs/STOREFRONT.md).

Đơn hàng có trang xem key riêng, ảnh sản phẩm và yêu cầu bảo hành theo từng mã. Cấu hình thời hạn từng gói (mặc định 30 ngày), tính từ lúc giao, không thay đổi quyền lợi đơn cũ: [docs/ORDERS.md](docs/ORDERS.md).

Quản trị hỗ trợ tải ảnh từ thiết bị, mã giảm giá theo điều kiện/lượt dùng, chi tiết người mua và sản phẩm, lịch sử trao đổi, hoàn tiền gắn với bảo hành: [docs/ADMIN.md](docs/ADMIN.md).

Backend danh mục, tài khoản, tra cứu kho/đơn/hỗ trợ: [docs/BACKEND.md](docs/BACKEND.md). Trang danh mục đã gọi API tìm kiếm/phân trang; trang bảo mật tài khoản có form đổi mật khẩu. Chạy riêng Node bằng `npm run dev:api`.

| Phần       | Đã triển khai                                                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cửa hàng   | Menu nhiều tầng; 4 nhóm và phân loại con từ dữ liệu; gợi ý tìm kiếm; lọc nền tảng/khu vực/giá/tồn kho/cách giao; sắp xếp/phân trang; chi tiết; biến thể; giỏ hàng |
| Trang chủ  | Banner tự chuyển có điều khiển; quản trị banner; thư mục danh mục; trang ưu đãi; sản phẩm vừa xem; hướng dẫn mua hàng                                             |
| Tài khoản  | Đăng ký/đăng nhập/đăng xuất; cập nhật tên; khôi phục mật khẩu bằng email trong chế độ Supabase                                                                    |
| Mua hàng   | Giá tính trên server; mã giảm giá; số lượng; thông tin UID/server/dịch vụ; idempotency                                                                            |
| Kho        | Nhập mã; mã hóa AES-256-GCM; giữ kho cho đơn chuyển khoản 15 phút; tự giao key; trả kho khi hết hạn/hủy; loại mã chưa bán có audit |
| Thanh toán | QR ngân hàng; Pay2S webhook Bearer token; chống xử lý trùng; kiểm tra tài khoản và số tiền; SePay là tùy chọn tương thích |
| Ví         | Nạp; thanh toán; lịch sử biến động; hoàn đơn vào ví; đối soát tiền chuyển sai/quá hạn vào ví                                                                      |
| Dịch vụ    | Hàng đợi nạp game/MMO; quản trị viên giao kết quả đã mã hóa vào đơn                                                                                               |
| Hỗ trợ     | Ticket khách hàng; phản hồi quản trị; đánh giá sau khi đơn hoàn thành                                                                                             |
| Quản trị   | Tổng quan; sản phẩm/biến thể; ẩn sản phẩm; nhập kho; giao dịch vụ; hoàn tiền; coupon; khách hàng; đối soát; nhật ký                                               |

Nạp game/proxy đang dùng **quy trình giao thủ công**, chưa có API nhà cung cấp vì chưa được cung cấp nhà cung cấp/khóa kết nối. Ví là ví mua hàng nội bộ, không có rút tiền tự động. Hoàn đơn hỗ trợ cộng ví hoặc ghi nhận đã hoàn ngoài theo yêu cầu bảo hành; không tự chuyển tiền ngân hàng. Coupon có giới hạn tổng lượt, lượt mỗi khách và điều kiện áp dụng. Pay2S cần token webhook và cấu hình tài khoản thật để kiểm tra end-to-end, xem [hướng dẫn setup](docs/PAY2S-SETUP.md).

Đăng nhập Google/Discord đã tích hợp qua Supabase Auth; xem [hướng dẫn bật OAuth](docs/OAUTH.md). Form đăng ký có xác nhận mật khẩu, chuyển tab có hiệu ứng và hỗ trợ tùy chọn giảm chuyển động.

## Kết nối Supabase thật

1. Tạo dự án Supabase riêng. Trong SQL Editor, chạy lần lượt:
   - `supabase/migrations/001_store.sql`
   - `supabase/migrations/002_reconciliation.sql`
   - `supabase/migrations/003_storefront.sql`
   - `supabase/migrations/004_product_feedback.sql`
   - `supabase/migrations/005_order_warranty.sql`
   - `supabase/migrations/006_admin_operations.sql`
   - `supabase/migrations/007_catalog_backend.sql`
   - `supabase/migrations/008_operations.sql`
   - `supabase/migrations/009_oauth_avatar.sql`
   - `supabase/migrations/010_avatar_upload.sql`
   - `supabase/migrations/011_admin_notifications.sql`
   - `supabase/migrations/012_announcements.sql`
   - `supabase/migrations/013_notification_deletion.sql`
   - `supabase/migrations/014_coupon_pin.sql`
   - `supabase/migrations/015_permission_hardening.sql`
   - `supabase/migrations/016_categories.sql`
2. Chạy migration **trước** khi tạo tài khoản ứng dụng để trigger tạo `profiles`. Nếu đã có user trước migration, thêm profile cho đúng `auth.users.id` bằng SQL quản trị.
3. Điền `.env`:

```dotenv
APP_MODE=supabase
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_SERVICE_ROLE_OR_SECRET_KEY
INVENTORY_ENCRYPTION_KEY=64_HEX_CHARACTERS
```

Sinh khóa mã hóa và khóa webhook, mỗi lần chạy tạo một khóa riêng:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`INVENTORY_ENCRYPTION_KEY` cần giữ ổn định sau khi nhập kho. Sao lưu riêng khóa này cùng quy trình phục hồi database. Không đặt secret dưới tên bắt đầu bằng `VITE_` và không commit `.env`.

4. Trong Supabase Auth: bật Email/password, cấu hình Site URL và Redirect URLs cho `APP_ORIGIN` và `APP_ORIGIN/reset-password`. Cấu hình SMTP cho việc gửi thư thực tế. Xác minh email theo cấu hình của dự án.
5. Nạp danh mục mẫu:

```powershell
npm run seed
```

Seed giữ nguyên sản phẩm đã tồn tại và **không nhập mã demo vào Supabase**. Gói giao key bắt đầu với tồn kho 0; quản trị viên cần nhập mã thật. Giá/dịch vụ trong seed là nội dung minh họa và cần được kiểm tra trước khi mở bán.

6. Đăng ký tài khoản quản trị qua website, xác minh email, rồi cấp quyền trong SQL Editor:

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'YOUR_ADMIN_EMAIL');
```

Backend đọc role từ `profiles`; người dùng không tự cấp quyền bằng metadata hay request.

## Cấu hình SePay (tùy chọn tương thích)

Kafka + Redis cho xử lý webhook qua worker và rate limit dùng chung: xem [hướng dẫn hạ tầng](docs/KAFKA-REDIS.md). Bật bằng `KAFKA_ENABLED`/`REDIS_ENABLED`; mặc định tắt để giữ chế độ demo. Cần chạy thêm `npm run worker:payments` khi bật Kafka.

Ứng dụng dùng **SePay Bank Transfer Webhook**, không dùng SePay Payment Gateway/checkout SDK.

```dotenv
SEPAY_WEBHOOK_KEY=YOUR_RANDOM_SECRET_AT_LEAST_32_CHARACTERS
BANK_PAYMENT_PROVIDER=sepay
BANK_CODE=VCB
BANK_ACCOUNT_NUMBER=YOUR_RECEIVING_ACCOUNT
BANK_ACCOUNT_NAME=YOUR_ACCOUNT_HOLDER
SEPAY_BANK=VCB
SEPAY_ACCOUNT_NUMBER=YOUR_RECEIVING_ACCOUNT
SEPAY_ACCOUNT_NAME=YOUR_ACCOUNT_HOLDER
```

Trong SePay, liên kết tài khoản nhận tiền rồi tạo webhook:

- URL: `https://YOUR_DOMAIN/api/webhooks/sepay`
- Sự kiện: có tiền vào.
- Xác thực: API Key, dùng đúng `SEPAY_WEBHOOK_KEY`. Header SePay gửi: `Authorization: Apikey <key>`.
- Mã thanh toán bắt đầu bằng `KN`, sau đó 16 ký tự hex. Website tạo QR có số tiền và nội dung chính xác.
- Backend trả `200` với `{"success":true}` khi đã xử lý hoặc ghi nhận giao dịch cần đối soát. Giao dịch lặp không ghi tiền lần nữa.

Endpoint local không nhận webhook từ Internet. Dùng HTTPS của môi trường triển khai hoặc tunnel dành cho kiểm thử, cập nhật `APP_ORIGIN` theo địa chỉ trình duyệt đang mở. Không đưa webhook key vào frontend.

Sai số tiền, mã không nhận diện, đơn hết hạn/đã hủy hoặc chuyển thêm vào mã đã thanh toán đều vào **Quản trị → Thanh toán → Giao dịch cần đối soát**. Quản trị viên kiểm tra chứng từ, chọn đúng khách và nhập lý do; hệ thống cộng **số tiền thực nhận** vào ví đúng một lần. Khách có thể đặt lại đơn sau đó. Không tự giao hàng cho một đơn đã hết hạn.

Ngân hàng có quy định riêng cho nội dung chuyển khoản/VA cần kiểm tra với SePay trước khi chọn; cấu hình hiện tại sử dụng mã `KN...`.

## Kiểm tra

```powershell
npm test
npm run test:db
npm run test:ui
npm run build
```

- `npm test`: kiểm tra API và bảo mật với dữ liệu demo tạm, không sửa dữ liệu demo bạn đang dùng.
- `test:db`: chạy toàn bộ migration và kiểm tra transaction, grants, RLS trên PostgreSQL qua PGlite trong RAM. Auth được mô phỏng ở lớp `auth.users`/`auth.uid()`; không xác minh dịch vụ Supabase Auth thật hay tranh chấp giữa nhiều kết nối PostgreSQL.
- `test:ui`: Playwright, tự khởi động dev server nếu chưa có. Trên máy Windows này dùng Edge có sẵn. Máy khác chạy `npx playwright install chromium` trước. Các bài UI tạo tài khoản và dữ liệu kiểm thử trong **demo đang chạy**; chỉ chạy khi `APP_MODE=demo`.
- `build`: TypeScript và Vite, xuất frontend vào `dist/`.

Sau build, có thể chạy `node scripts/check-built.js` để kiểm tra 8 trang từ chính Node server, CSP, cookie HttpOnly và bố cục desktop/mobile. Script này dùng database demo tạm riêng.

## Triển khai Node.js

```powershell
npm ci
npm run build
npm start
```

Đặt `NODE_ENV=production`, `APP_MODE=supabase`, `APP_ORIGIN=https://YOUR_DOMAIN`, cấu hình đầy đủ Supabase, mã hóa và Pay2S. Node phục vụ cả `dist/` lẫn `/api`, phù hợp VPS/container hoặc dịch vụ chạy Node. Cần HTTPS tại reverse proxy. Nếu sau đúng một reverse proxy, đặt `TRUST_PROXY=1`; không tăng số này tùy tiện. Xem [setup đầy đủ](docs/PAY2S-SETUP.md).

`npm start` dùng `APP_ORIGIN` đã cấu hình; nếu chạy build thử local ở cổng 3001 thì đổi origin thành `http://127.0.0.1:3001`. Production cookie có `Secure`, nên bắt buộc HTTPS.

Hết hạn giữ kho được xử lý mỗi phút trong Node và khi truy vấn danh mục/đơn/thanh toán. Khi Node dừng, việc dọn tiếp tục sau khi chạy lại. Chưa có queue/cron độc lập, Redis rate limit, MFA quản trị hay dịch vụ gửi email thông báo đơn hàng. Đây là giới hạn cần đánh giá khi vận hành nhiều instance hoặc bán hàng thật.

## Cấu trúc mã nguồn

```text
src/                  React/TSX, giao diện và API client
  Storefront.tsx      Trang chủ cửa hàng nền tối
  App.tsx             Router, phiên đăng nhập và các trang khách hàng
  Admin.tsx           Giao diện quản trị
  styles.css          Bố cục và responsive dùng chung
  dark.css            Thiết kế nền tối
server/               Node.js / Express
  index.js            API, validation, cookie, xác thực và phân quyền
  security.js         Scrypt, AES-GCM, CSRF, webhook helpers
  demo-store.js       Dữ liệu mô phỏng, chỉ development
  supabase-store.js   Adapter database thật
shared/catalog.js     Danh mục seed
supabase/migrations/  Schema, RLS, grants, transaction functions
tests/                API, bảo mật, UI
scripts/              Seed và PostgreSQL verification
docs/                 Kiến trúc, bài bảo mật và đặc tả API
```

Xem [kiến trúc và nội dung môn học](docs/COURSE.md), [API](docs/API.md), [kiểm thử bảo mật](docs/SECURITY.md).

Ảnh game trong danh mục mẫu tải từ Steam CDN; quyền thương hiệu/ảnh thuộc chủ sở hữu tương ứng. Trang tham khảo chức năng: [muakey.com](https://muakey.com/). Giao diện và mã nguồn dự án được xây riêng.

Tài liệu tích hợp: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser), [SePay webhook](https://docs.sepay.vn/tich-hop-webhooks.html), [SePay QR](https://docs.sepay.vn/tao-qr-code-vietqr-dong.html).
