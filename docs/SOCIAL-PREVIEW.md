# Ảnh khi chia sẻ link

## Facebook báo 403 và tiêu đề “Khu vực chưa được hỗ trợ”

Facebook đang nhận trang chặn khu vực. Đây không chỉ là vấn đề cache ảnh. Cần cập nhật Worker đang gắn với domain:

1. Mở `deploy/cloudflare-vietnam-worker.js` trong VS Code, Ctrl+A rồi Ctrl+C.
2. Trong Cloudflare, vào Workers & Pages, chọn Worker chặn khu vực đang dùng → Edit code.
3. Thay toàn bộ code bằng nội dung vừa sao chép, bấm Deploy.
4. Kiểm tra Settings → Domains & Routes: route `keynest.store/*` phải trỏ đúng Worker vừa cập nhật. Không tạo thêm một Worker chưa gắn route.
5. Mở `https://keynest.store/robots.txt`: phải trả văn bản bắt đầu `User-agent: *`, không phải trang chặn khu vực.
6. Quay lại Facebook Sharing Debugger, bấm Scrape Again. Kết quả cần là HTTP 200 và tiêu đề KEYNEST, không còn “Khu vực chưa được hỗ trợ”.

Bản Worker mới trả `X-Keynest-Region-Worker: social-preview-v2` trên robots.txt, preview dành cho bot nước ngoài và trang chặn. Có thể kiểm tra `curl -I https://keynest.store/robots.txt`. Nếu không thấy header này, kiểm tra lại code Deploy và route. Push code lên GitHub chỉ cập nhật VPS theo workflow hiện tại, không tự dán code lên Worker.

Nếu vẫn bị 403 sau khi cập nhật đúng Worker, xem Cloudflare Security Events để kiểm tra rule WAF chặn trước Worker. Chỉ bỏ rule chặn quốc gia trùng với Worker, không tắt toàn bộ bảo vệ website.

Backend trả Open Graph và Twitter Card ngay trong HTML, không cần bot chạy React:
- Trang chủ: `/images/share/keynest.jpg`.
- `/products/slug`: tên, mô tả và ảnh của sản phẩm đang công khai.
- Ảnh SVG có sẵn dùng bản PNG tương ứng trong `public/images/share`.

## Cập nhật website

1. Commit và push code, gồm cả ảnh trong `public/images/share`. Chờ GitHub Actions deploy thành công.
2. Cloudflare → Workers & Pages → Worker giới hạn Việt Nam → Edit code. Dán toàn bộ `deploy/cloudflare-vietnam-worker.js` mới rồi Deploy. Push GitHub không tự cập nhật Worker này.
3. Nếu còn rule WAF chặn mọi IP ngoài Việt Nam, nó có thể chặn bot trước Worker. Dùng Worker để thực hiện giới hạn khu vực như hướng dẫn CLOUDFLARE-VIETNAM.md.
4. Facebook Sharing Debugger: https://developers.facebook.com/tools/debug/ → nhập link → Debug → Scrape Again. Thử cả trang chủ và một sản phẩm đang bật. Các nền tảng khác có thể giữ bản xem trước cũ trong bộ nhớ đệm.

Worker nhận diện User-Agent chỉ để trả trang metadata công khai qua `/share-preview`, không coi đó là xác thực, không mở ứng dụng hoặc API tài khoản cho bot nước ngoài. Ảnh sản phẩm công khai được phép tải ngoài Việt Nam để hiển thị preview.

Kiểm tra trên VPS: `curl -s https://keynest.store/products/SLUG_SAN_PHAM` và tìm `og:image`, `og:title`. Nginx phải proxy đường dẫn trang đến Node như file deploy/nginx.conf; không tự trả dist/index.html bằng try_files cho các đường dẫn này.
