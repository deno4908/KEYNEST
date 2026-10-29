# Giảm lưu lượng Supabase cho KEYNEST

Thay đổi này giảm các lần đọc lặp; không xóa hoặc đặt lại egress đã phát sinh.
Mức dùng thực tế phải theo dõi trong Usage, tính trên toàn bộ organization.

## Những chỗ đã sửa

- Catalog SSE dùng chung trong mỗi tiến trình Node: kiểm tra dấu vân tay dữ liệu
  mỗi 10 giây thay vì tải toàn bộ danh mục mỗi 2 giây. Dấu vân tay được tính từ
  sản phẩm công khai, biến thể đang bán, tổng hợp đánh giá và tên người bán.
  Khi không đổi, RPC chỉ trả chuỗi 32 ký tự; vẫn có chi phí đọc/tính hash tại DB.
- Tải lại đầy đủ khi dấu vân tay đổi, sau thao tác ghi qua API, hoặc ít nhất mỗi
  5 phút khi có người kết nối. Tab mới dùng chung snapshot. Không có kết nối
  thì không chạy polling catalog. Mỗi tiến trình/replica có một bộ polling riêng.
- Thiếu migration 055: ứng dụng vẫn hoạt động, tải đầy đủ mỗi 10 giây và cảnh
  báo một lần. Áp dụng migration rồi khởi động lại để bật kiểm tra nhẹ.
- Tra cứu một sản phẩm chỉ lấy thống kê đánh giá cho sản phẩm đó.
- Trang người bán tải overview mỗi 30 giây thay vì 5 giây. Vẫn cập nhật sau
  thao tác và khi trở lại trang; polling hỗ trợ/chat giữ nguyên.
- Ảnh công khai `/api/media/<uuid>.webp` có cache trên đĩa VPS (tối đa 256 MiB
  mỗi project/tiến trình ghi); gộp các lượt tải đồng thời cùng ảnh. Cache tồn tại
  qua lần khởi động lại, chỉ tải Storage khi thiếu ảnh. Khi đầy, loại ảnh cũ.
  Cache lỗi vẫn phục vụ ảnh từ Storage. Không lưu mã giao hàng, đơn hay phiên.
- Polling Tingee (migration 056): mỗi batch chỉ lấy trường cần đối soát, bỏ ảnh
  QR base64; mỗi lần kiểm tra chỉ ghi kết quả bằng một RPC, thay cho nhiều PATCH.
  Lịch tiếp theo do giờ database quyết định, có token chống worker cũ ghi đè.
  Thành công: QR động đang chờ vẫn hẹn 5 giây, QR tĩnh 30 giây, QR tĩnh đã kết
  thúc 10 phút để tiếp tục phát hiện chuyển khoản muộn trong cửa sổ 7 ngày.
  Lỗi tăng thời gian chờ: đang chờ 15/30/60/... tối đa 300 giây; đã hết hạn tối
  đa 1 giờ. Lỗi không đổi cổng đã chốt và không tự đóng một route chưa đối soát.
  Timer chạy 5 giây, hàng đợi rỗng lâu thì hỏi DB mỗi 30 giây; tạo QR mới ở cùng
  tiến trình đánh thức queue. Nếu tạo QR ở replica khác, có thể chờ thêm tối đa
  khoảng 30 giây để replica đang nghỉ kiểm tra lại.

Kiểm tra tồn kho/giá trước khi thêm giỏ và giao dịch đặt hàng vẫn đọc dữ liệu
hiện hành. Cache catalog chỉ phục vụ hiển thị, không quyết định trừ tiền/giao mã.

## Áp dụng trên VPS Ubuntu

1. Sao lưu dữ liệu như quy trình triển khai hiện tại. Trong Supabase SQL Editor,
   chạy `supabase/migrations/055_catalog_live_version.sql` **một lần** nếu chưa
   chạy, rồi `supabase/migrations/056_tingee_poll_budget.sql`, sau các migration
   trước đó. Chỉ `service_role` được gọi các RPC nội bộ này. Mã Node mới yêu cầu
   schema 056 để khởi động; cần triển khai migration trước rồi restart toàn bộ
   tiến trình Node dùng cùng project (gồm local dev nếu đang trỏ vào production).
   Worker phiên bản cũ có thể kiểm tra chậm hơn trong thời gian chuyển tiếp vì
   chưa biết cách nhả lease mới; hoàn tất nâng cấp/restart trong cùng đợt deploy.
2. Triển khai mã nguồn có thay đổi này, chạy `npm ci` và `npm run build`.
3. Giữ cache ở thư mục ổn định, nằm ngoài thư mục release nếu mỗi lần deploy
   tạo thư mục mới. Thêm vào biến môi trường **của tiến trình ứng dụng**:

   ```dotenv
   MEDIA_CACHE_DIR=/var/cache/keynest/media
   ```

   Tạo thư mục bằng `sudo mkdir -p /var/cache/keynest/media` và cấp quyền ghi
   cho đúng tài khoản chạy Node. Ví dụ **chỉ khi tài khoản đó là `keynest`**:

   ```bash
   sudo chown keynest:keynest /var/cache/keynest/media
   sudo chmod 750 /var/cache/keynest/media
   ```

   Nếu không đặt biến, mặc định là `.data/media-cache` trong thư mục chạy app.
   Ảnh chỉ là bản sao, Supabase Storage vẫn giữ bản gốc. Các file ảnh UUID là
   bất biến; không ghi đè nội dung khác vào cùng tên file.
