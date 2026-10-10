# Quản trị cửa hàng

Chạy đủ migration 001–006. `006_admin_operations.sql` bổ sung coupon, lịch sử trao đổi, thông tin hoàn tiền và bucket Supabase Storage. Demo lưu ảnh ở thư mục `uploads` cạnh file dữ liệu demo; Supabase lưu vào bucket riêng `store-assets` và phục vụ qua Node `/api/media/:file`.

## Ảnh sản phẩm và banner

Trong trình chỉnh sửa, chọn **Tải ảnh từ thiết bị** hoặc kéo thả ảnh vào khung, xem trước rồi lưu sản phẩm/banner. Có thể thay, bỏ ảnh hoặc nhập đường dẫn ảnh được hỗ trợ. Tập tin tải lên chưa tự xuất hiện ngoài cửa hàng cho đến khi lưu bản chỉnh sửa. “Bỏ ảnh” chỉ gỡ liên kết trong biểu mẫu, không xóa vật lý tập tin đang được dùng ở nơi khác.

Chấp nhận JPG, PNG, WebP tĩnh, tối đa 8 MB và 24 megapixel. Node kiểm tra nội dung, giải mã và chuyển sang WebP tối đa 2.400 × 2.400, giữ tỉ lệ, bỏ metadata. Không chấp nhận SVG/HTML hoặc ảnh động tải từ thiết bị. Tên ảnh là UUID do server tạo; endpoint không nhận tên đường dẫn từ người dùng. Upload cần quyền admin, CSRF và rate limit 20 lần/15 phút/IP.

Phần xử lý dùng [Sharp](https://sharp.pixelplumbing.com/api-constructor/) và [Supabase Storage upload](https://supabase.com/docs/reference/javascript/storage-from-upload). Bucket không cấp quyền ghi trực tiếp cho trình duyệt. Tất cả ảnh trong bucket này là nội dung cửa hàng có thể xem công khai qua Node, không dùng cho giấy tờ cá nhân hay bí mật giao hàng.

## Mã giảm giá

- Loại: phần trăm (1–90%, có số tiền giảm tối đa) hoặc số tiền cố định.
- Điều kiện: đơn tối thiểu, nhóm sản phẩm, danh sách sản phẩm cụ thể, chỉ đơn đầu tiên.
- Giới hạn: tổng lượt toàn cửa hàng và lượt mỗi tài khoản; để trống nghĩa là không giới hạn. Có nút điền nhanh “Một lượt duy nhất”, “Mỗi khách một lần”.
- Hiệu lực: bắt đầu/kết thúc theo giờ địa phương khi nhập, lưu UTC; bật/tắt mã. Mã đã tạo không đổi tên để giữ lịch sử sử dụng.
- Quản lý: tìm kiếm, lọc trạng thái, sao chép, bộ đếm lượt đã dùng và lượt đang giữ.

Giảm giá chỉ tính trên các sản phẩm đồng thời khớp nhóm và danh sách đã chọn. Tổng đơn sau giảm tối thiểu 1.000đ; không cộng dồn nhiều mã. Điều kiện “đơn đầu tiên” loại khách đã có đơn pending, processing, completed hoặc refunded. Mã không dùng được cho đơn mới nếu bị tắt/hết hạn; đơn đang giữ mã vẫn được thanh toán trong thời hạn giữ đơn đã cấp.

Đơn chuyển khoản pending giữ một lượt trong 15 phút. Hủy/hết hạn trả lượt; processing/completed/refunded tính là đã dùng. Hoàn tiền không trả lại lượt. Supabase khóa dòng coupon trong transaction tạo đơn để chống vượt tổng lượt; idempotency không chiếm thêm lượt. Cart kiểm tra mã qua server và hiển thị tiền giảm trước khi đặt hàng. Server kiểm tra lại tại lúc đặt, vì lượt/tồn kho có thể đã thay đổi sau khi xem trước.

## Đơn hàng, hỗ trợ và bảo hành

Danh sách đơn tìm được bằng mã đơn, tên/email khách và sản phẩm. **Chi tiết** hiển thị người mua, số dư hiện tại, ảnh và gói đã mua, số lượng, giá, coupon, mốc thời gian, phương thức/nội dung thanh toán, thông tin dịch vụ và mã đã giao. Key được mở theo từng mục để tránh hiển thị toàn bộ ngay khi mở hộp thoại.

Hỗ trợ có bộ lọc loại/trạng thái, tìm kiếm, mức ưu tiên và hàng đợi. Hộp trao đổi hiển thị khách hàng, đơn bảo hành, các mã được chọn, toàn bộ lịch sử phản hồi. Có mẫu trả lời để chèn nội dung; quản trị vẫn phải kiểm tra và bấm gửi. Khi trả lời có thể chọn “Đã xử lý”, “Tiếp tục xử lý” hoặc “Chờ trao đổi thêm”. Khách gửi bổ sung tại trang hỗ trợ; yêu cầu mở lại và lịch sử cũ được giữ nguyên. Phản hồi trước khi có migration được giữ với nhãn thời gian chưa xác định, không tự tạo thời điểm trả lời giả.

## Hoàn tiền

Trong chi tiết đơn, chỉ hiện thao tác hoàn cho đơn đã thanh toán, chưa hoàn và có yêu cầu bảo hành liên quan. Bắt buộc chọn yêu cầu, nhập lý do và xác nhận:

1. **Hoàn vào ví KEYNEST:** cộng toàn bộ số tiền thực trả vào ví, ghi ledger, đổi trạng thái đơn, đóng yêu cầu và thêm phản hồi trong cùng transaction Supabase.
2. **Xác nhận đã hoàn bên ngoài:** quản trị đã chuyển trả tiền bằng phương thức khác, nhập mã tham chiếu; hệ thống chỉ ghi nhận và cập nhật đơn/ticket, không gọi ngân hàng hoặc cộng ví.

Lưu phương thức, lý do, mã tham chiếu, người xử lý và thời gian. Không thể hoàn hai lần; key đã giao không quay lại kho bán. Hiện hoàn toàn bộ đơn, chưa hỗ trợ hoàn một phần. Endpoint cũ không có thông tin bảo hành sẽ bị từ chối. RPC `refund_order(uuid)` cũ đã thu hồi quyền service role; dùng `resolve_warranty_refund` qua backend.

## Kiểm tra

API demo: `node --test tests/admin-operations.test.js`. PostgreSQL/RLS/RPC: `npm run test:db`. UI từ quản trị đến khách: `npx playwright test tests/browser/admin-operations.spec.ts`.

Storage Supabase thật và giao dịch nhiều kết nối đồng thời cần kiểm thử thêm trên môi trường được cấu hình; bài kiểm tra cục bộ không gọi ngân hàng và không chuyển tiền thật.
# Danh mục sản phẩm

Chạy migration `016_categories.sql` sau các migration trước. Vào **Admin → Danh mục** để thêm tên, mã không dấu (ví dụ `phan-mem`) và thứ tự hiển thị. Có thể sửa tên/thứ tự; mã được giữ cố định. Bốn danh mục cũ được giữ nguyên. Danh mục mới dùng được ở form sản phẩm, phạm vi mã giảm giá, menu và bộ lọc ngoài cửa hàng. Danh mục con vẫn nhập trong form sản phẩm như trước.

API `GET /api/categories` công khai; `POST /api/admin/categories` và `PATCH /api/admin/categories/:id` chỉ dành cho admin. Tài khoản thường không được ghi bảng categories trực tiếp.

