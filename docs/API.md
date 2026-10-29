# API v1 của đồ án

Base path `/api`. JSON request/response. Lỗi có dạng `{ "error": "Thông báo" }`. Phiên đăng nhập dùng cookie HttpOnly. Với POST/PATCH ngoài webhook, gửi Origin đúng `APP_ORIGIN` và header `X-App-Request: keynest`.

Các API bổ sung cho backend: `GET /catalog`, `GET /products/:identifier`, `POST /me/password`, `GET /tickets/:id`, `GET /admin/orders/:id`, `GET /admin/tickets/:id`, `GET /admin/inventory/:variantId`. Xem query, payload, phân quyền và migration 007 tại [BACKEND.md](BACKEND.md).

## Public / auth

| Method | Path                    | Nội dung                                                        |
| ------ | ----------------------- | --------------------------------------------------------------- |
| GET    | `/health`               | Tình trạng API, mode                                            |
| GET    | `/config`               | Mode, trạng thái cấu hình thanh toán, tài khoản demo nếu có     |
| GET    | `/products`             | Sản phẩm đang bán và biến thể                                   |
| GET    | `/products/:id/reviews` | Đánh giá                                                        |
| GET    | `/promotions`           | Coupon công khai đang hiệu lực                                  |
| GET    | `/banners`              | Banner active=true, xếp theo sort_order rồi id                  |
| POST   | `/auth/register`        | `{email,password,name}`; Supabase có thể yêu cầu xác minh email |
| POST   | `/auth/login`           | `{email,password}`; thiết lập cookie                            |
| POST   | `/auth/logout`          | Xóa cookie / thu hồi phiên                                      |
| POST   | `/auth/forgot`          | `{email}`; gửi email recovery khi dùng Supabase                 |
| POST   | `/auth/reset`           | `{access_token,refresh_token,password}` từ email recovery       |

Mật khẩu đăng ký/reset tối thiểu 10 ký tự, tối đa 128, có chữ hoa, thường và số. Auth có rate limit. Các schema mutation dùng strict, từ chối field thừa.

OAuth: `POST /auth/oauth/:provider` với `google` hoặc `discord`, trả `{url}` để trình duyệt chuyển tới Supabase. Yêu cầu CSRF như các mutation khác. Trả 503 nếu demo hoặc provider chưa bật. `GET /auth/oauth/callback?code=...` xác minh cookie PKCE, đổi code ở server, đặt cookie phiên và chuyển tới `/account`; lỗi chuyển tới `/auth/error`. Xem [cấu hình OAuth](OAUTH.md).

Đánh giá/bình luận: `GET /products/:id/reviews?page=1` trả mảng, 20 mục/trang; `GET /products/:id/comments?page=1` trả `{items,total}`. Sản phẩm có `review_count`, `rating_average`, `rating_counts` (thứ tự 1–5 sao), tính từ dữ liệu đánh giá thật. Không có đánh giá thì số lượng/điểm bằng 0.

`GET /products?live=1` mở luồng SSE công khai, trả cùng dữ liệu sản phẩm đang mở bán như `GET /products`. Máy chủ chia sẻ một lần đọc cho các kết nối trong cùng tiến trình, kiểm tra thay đổi mỗi 2 giây và đẩy ngay sau các thao tác đơn hàng, kho, sản phẩm hoặc thanh toán qua API. Luồng có heartbeat và header `X-Accel-Buffering: no` cho Nginx. Không cần mở quyền Supabase Realtime cho trình duyệt.

Frontend đồng bộ trang sản phẩm, danh mục và giỏ qua luồng này; khi kết nối gián đoạn, tải lại dữ liệu mỗi 5 giây và khi quay lại tab/kết nối mạng. Thêm vào giỏ hoặc tăng số lượng luôn đọc tồn mới trước khi thay đổi giỏ. `PUT /cart` cũng từ chối thêm/tăng vượt tồn hoặc gói không còn bán với HTTP 409; vẫn cho giảm/xóa các dòng đã hết hàng. Giá và tồn cuối cùng tiếp tục được kiểm tra trong giao dịch tạo đơn.

`POST /comments` nhận `{product_id,body}` với nội dung 3–1.000 ký tự, yêu cầu đăng nhập; tên/người gửi do server xác định. `POST /comments/:id/delete` chỉ tác giả hoặc quản trị viên được xóa. `POST /reviews` chỉ nhận từ khách đã nhận hàng, một lần/sản phẩm. Gửi đánh giá và bình luận có rate limit riêng 12 lần/15 phút/IP. Chạy migration `004_product_feedback.sql` trước khi dùng Supabase thật. Bình luận không làm thay đổi điểm sao; nội dung hiển thị dưới dạng văn bản.

## Khách đã đăng nhập

