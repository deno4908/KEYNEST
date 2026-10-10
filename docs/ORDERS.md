# Đơn hàng và bảo hành

Trang `/orders` hiển thị ảnh sản phẩm, gói, số lượng, tổng tiền và bộ lọc trạng thái/tìm kiếm. Nút **Xem key** mở `/orders/:id`; trang chi tiết có tiến trình, thông tin thanh toán, mã có thể sao chép và yêu cầu bảo hành. Chỉ chủ đơn được truy cập trang/API này, kể cả khi tài khoản khác có quyền quản trị. Quản trị xem thông tin trong `/admin`.

## Cấu hình

Chạy migration `005_order_warranty.sql` sau các migration 001–004 khi dùng Supabase. Demo tự bổ sung cấu hình cho gói, không sửa thông tin bảo hành của đơn đã mua.

Vào **Quản trị → Sản phẩm & kho → Quản lý → Sửa gói → Bảo hành (ngày)**. Giá trị từ 0 đến 3.650, mặc định 30 ngày. 0 nghĩa là gói không áp dụng bảo hành theo ngày. Trang sản phẩm hiển thị thời hạn của gói đang chọn trước khi mua.

Thời hạn được chụp lại trên từng dòng đơn tại lúc mua. Việc sửa gói sau đó chỉ ảnh hưởng đơn mới. Ngày bắt đầu tính theo thời điểm giao:

- Key tự động: khi thanh toán thành công.
- Dịch vụ thủ công: khi quản trị giao thông tin dịch vụ.
- Đơn hỗn hợp: mỗi dòng có ngày giao riêng. Giao dịch vụ sau đó không gia hạn key đã giao.
- Đơn cũ thiếu thời hạn/ngày giao: hiển thị **Cần kiểm tra thời hạn**, cho phép gửi yêu cầu để quản trị xác minh; không tự suy ra ngày hết hạn.

## Xử lý yêu cầu

Khách chọn mã đã nhận, nhập mô tả 10–3.000 ký tự và gửi. Server kiểm tra chủ đơn, từng mã thuộc đúng đơn, đã giao, chưa hoàn tiền, thời hạn còn hiệu lực. Hết hạn tại đúng mốc `delivered_at + warranty_days × 24 giờ`. Mỗi đơn chỉ có một yêu cầu bảo hành đang mở; RPC khóa dòng đơn và unique index ngăn gửi trùng. Nội dung hiển thị dưới dạng văn bản, không chạy HTML.

Yêu cầu dùng hệ thống ticket hiện có. Vào **Quản trị → Hỗ trợ khách hàng** để xem đơn, gói và thứ tự mã được chọn; bấm **Phản hồi** để trả lời, chọn tiếp tục xử lý hoặc đóng yêu cầu. Khách thấy phản hồi tại trang chi tiết đơn và trang hỗ trợ. Trả lời không tự đổi key hoặc hoàn tiền. Migration 006 bổ sung lịch sử trao đổi và hai cách xử lý hoàn tiền có liên kết bảo hành; xem [ADMIN.md](ADMIN.md).

Form hiện nhận mô tả văn bản và chọn mã, chưa hỗ trợ đính kèm ảnh.

## Kiểm tra

`npm test` kiểm tra API, quyền sở hữu, CSRF, dữ liệu giả mạo, bảo hành hết hạn/không áp dụng, đơn cũ, snapshot, thời gian giao, phản hồi và ẩn key của đơn hoàn tiền.

`npm run test:db` chạy các migration và RPC thật trên PostgreSQL cục bộ bằng PGlite, kiểm tra quyền RPC/RLS, chống yêu cầu trùng và timestamp khi thanh toán/giao dịch vụ. Chưa thay thế kiểm thử nhiều kết nối đồng thời hoặc Supabase được host.

`npx playwright test tests/browser/store.spec.ts` kiểm tra mua hàng → xem key → sao chép → gửi bảo hành → xem phản hồi, cùng bố cục từ 320 đến 1.440 px.
