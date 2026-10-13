# Bảo mật và bài thực hành

Chỉ thực hiện trên bản local hoặc môi trường do bạn quản lý. Các ví dụ nhằm kiểm tra biện pháp bảo vệ đã triển khai; không có chế độ cố ý bật lỗ hổng trong website.

## Biện pháp và giới hạn

| Mối đe dọa                    | Biện pháp                                                                                              | Nơi kiểm tra                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------- |
| Giả danh/đánh cắp phiên       | Supabase `getUser`; cookie HttpOnly, SameSite=Lax, Secure ở production; refresh token phía server      | `server/index.js`            |
| Nâng quyền                    | Role lấy từ bảng profiles; middleware admin; chặn thay role/balance bằng Zod strict và grants          | API + migration              |
| IDOR                          | Mọi đơn/ví/ticket khách đều ràng buộc `user_id` lấy từ phiên                                           | Hai store adapters, policies |
| SQL injection                 | PostgREST/RPC parameters; không ghép SQL từ input ứng dụng                                             | `supabase-store.js`          |
| XSS                           | React escape text; không dùng `dangerouslySetInnerHTML`; CSP và allowlist ảnh                          | React + Helmet               |
| CSRF                          | Origin chính xác + custom header `X-App-Request: keynest` cho mutation; không mở CORS; cookie SameSite | `requireOrigin`              |
| Brute force / spam            | Rate limit API, auth, tạo đơn, nạp ví, gửi ticket                                                      | Express middleware           |
| Sửa giá/số dư                 | Payload không nhận total/price/balance; SQL đọc giá và khóa ví; tiền dùng số nguyên                    | `create_order`               |
| Race condition / bán trùng mã | Row locks, khóa biến thể theo thứ tự, inventory `FOR UPDATE SKIP LOCKED`, transaction                  | Migration                    |
| Thanh toán lặp                | UNIQUE `payment_events.transaction_id`; mã payment riêng; idempotency tạo đơn                          | SQL + API tests              |
| Webhook giả                   | API Key so sánh timing-safe, kiểm tra tiền vào/tài khoản/số tiền/nội dung                              | SePay route                  |
| Lộ key/proxy khi DB bị đọc    | AES-256-GCM với IV ngẫu nhiên và authentication tag; encryption key chỉ ở server                       | `security.js`                |
| Hoàn tiền nhiều lần           | Admin chọn ticket bảo hành đúng đơn; khóa đơn, hoàn toàn bộ một lần; ledger và trạng thái cùng transaction | `resolve_warranty_refund` |
| Cộng sai khoản đối soát       | Chỉ admin; chỉ event đã nhận qua webhook, outcome needs_review; lấy amount trong DB; ghi lý do/audit   | `credit_reviewed_payment`    |

### Cần hiểu đúng

- AES-GCM bảo vệ nội dung kho nếu chỉ database bị lộ; không bảo vệ khi cả server và khóa mã hóa bị chiếm quyền.
- API dùng service role nên **bỏ qua RLS**; backend vẫn phải kiểm tra owner/role. RLS và grants là lớp bảo vệ bổ sung cho truy cập trực tiếp bằng anon/authenticated.
- Demo dùng scrypt, cookie token ngẫu nhiên và file JSON; khóa demo nằm cạnh dữ liệu để dễ chạy đồ án. Production bị chặn chạy demo.
- Session Supabase access token có TTL. Logout thu hồi phiên refresh và xóa cookie; token truy cập đã bị lấy cắp có thể còn hiệu lực theo chính sách Supabase đến khi hết hạn.
- Rate limit hiện dùng bộ nhớ một tiến trình. Khi chạy nhiều instance cần store chung. Đăng nhập quản trị chưa có MFA hay xác thực lại cho hoàn tiền.
- CSP production cho phép `style-src 'unsafe-inline'` phục vụ style; `script-src` chỉ self. Không bật script inline/eval.
- Audit quản trị thông thường được ghi ngay sau mutation; một lỗi riêng khi ghi audit có thể khiến mutation đã thành công nhưng log thiếu. Đối soát tài chính ghi audit cùng transaction. Không tuyên bố nhật ký hiện tại là hệ thống chống chỉnh sửa.

OAuth Google/Discord dùng PKCE S256, verifier mã hóa trong cookie HttpOnly có hạn 10 phút. Callback yêu cầu cookie của trình duyệt đã bắt đầu luồng; token được đổi phía Node và không đưa vào URL đích. Supabase xử lý state của nhà cung cấp. Xem [cấu hình và giới hạn kiểm thử OAuth](OAUTH.md).

## Bài thực hành có thể trình bày

### 1. Chặn sửa giá

Trong DevTools → Network, tìm request tạo đơn. Payload hợp lệ chỉ có variant ID và quantity. Gửi lại cùng `total: 1` hoặc thêm `price: 1`: API phải trả 400. Sửa giá trên DOM cũng không đổi giá ở database.