| Method | Path                 | Nội dung                                                                         |
| ------ | -------------------- | -------------------------------------------------------------------------------- |
| GET    | `/me`                | Thông tin khách hiện tại                                                         |
| PATCH  | `/me`                | Chỉ `{name}`                                                                     |
| GET    | `/orders`            | Đơn của chính khách; key được giải mã chỉ khi đã trả tiền và chưa hoàn           |
| GET    | `/orders/:id`        | Chi tiết đơn thuộc khách; key, thông tin bảo hành từng dòng và `warranty_requests` |
| POST   | `/orders/:id/warranty` | `{key_ids: UUID[], message}`; chọn mã đã giao, mô tả 10–3.000 ký tự; 8 lần/15 phút/IP |
| POST   | `/coupons/preview`   | `{code,items}`; giá/điều kiện/lượt dùng tính trên server, trả `{code,subtotal,discount,total}` |
| POST   | `/tickets/:id/messages` | `{body}` 3–3.000 ký tự; thêm tin nhắn vào yêu cầu của khách, mở lại trạng thái |
| POST   | `/orders`            | Tạo đơn; cần UUID `Idempotency-Key`                                              |
| POST   | `/orders/:id/cancel` | Hủy đơn pending thuộc khách                                                      |
| GET    | `/wallet`            | Số dư, ledger, yêu cầu nạp                                                       |
| POST   | `/wallet/topup`      | `{amount}`: 10.000–50.000.000 VND, số nguyên                                     |
| POST   | `/demo/pay/:id`      | Chỉ demo; mô phỏng thanh toán payment của chính khách                            |
| GET    | `/tickets`           | Ticket của khách                                                                 |
| POST   | `/tickets`           | `{subject,message}`                                                              |
| POST   | `/reviews`           | `{product_id,rating,comment}`; phải đã mua/nhận; mỗi khách một đánh giá/sản phẩm |

Ví dụ tạo đơn:

```json
{
  "items": [{ "variant_id": "VARIANT_UUID", "quantity": 1 }],
  "method": "wallet",
  "coupon": "WELCOME10",
  "customer_note": ""
}
```

`method` là `wallet` hoặc `sepay`. 1–20 dòng khác variant, mỗi dòng 1–10 đơn vị. `customer_note` bắt buộc có nội dung nếu mua dịch vụ. Tổng tiền/coupon/tồn kho được tính trên server. Đơn mới trả 201, có `payment` nếu thanh toán SePay.

## Quản trị

Migration `005_order_warranty.sql` thêm `warranty_days` (0–3.650, mặc định 30) vào gói. API lưu gói nhận trường này; bỏ qua khi cập nhật sẽ giữ giá trị cũ. Đơn chụp lại thời hạn tại lúc mua, tính từ `delivered_at` của từng dòng. API trả `warranty_expires_at` và `warranty_status`: `active`, `expired`, `none`, `verify` (đơn cũ thiếu dữ liệu), `unavailable` (chưa nhận/đã hủy hoặc hoàn tiền). `key_ids` ứng với từng phần tử `keys`, chỉ được trả cho đơn đã trả tiền chưa hoàn. Ticket bảo hành có `kind=warranty`, `order_id`, `warranty_key_ids` do server kiểm tra; không nhận user ID hay thời hạn từ client. Phản hồi qua API ticket quản trị hiện có. Xem [ORDERS.md](ORDERS.md).

| Method | Path                            | Nội dung                                                                                           |
| ------ | ------------------------------- | -------------------------------------------------------------------------------------------------- |
| GET    | `/admin/overview`               | Sản phẩm, khách, đơn, payment, event, coupon, audit                                                |
| GET    | `/admin/banners`                | Tất cả banner, gồm bản đang ẩn                                                                     |
| POST   | `/admin/banners`                | `{id?,title,eyebrow,description,image,href,cta,active,sort_order}`; liên kết nội bộ, ảnh Steam CDN |
| POST   | `/admin/products`               | Tạo/cập nhật sản phẩm; id tùy chọn; ẩn bằng active=false                                           |
| POST   | `/admin/products/:id/variants`  | Tạo/cập nhật gói; giá nguyên VND, delivery key/manual                                              |
| POST   | `/admin/inventory/:id`          | Variant ID; `{secrets:["CODE1","CODE2"]}`, 1–100 mã khác nhau                                      |
| POST   | `/admin/orders/:id/fulfill`     | `{secrets:["Kết quả 1", ...]}`; đủ một dòng mỗi đơn vị dịch vụ                                     |
| POST   | `/admin/orders/:id/refund`      | Hoàn toàn bộ đơn theo yêu cầu bảo hành; vào ví hoặc xác nhận đã hoàn bên ngoài (xem mục migration 006) |
| POST   | `/admin/tickets/:id/reply`      | `{reply}`                                                                                          |
| POST   | `/admin/coupons`                | `{code,percent,max_discount,active,expires_at}`; expires_at ISO hoặc null                          |
| POST   | `/admin/reconcile/:transaction` | `{user_id,reason}`; chuyển event needs_review thành credited                                       |

