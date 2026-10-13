# Seller: chat, giữ tiền và hoàn tiền

Chạy migration `032_seller_support.sql`, rồi `033_seller_escrow_chat.sql` trong Supabase SQL Editor trước khi triển khai bản Node này. Các migration trước đó phải được áp dụng đầy đủ. Không chạy lại migration đã thành công.

- Tiền bán sau phí được ghi nhận khi thanh toán. Chỉ cộng vào ví khả dụng sau **48 giờ từ `delivered_at` của từng sản phẩm**. Sản phẩm chưa giao chưa bắt đầu đếm giờ. Doanh thu đã cộng trước migration được giữ nguyên.
- Node giải ngân qua giao dịch SQL khi seller tải dữ liệu và qua tác vụ mỗi phút. Vì vậy, tiền đủ hạn có thể được cập nhật ở lượt xử lý tiếp theo; không bao giờ giải ngân trước hạn. Nếu Node dừng, tiền được xử lý khi ứng dụng hoạt động lại. Mỗi lượt nền xử lý tối đa 200 đơn đủ điều kiện; lượt sau tiếp tục phần còn lại.
- Khi người mua hoặc seller gửi yêu cầu trong thời gian giữ, tiền chưa giải ngân của **toàn bộ đơn** bị đóng băng. Bên còn lại có thể đồng ý; tiền vẫn giữ trong lúc admin đối soát. Admin vào **Người bán & rút tiền → Xem và xử lý hoàn tiền** để từ chối hoặc hoàn toàn bộ đơn vào ví người mua. Hệ thống hiện hoàn theo đơn, không hoàn riêng từng sản phẩm; phải kiểm tra cả các seller khác trong đơn ghép.
- Từ chối hoàn tiền chỉ bỏ đóng băng, không bỏ mốc 48 giờ. Hoàn tiền hủy tiền đang giữ; với doanh thu cũ đã giải ngân, dùng luồng thu hồi/bù trừ hiện có. Hoàn qua màn hình quản trị đơn hàng cũng đóng yêu cầu tương ứng. Đóng một ticket hỗ trợ không tự bỏ đóng băng yêu cầu hoàn tiền.
- Chat nằm ở từng sản phẩm trong chi tiết đơn của người mua và mục Đơn bán của seller. Chỉ hai bên và admin được xem. Sản phẩm của admin dùng Trung tâm hỗ trợ. Chat hiển thị 200 tin gần nhất; toàn bộ lịch sử vẫn lưu trong database. API không cấp quyền đọc bảng cho trình duyệt.
- Dữ liệu seller và cuộc chat đang mở cập nhật mỗi 5 giây khi tab đang hiển thị, cập nhật sau thao tác và khi quay lại tab. Bản nháp đang nhập không bị xóa khi cập nhật. Đây là polling, không dùng Supabase Realtime.
- Điều khoản seller chuyển sang `2026-10-14-v2` vì thay đổi thời gian giải ngân. Seller đồng ý một lần với phiên bản mới; sửa tên gian hàng sau đó không yêu cầu đồng ý lại.

Kiểm tra sau triển khai bằng một đơn thử được kiểm soát: tiền khả dụng chưa tăng khi thanh toán/giao; hai bên gửi và nhận chat; yêu cầu hoàn tiền xuất hiện cho admin và hiển thị đóng băng ở seller. Không sửa thời gian giao của đơn thật để thử giải ngân; các kiểm thử thời gian nằm trong `npm run test:db` và `tests/sellers.test.js`.
