# Avatar, ẩn gói và biên nhận giao hàng

Để cho phép key/dữ liệu giống nhau, chạy thêm `041_allow_repeated_inventory_data.sql` sau 040 và cập nhật backend. Mỗi dòng vẫn là một đơn vị hàng riêng có ID riêng; hai dòng giống nhau tăng tồn kho hai đơn vị. Áp dụng cả nhập kho và giao dữ liệu thủ công/đặt trước. Đơn đã giao vẫn không thể giao lại.

Chạy `supabase/migrations/040_variant_visibility_delivery_receipts.sql` một lần trong Supabase trước khi triển khai backend/frontend mới. Migration yêu cầu các migration 001–039 đã được áp dụng.

- Danh sách khách hàng hiển thị avatar; ảnh lỗi sẽ trở lại chữ viết tắt.
- Admin/seller có thể ẩn hoặc hiện từng gói. Gói ẩn không thể tạo đơn mới; đơn đã mua vẫn được giao bình thường.
- Gói đặt trước hiển thị ngày giao dự kiến trong quản trị. Sau khi giao, trang đơn hàng bỏ ghi chú ngày dự kiến và hiển thị dữ liệu với nút sao chép.
- Email thanh toán mới chứa các key/dữ liệu đã giao tại thời điểm thanh toán. Đơn đặt trước nhận biên nhận đặt trước lúc thanh toán và một email dữ liệu khi toàn bộ đơn đã giao xong. Đơn nhiều sản phẩm chờ giao đủ trước khi gửi email giao hàng.
- Mỗi đơn có tối đa một bản ghi email thanh toán và một bản ghi email giao hàng; retry dùng mã chống trùng hiện có. Snapshot key trong database vẫn mã hóa; worker giải mã khi gửi.
- Không tự gửi lại email hoặc bổ sung key vào các biên nhận đã tạo trước migration. Các đơn đã giao trước migration không tự phát sinh thư mới.

Vẫn cần `ORDER_RECEIPTS_ENABLED=true`, `BREVO_API_KEY` hợp lệ và `ORDER_RECEIPTS_FROM` đã xác minh trên VPS. Lỗi Brevo HTTP 401 phải được sửa bằng cấu hình API key; cập nhật này không tự sửa key.

Kiểm tra:
```sql
select order_id, kind, status, attempts, last_error, sent_at
from public.order_receipts order by created_at desc limit 20;
```