Không có API tự nâng quyền khách. Không đổi `delivery` của biến thể đã tồn tại; tạo biến thể mới khi cần đổi loại giao. Kho key chỉ tăng bằng nhập mã, không bằng sửa số stock. Ảnh sản phẩm nhận đường dẫn đã tải lên, tài nguyên có sẵn hoặc URL HTTPS Steam CDN; để trống dùng ảnh mặc định theo sản phẩm.

### Quản trị mở rộng (migration 006)

`POST /admin/media`: body nhị phân với Content-Type `image/jpeg`, `image/png`, `image/webp`, tối đa 8 MB. Trả `{url,width,height,bytes}` sau giải mã/chuyển WebP. `GET /media/:uuid.webp` công khai, chỉ phục vụ tên do server tạo. Sản phẩm/banner chấp nhận đường dẫn ảnh này. Không gửi multipart hoặc base64 JSON.

`POST /admin/coupons` bổ sung `discount_type` (`percent`/`fixed`), `fixed_amount`, `min_subtotal`, `total_limit`, `per_user_limit`, `starts_at`, `category`, `product_ids`, `first_order_only`. Các giới hạn lượt là số nguyên 1–1.000.000 hoặc null. API overview có `used_count`/`reserved_count`; public promotions loại các mã chưa bắt đầu/hết lượt. Xem quy tắc tại [ADMIN.md](ADMIN.md).

`GET /tickets`/overview trả thêm `priority`, `updated_at`, `messages` với vai trò, tác giả, nội dung, thời gian. `POST /admin/tickets/:id/reply` nhận `{reply,status?,priority?}`; mặc định status `closed`, priority `normal`; thêm tin nhắn thay vì ghi đè lịch sử. Các status là `open`, `in_progress`, `closed`; priority là `low`, `normal`, `high`.

`POST /admin/orders/:id/refund` nay bắt buộc `{ticket_id,method,reason,reference?}`. `method=wallet` hoàn vào ví; `external` chỉ xác nhận đã hoàn ngoài và bắt buộc `reference` 3–200 ký tự. `reason` 10–2.000 ký tự; ticket phải là bảo hành đúng đơn. API lưu `refunded_at`, `refund_method`, `refund_reason`, `refund_reference`, `refund_ticket_id`, `refunded_by`, đóng ticket và thêm phản hồi. Người mua được thấy thông tin này, key của đơn refunded không được trả.

## Webhook

Nếu `KAFKA_ENABLED=true`, callback hợp lệ được lưu vào Kafka với `acks=all` trước HTTP 200, rồi worker cập nhật DB và commit offset. `success:true` là đã tiếp nhận, không phải đã thanh toán xong; luôn đọc payment status từ API. Broker lỗi trả 503, không fallback sang xử lý trực tiếp. Xem [KAFKA-REDIS.md](KAFKA-REDIS.md). Mô tả settlement trực tiếp phía dưới áp dụng khi Kafka tắt.

Pay2S mặc định: `POST /webhooks/pay2s`, xác thực `Authorization: Bearer <PAY2S_WEBHOOK_TOKEN>`. Nhận `{transactions:[...]}` (1–100 giao dịch) hoặc giao dịch đơn, kiểm tra gateway/tài khoản, tiền vào, số tiền và mã KN. ID event có namespace Pay2S theo tài khoản để xử lý gửi trùng. Chỉ trả 200 `{success:true}` sau khi xử lý bền vững; lỗi lưu trữ trả 503. Quản trị có `GET /admin/bank-payments/status`, phản ánh cấu hình và lần webhook gần nhất trong tiến trình hiện tại; không có API polling/sync. Xem [PAY2S-SETUP.md](PAY2S-SETUP.md). Chỉ nguồn được chọn trong `BANK_PAYMENT_PROVIDER` được xử lý. Các API vận hành mới được mô tả tại [OPERATIONS.md](OPERATIONS.md).

`POST /webhooks/sepay` với `Authorization: Apikey <SEPAY_WEBHOOK_KEY>`. Không cần cookie/Origin/custom header. Payload SePay gồm id, accountNumber, transferType, transferAmount, content, code tùy chọn. API chỉ ghi nhận tiền vào đúng tài khoản; mã không rõ hoặc số tiền không khớp được đưa vào đối soát. Trả `success:true` khi ghi nhận thành công, kể cả bản gửi trùng.

Không ghi nhận đã thanh toán từ nút phía client, URL chuyển hướng hay ảnh QR. Endpoint `/demo/pay` trả 404 khi chạy Supabase.
