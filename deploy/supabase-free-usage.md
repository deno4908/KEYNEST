# Giảm lưu lượng Supabase cho KEYNEST

Thay đổi này giảm các lần đọc lặp; không xóa hoặc đặt lại egress đã phát sinh.
Mức dùng thực tế phải theo dõi trong Usage, tính trên toàn bộ organization.

## Bổ sung ngày 06/11/2026

- API kiểm tra thanh toán `GET /api/payments/:id` chỉ trả `id` và `status`,
  truy vấn đúng payment của tài khoản hiện tại. Hộp QR kiểm tra mỗi 5 giây sau
  khi có QR, thay vì tải cả đơn hàng, khóa đã giao, yêu cầu bảo hành hoặc lịch sử
  ví mỗi 2 giây. Chỉ dùng `?details=1` khi QR còn đang tạo; sau đó giữ ảnh đã có.
  Khi nhận thanh toán thành công, tải lại đơn/ví như trước. Endpoint riêng không
  cache trạng thái thanh toán và không bỏ kiểm tra xác thực/thu hồi phiên.
- Danh mục, tìm kiếm, chi tiết sản phẩm, banner và khuyến mãi công khai dùng
  cache trong tiến trình tối đa 10 giây; gộp các lượt đọc cùng lúc. Giới hạn 64
  mục và 8 MiB dữ liệu JSON được giữ, không lưu vô hạn theo từ khóa tìm kiếm.
  Thay đổi qua API đơn hàng, quản trị, người bán và webhook xóa cache sau khi
  thành công. SSE và lượt đọc danh mục dùng cùng cache; fingerprint thay đổi
  cũng xóa cache. Cache chỉ chứa dữ liệu hiển thị công khai.
- Tác vụ hết hạn thanh toán/giải phóng doanh thu gộp lượt chạy đồng thời và
  có khoảng nghỉ 30 giây sau thành công. Thêm giỏ hàng và kiểm tra coupon yêu
  cầu chạy mới; checkout và đối soát vẫn kiểm tra hạn/thực hiện giao dịch ở DB.
  Đơn chờ có thể mất tối đa khoảng 30 giây để cập nhật trong danh sách; hộp QR
  có endpoint hiển thị hết hạn ngay theo thời hạn thanh toán.
- Bỏ lượt đọc `account_controls` bị trùng trong xác thực: RPC
  `authorize_app_session` vốn đã kiểm tra khóa tài khoản và thu hồi phiên.
  RPC vẫn chạy mỗi yêu cầu; không cache quyết định phân quyền.
- Queue email rỗng hoặc không truy cập được DB nghỉ 60 giây trước khi hỏi lại,
  thay vì hỏi mỗi 15 giây. Email mới có thể chờ khoảng một phút khi queue đang
  nghỉ; giao hàng và thanh toán không phải chờ email. Đối soát Tingee giữ nguyên.
- Danh sách đơn chỉ tự tải mỗi 30 giây khi tab hiển thị và khi quay lại tab.
  Danh sách nạp ví chờ thanh toán tải mỗi 15 giây; hộp QR dùng luồng nhỏ riêng.
- Tách JavaScript quản trị, người bán, tài khoản và đơn hàng theo trang.
  Asset có fingerprint của Vite được browser cache một năm; HTML giữ chính
  sách riêng. Metadata chia sẻ sản phẩm và sitemap dùng cache công khai trên
  VPS để tránh đọc lại database cho mỗi lượt bot/trình duyệt.
  Build so sánh tại máy phát triển: entry JS 1.205,09 → 867,16 kB (giảm 28%);
  gzip 266,90 → 215,21 kB. Đây là kích thước bundle, không phải phép đo thời
  gian tải mạng hoặc cam kết giảm tổng lượng log trên Supabase.

Không có migration mới trong đợt bổ sung này. Database vẫn phải có đủ đến 056.
Build và deploy bản mã mới bằng workflow GitHub hiện tại. Một tiến trình dev
hoặc worker cũ còn trỏ production vẫn có thể tạo thêm request; phải kiểm tra
toàn bộ các tiến trình đang dùng cùng project khi đánh giá Usage.

Ngân sách vận hành đề xuất có dự phòng, **không phải kết quả đã đo**:

| Chỉ số | Mục tiêu mỗi kỳ | Trung bình tối đa cho kỳ 31 ngày |
| --- | --- | --- |
| Log Ingestion | Dưới 0,8 GB | Khoảng 25,8 MB/ngày |
| Uncached Egress | Dưới 4 GB | Khoảng 129 MB/ngày |

Lấy mức tăng giữa hai mốc cùng giờ hoặc số từng ngày trong Usage sau khi dữ
liệu cập nhật. Tổng 5,982 GB đã ghi nhận không giảm khi deploy hay xóa bảng/log.
Hạn mức tính trên cả organization và kỳ billing thực tế, không mặc định ngày 1.
Chưa thể khẳng định an toàn gói Free nếu chưa có số phát sinh thực tế sau deploy.

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
