# Sản phẩm đặt trước và email biên nhận

## Cập nhật VPS và Supabase

Triển khai cả frontend và backend của bản cập nhật này. Trong Supabase SQL Editor, chạy một lần theo thứ tự sau (sau migration 034):

1. `supabase/migrations/035_preorders.sql`
2. `supabase/migrations/036_order_receipts.sql`

Sau đó build và khởi động lại dịch vụ Node theo quy trình triển khai hiện tại. Không chạy lại toàn bộ migration cũ.

## Đăng sản phẩm chưa có hàng

Trong quản trị hoặc trang seller, mở **Quản lý sản phẩm → Thêm gói**:

- Chọn **Cách giao → Đặt trước · Giao khi có hàng**.
- Nhập ngày giao dự kiến, giá và số lượt đặt trước còn nhận.
- Không cần nhập key vào kho. Số lượt nhận đặt là giới hạn nhận đơn; đặt 0 để ngừng nhận thêm.

Khách thanh toán ngay bằng ví hoặc chuyển khoản. Đơn đã thanh toán ở trạng thái chờ giao; không bắt nhập UID của dịch vụ. Ngày dự kiến được lưu theo từng đơn, nên sửa ngày trên sản phẩm chỉ áp dụng cho đơn mới. Quá ngày dự kiến, hệ thống ngừng nhận đơn mới đến khi cửa hàng cập nhật ngày.

Khi có hàng, admin/seller sử dụng chức năng giao hàng hiện có, nhập mã hoặc thông tin giao hàng theo số lượng đã mua. Doanh thu seller vẫn chỉ được giải ngân sau 48 giờ từ lúc giao thành công, nếu không có tranh chấp đang giữ tiền. Ngày dự kiến không tự động đánh dấu đã giao.

## Bật email biên nhận

Email gửi đến địa chỉ tài khoản mua hàng sau khi xác nhận thanh toán thành công, gồm mã đơn, sản phẩm, số lượng, ngày dự kiến nếu đặt trước, giảm giá và số tiền đã trả. Email không chứa key hoặc thông tin tài khoản sản phẩm được giao. Đây là biên nhận thanh toán, không phải hóa đơn thuế.

Tạo **API key** trong Brevo và xác minh địa chỉ người gửi/domain. Cấu hình trong file `.env` của ứng dụng trên VPS:

```dotenv
ORDER_RECEIPTS_ENABLED=true
BREVO_API_KEY=YOUR_BREVO_API_KEY
ORDER_RECEIPTS_FROM=YOUR_VERIFIED_SENDER_EMAIL
```

Thay các giá trị mẫu bằng cấu hình thật; giữ key trên VPS. API key này khác SMTP key trong cấu hình Supabase. Tham khảo [API gửi email Brevo](https://developers.brevo.com/reference/send-transac-email) và [phân biệt SMTP key/API key](https://developers.brevo.com/docs/smtp-integration).

Với dịch vụ systemd tên `keynest`, sau khi lưu cấu hình:

```bash
sudo systemctl restart keynest
sudo systemctl status keynest --no-pager
```

Worker chạy cùng Node, kiểm tra hàng đợi mỗi 15 giây; không cần tiến trình riêng. Mặc định tính năng gửi tắt; chế độ demo không gửi email thật. Migration không gửi hàng loạt biên nhận cho các đơn cũ.

## Theo dõi gửi thư

Mỗi đơn chỉ có một bản ghi biên nhận. Thư được lưu vào hàng đợi cùng giao dịch thanh toán; lỗi gọi Brevo không làm hỏng đơn hàng. Worker thử tối đa 8 lần, có thời gian chờ tăng dần và phục hồi công việc nếu tiến trình bị dừng.

Kiểm tra trong SQL Editor:

```sql
select status, count(*) from public.order_receipts group by status;
select id, order_id, status, attempts, last_error, created_at, sent_at
from public.order_receipts order by created_at desc limit 30;
```

`sent` nghĩa là Brevo đã chấp nhận yêu cầu. Xem Transactional Logs của Brevo để kiểm tra thư đã phát, bị trả lại hoặc bị chặn; người nhận cũng nên kiểm tra thư rác. `provider_http_401` thường cần kiểm tra API key; `provider_http_400` cần kiểm tra cấu hình người gửi và nhật ký Brevo. `failed` cần xử lý nguyên nhân trước khi thử lại thủ công.

Các lần thử lại dùng cùng mã chống trùng. Brevo công bố thời hạn chống trùng 30 phút; nếu dịch vụ gián đoạn lâu và phản hồi gửi bị mất, vẫn có khả năng nhận thư lặp. Xem [cơ chế idempotency của Brevo](https://developers.brevo.com/docs/heterogenous-versions-batch-emails).

Kiểm thử mã nguồn dùng cơ sở dữ liệu PostgreSQL cục bộ và dịch vụ email giả lập. Cần thử một đơn thật sau khi cấu hình VPS/Brevo để xác nhận email đến hộp thư.
