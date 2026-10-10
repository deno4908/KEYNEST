# Ảnh khi chia sẻ link

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
