# Kênh người bán

## Triển khai

Chạy các migration còn thiếu theo thứ tự đến `024_seller_without_social.sql` trong Supabase SQL Editor trước khi đưa bản server/frontend mới vào hoạt động. Không chạy lại migration đã áp dụng. Migration 023 khôi phục hồ sơ bị thiếu cho tài khoản Auth; migration 024 xóa liên kết mạng xã hội đã lưu và bỏ yêu cầu này. Bản thay đổi này không tự cập nhật cơ sở dữ liệu hoặc chuyển tiền ngân hàng.

Không cần thay Cloudflare Worker cho tính năng seller. Các trang và API seller vẫn tuân theo giới hạn truy cập Việt Nam hiện có.

## Sử dụng

1. Admin mở **Khách hàng**, tìm tài khoản và chọn **Cấp quyền seller**.
2. Lần truy cập tiếp theo, seller nhập tên gian hàng và tích đồng ý điều khoản. Không yêu cầu mạng xã hội. Việc chấp nhận được lưu trên máy chủ theo phiên bản điều khoản.
3. Seller mở **Tài khoản → Kênh người bán** (`/seller`), tạo sản phẩm, thêm gói bán, nhập kho mã hoặc giao kết quả thủ công. Seller chỉ quản lý sản phẩm/kho/đơn bán của mình. Tên người bán xuất hiện trên trang và danh sách sản phẩm; khách hàng gửi vấn đề tại Trung tâm hỗ trợ KEYNEST.
4. Admin quản lý phí và yêu cầu rút tại **Người bán & rút tiền**. Thu hồi quyền seller sẽ ẩn sản phẩm của tài khoản đó.

## Tiền và đối soát

- Phí mặc định **7%**, admin có thể đổi cho đơn mới. Mức phí và người bán được lưu tại thời điểm đặt đơn; đơn cũ giữ nguyên.
- Đơn thanh toán thành công mới tạo doanh thu. Ví dụ sản phẩm 100.000đ không giảm giá: phí 7.000đ, seller nhận 93.000đ. Tổng tiền sau giảm giá được phân bổ theo giá trị từng dòng sản phẩm; phí làm tròn xuống theo đồng.
- Doanh thu vào cùng ví KEYNEST, dùng mua hàng hoặc yêu cầu rút. Mỗi yêu cầu rút từ 50.000đ, tối đa 100.000.000đ và không vượt số dư khả dụng. Số tiền được giữ ngay khi gửi, gửi lại cùng mã yêu cầu không trừ thêm.
- Admin tự kiểm tra và chuyển tiền ngân hàng bên ngoài website, sau đó chọn **Đã chuyển tiền**, nhập mã giao dịch và ghi chú. Thao tác này chỉ ghi nhận kết quả, không gọi ngân hàng chuyển tiền. Từ chối sẽ trả lại số tiền đã giữ.
- Hoàn tiền đơn sẽ thu hồi thu nhập của seller, hủy các yêu cầu rút đang chờ để đối soát. Nếu seller đã tiêu/rút hết, phần thiếu thành khoản cần bù trừ; doanh thu sau đó bù trừ trước khi cộng ví. Không cho tạo yêu cầu rút khi còn khoản cần bù trừ.
- Seller không tự mua sản phẩm của mình. API và RPC kiểm tra quyền sở hữu; dữ liệu tiền/role không được trình duyệt ghi trực tiếp.

## Kiểm tra

`npm test`, `npm run test:db`, `npm run build`; kiểm tra trình duyệt trong `tests/browser/sellers.spec.ts` bằng môi trường demo. PostgreSQL test dùng PGlite và chạy migration thật; chưa thay thế kiểm tra đồng thời nhiều kết nối hoặc Supabase Auth trên hạ tầng triển khai.