4. Khởi động lại ứng dụng bằng PM2 hoặc systemd theo cách đang vận hành. Nếu
   PM2 lấy biến từ shell/ecosystem, bảo đảm cập nhật môi trường của process.
5. Mở cùng sản phẩm ở hai trình duyệt. Mua hết tồn ở một bên: bên còn lại phải
   cập nhật; ngay cả khi SSE mất kết nối, thao tác thêm giỏ vẫn phải kiểm tra lại.
   Kiểm tra ảnh vẫn hiển thị sau khi restart, không có cảnh báo cache.

## Đo xem đã đủ cho Free chưa

- Trong Organization → Usage, chọn đúng kỳ và project. Xem biểu đồ egress theo
  ngày; rê chuột để xem Database/Storage/Auth. Chờ dữ liệu cập nhật (khoảng 1 giờ).
- Mục tiêu vận hành đề xuất: dưới **4 GB/kỳ** cho hạn mức uncached 5 GB, để có
  phần dự phòng. Với kỳ 30 ngày, 4 GB tương đương khoảng **133 MB/ngày**. Đây là
  ngân sách đề xuất, không phải mức sử dụng đã đo hay hạn mức bổ sung.
- So sánh ít nhất 24–48 giờ có lượng truy cập tương tự. Không lấy tổng egress
  đã dùng chia cho vài giờ ngay sau deploy rồi coi đó là hiệu quả tối ưu.
- Nếu vẫn tăng nhanh: kiểm tra endpoint bị gọi nhiều trong API Logs và Query
  Performance; ưu tiên phân trang overview/lịch sử lớn và giảm polling ở đúng
  màn hình gây tải. Các API xác thực vẫn không được cache chung giữa tài khoản.
- Không cache `/api/*` hàng loạt ở Cloudflare/Nginx; có thể lộ dữ liệu cá nhân.
- Có thể giảm truy vấn khi phát triển bằng `APP_MODE=demo` trong môi trường
  local riêng; demo không chứa dữ liệu Supabase và không dùng cho production.

Dung lượng database nhỏ không đồng nghĩa egress thấp: đọc lại cùng dữ liệu
nhiều lần vẫn cộng vào egress. Xóa bảng, ảnh hoặc log không giảm số đã ghi nhận.
Kiểm tra ngày kết thúc kỳ trong Billing; không mặc định là ngày đầu tháng hoặc
ngày cảnh báo hạn chế. Không bảo đảm tránh hạn chế của kỳ hiện tại đã vượt.

## Chẩn đoán log payment_routes lặp liên tục

Log được cung cấp ngày 29/10/2026 có 23,1 nghìn API Gateway request/60 phút;
50 dòng đang hiển thị phần lớn là PATCH payment_routes lặp các payment ID.
Đây là bằng chứng worker thanh toán có nhiều request; chưa đủ để phân bổ toàn
bộ số GB egress/log cho riêng worker. Hàm claim cũ còn trả cả qr_image trong mỗi
batch. Mã cũ hẹn next_poll_at bằng Date.now trên VPS, nên nếu VPS chậm hơn DB,
các lịch ghi vào quá khứ có thể khiến worker nhận lại cùng route liên tục.

Kiểm tra giờ trên VPS (chỉ đọc):

```bash
date -u
timedatectl status
```

Kiểm tra giờ DB, so sánh cùng múi giờ UTC, không suy từ nhãn giờ hiển thị UI:

```sql
select clock_timestamp() at time zone 'UTC' as database_utc;
```

Thống kê route chưa đóng, không lấy ảnh QR hay tài khoản ngân hàng:

```sql
select r.qr_kind, p.status, r.last_error, count(*) as routes,
       count(*) filter (where r.next_poll_at <= now()) as due_now,
       min(r.next_poll_at) as earliest_next_poll
from public.payment_routes r
join public.payments p on p.id = r.payment_id
where r.provider = 'tingee' and r.state = 'ready' and not r.remote_closed
group by r.qr_kind, p.status, r.last_error
order by routes desc;
```

Nếu last_error là tingee_static_va_required, route cũ không khớp VA đã liên kết.
Nếu là lỗi xác thực/provider hoặc bill mismatch, cần xử lý nguyên nhân tương ứng.
Không xóa payment_routes hoặc đánh dấu hàng loạt remote_closed=true để giảm log;
có thể làm bỏ sót khoản chuyển tiền chưa đối soát. Kiểm tra số tiến trình PM2 /
local dev đang dùng production, tránh chạy nhiều bản app ngoài ý muốn.

Nguồn chính thức:
- https://supabase.com/docs/guides/platform/manage-your-usage/egress
- https://supabase.com/docs/guides/platform/manage-your-usage/logs-ingest
- https://supabase.com/docs/guides/platform/billing-faq
