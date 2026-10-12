# Xử lý lỗi xác minh thương hiệu Google

Worker hiện là `vietnam-region-v5`: khách thông thường ngoài VN thấy giao diện giới hạn khu vực tại trang chủ; các trang chính sách vẫn công khai. Bot chia sẻ chỉ nhận metadata và ảnh công khai; API nghiệp vụ vẫn bị chặn. Luôn dùng file Worker mới nhất và Deploy lại trên Cloudflare.

## 1. Xác minh keynest.store

1. Đăng nhập Google Search Console (https://search.google.com/search-console) bằng tài khoản quản lý dự án OAuth trên Google Cloud.
2. Chọn Thêm tài sản → Miền (Domain), nhập `keynest.store` (không thêm https hay đường dẫn).
3. Sao chép giá trị TXT `google-site-verification=...` do Google cấp.
4. Cloudflare → keynest.store → DNS → Records → Add record: Type TXT, Name `@`, Content là giá trị vừa sao chép, TTL Auto. Không xóa các bản ghi DNS hiện có.
5. Quay lại Search Console → Verify. Giữ bản ghi TXT sau khi xác minh.
6. Theo thông báo Google đã gửi, chờ 24 giờ sau khi xác minh thành công trước khi gửi kiểm tra lại.

## 2. Cập nhật website và Cloudflare

Sau khi GitHub Actions deploy thành công:

1. Cloudflare → Workers & Pages → Worker đang gắn keynest.store → Edit code.
2. Thay toàn bộ code bằng `deploy/cloudflare-vietnam-worker.js` mới và chọn Deploy. Git push không tự cập nhật Worker này.
3. Worker strict-vietnam-v3 cho người ngoài VN đọc trang giới thiệu tại `/`, `/privacy`, `/terms` bằng HTML tự chứa. Nội dung lấy từ cùng nguồn với website; không gọi API hoặc tải tài nguyên bên ngoài. Các API đều bị chặn ngoài VN, chỉ giữ POST webhook Pay2S/SePay. Không có ngoại lệ riêng cho Googlebot. Cần tạo lại và Deploy Worker mỗi khi sửa nội dung chính sách.
4. Nếu có WAF rule riêng chặn mọi IP ngoài VN, tắt rule trùng đó để Worker kiểm soát quốc gia. Không tắt các rule bảo vệ khác. WAF chặn trước Worker sẽ khiến ngoại lệ trong Worker không có tác dụng.
5. Dùng cửa sổ ẩn danh và kết nối ngoài Việt Nam thử cả ba trang. Phải xem được nội dung thật, không phải màn hình đăng nhập, xác minh Cloudflare hoặc thông báo 403. Thử View Source của /privacy để thấy nội dung chính sách trong HTML.

## 3. Cấu hình Google và gửi lại

Google Auth Platform → Branding:

- App name: KEYNEST.
- Homepage: https://keynest.store/
- Privacy: https://keynest.store/privacy
- Terms: https://keynest.store/terms
- Authorized domains: keynest.store.
- Điền email hỗ trợ thực tế mà bạn có thể nhận thư. Không dùng email giả.

Sau khi kiểm tra các bước trên và đủ 24 giờ: chọn **I have fixed the issues → Request re-verification for your branding**. Nếu Google đã gửi email yêu cầu chỉnh sửa, phản hồi email đó để thông báo các mục đã sửa. Không chọn “issues are incorrect” khi chưa xử lý quyền sở hữu và truy cập website.

Trang chính sách dùng chung nội dung giữa React và HTML máy chủ. Không hiển thị nội dung khác chỉ để phục vụ Google. Thông tin đơn vị vận hành, địa chỉ liên hệ và thời hạn lưu trữ cụ thể vẫn cần chủ cửa hàng bổ sung theo thực tế; thay đổi code không bảo đảm Google duyệt.

Tài liệu Google: https://support.google.com/cloud/answer/13807376?hl=en và https://support.google.com/cloud/answer/13806988?hl=en.