### 2. Chặn IDOR và nâng quyền

Tạo hai tài khoản A/B. A có đơn; B truy cập `/api/orders` chỉ thấy đơn B. B gọi hủy ID đơn A bị từ chối. Tài khoản khách gọi `/api/admin/overview` trả 403. PATCH `/api/me` kèm `role: "admin"` hoặc `balance` trả 400.

### 3. Chặn CSRF

Gửi mutation thiếu Origin, Origin không khớp hoặc thiếu `X-App-Request`: nhận 403. Webhook là ngoại lệ có xác thực API Key riêng, không dùng cookie khách.

### 4. XSS

Gửi tên/ticket/đánh giá chứa `<img src=x onerror=alert(1)>`. Trang phải hiển thị như văn bản, không tạo phần tử HTML hoặc thực thi mã. Đánh giá chỉ được gửi khi khách có đơn sản phẩm đã hoàn thành.

### 5. Chống giao dịch lặp

Trong demo, tạo nạp tiền rồi gửi hai request tới `/api/demo/pay/:id`: số dư chỉ tăng một lần. Trong môi trường SePay đã cấu hình, gửi lại cùng `id` webhook: một payment event, một lần ghi tiền. API test còn kiểm tra webhook thiếu key, sai tài khoản và tiền ra.

### 6. Transaction và kho

Chọn gói chỉ còn một mã; thử mua quá số lượng. Không được trừ ví hay giữ một phần kho khi thất bại. Tạo đơn SePay rồi hủy: số lượng và mã được trả về kho. Đơn đã nhận key rồi hoàn tiền: key đó không được bán lại.

### 7. RLS

`npm run test:db` chạy nguyên migration rồi dùng `SET ROLE anon/authenticated` và JWT subject stub. Cả hai role không được đọc trực tiếp `profiles`, `orders`, `order_items`, `payments`, `wallet_ledger`, `tickets`, `ticket_messages`, kể cả dữ liệu của chính mình. Node dùng service role và kiểm tra chủ dữ liệu, MFA, khóa tài khoản và trạng thái phiên. Các bảng danh mục công khai giữ quyền đọc theo RLS.

### 8. Thu hồi phiên

Chạy `supabase/migrations/031_private_data_sessions.sql` sau các migration trước đó, **trước khi triển khai backend tương ứng**. Migration chỉ đọc `auth.sessions`, không sửa schema hoặc xóa dữ liệu Supabase Auth. Chạy bằng role quản trị database có quyền tạo hàm và đọc bảng Auth; không cấp quyền đó cho browser.

`authorize_app_session` đối chiếu `session_id` của JWT đã được xác minh với `auth.sessions.user_id` và thời điểm tạo phiên gốc. `revoke_app_sessions` ghi mốc thu hồi theo tài khoản, giữ ngoại lệ cho phiên hiện tại khi chọn “các phiên khác”. Hai hàm khóa cùng hàng profile để tuần tự hóa việc đăng ký/thu hồi phiên. Refresh JWT không thay đổi thời điểm tạo phiên gốc. Khóa rồi mở lại tài khoản cũng không khôi phục phiên cũ.

Sau khi ghi mốc thu hồi, backend gọi Supabase Auth sign-out scope `others` để thu hồi các phiên còn lại ở nhà cung cấp. Nếu dịch vụ này lỗi, mốc thu hồi vẫn chặn API KEYNEST và endpoint trả lỗi để người dùng thử lại. Thu hồi riêng một phiên chặn phiên đó tại API KEYNEST. Đổi mật khẩu giữ phiên mới vừa xác minh bằng mật khẩu và thu hồi các phiên khác.

Kiểm thử HTTP tạo một phiên chưa từng gọi API riêng tư rồi thu hồi từ phiên khác; phiên chưa đăng ký phải nhận 401. Kiểm thử PostgreSQL bao gồm phiên cũ, phiên hiện tại, đăng nhập mới, thu hồi lặp, khóa/mở tài khoản, sai chủ dữ liệu và quyền RPC. PGlite dùng bảng `auth.sessions` mô phỏng; cần kiểm tra thêm trên Supabase thử nghiệm với hai trình duyệt và refresh token thật. Tham chiếu: [Supabase session_id và auth.sessions](https://supabase.com/docs/guides/auth/sessions).

## Bằng chứng kiểm tra

Chạy `npm test`, `npm run test:db`, `npm run test:ui`, `npm run build`. Số bài có thể tăng khi cập nhật. UI tests tự kiểm tra APP_MODE=demo trước khi tạo dữ liệu.

PGlite chạy một kết nối; test này kiểm tra rollback/idempotency/grants nhưng chưa chứng minh hành vi contention nhiều tiến trình. Trước vận hành thật, thử các request mua đồng thời trên Supabase riêng, webhook thật, email recovery, HTTPS và phục hồi dữ liệu/khóa.

Nguồn: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser), [SePay webhook](https://docs.sepay.vn/tich-hop-webhooks.html).
