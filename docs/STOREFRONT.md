# Nội dung và khám phá cửa hàng

## Chạy bản cập nhật

- Demo tự bổ sung banner và phân loại con vào dữ liệu hiện có; giữ nguyên tài khoản, giá, tồn kho và đơn hàng.
- Supabase: chạy `003_storefront.sql` sau hai migration trước. Migration thêm `products.subcategory`, bảng `banners`, dữ liệu banner ban đầu và RLS. Chưa chạy migration thì API banner không hoạt động.
- Quản trị tại `/admin` → **Banner trang chủ**: thêm/chỉnh sửa tiêu đề, mô tả, ảnh, liên kết, chữ trên nút, thứ tự và trạng thái hiển thị. Banner mới mặc định ẩn. Bật **Hiển thị trên trang chủ** để phát hành, bỏ chọn để gỡ khỏi trang chủ.
- Ảnh banner hiện nhận URL HTTPS từ Steam CDN; chưa có trình tải ảnh lên Supabase Storage. Liên kết chỉ nhận các trang nội bộ được cho phép. Nội dung hiển thị bằng React text, không chèn HTML.

## Cách hoạt động

Banner tự chuyển mỗi 6 giây. Tạm dừng khi rê chuột, khi focus ở trong banner, khi tab trình duyệt ẩn hoặc hệ điều hành bật giảm chuyển động. Có nút trước/sau, chọn slide, tạm dừng và phím mũi tên. Không có banner công khai thì hiển thị liên kết khám phá cửa hàng.

Menu có bốn nhóm chính và phân loại con đọc từ sản phẩm đang bán. Vào **Sản phẩm & kho → Quản lý → Phân loại con** để đổi hoặc thêm nhóm. Mẫu hiện có 10 phân loại con: hành động/nhập vai, thế giới mở, indie/phiêu lưu, mô phỏng/thư giãn, Steam Wallet, Xbox Gift Card, Valorant, Genshin, proxy dân cư và IPv4 riêng. Phân loại mới xuất hiện khi có sản phẩm đang bán trong nhóm, không cần sửa frontend.

Trang `/catalog` nhận các query `category`, `sub`, `platform`, `region`, `max`, `delivery`, `stock`, `sale`, `sort`, `q`, `page`. Lựa chọn được giữ khi tải lại hoặc chia sẻ URL. Giá, kho, khu vực và kiểu giao phải cùng khớp trên một biến thể. Sắp xếp theo giá dùng giá thấp nhất của sản phẩm. Phân trang 12 sản phẩm/trang. Tìm kiếm bỏ dấu tiếng Việt; gợi ý tìm kiếm hỗ trợ phím lên/xuống và Enter.

Trang `/promotions` đọc coupon còn hiệu lực từ backend. Mã được sao chép rồi nhập ở giỏ; giá cuối cùng vẫn do server tính. `/guide` hướng dẫn chọn sản phẩm, thanh toán và nhận đơn. Mục **Sản phẩm vừa xem** lưu tối đa 12 slug trong trình duyệt, hiển thị 6 sản phẩm gần nhất còn được bán; không đồng bộ qua tài khoản.

## Đối chiếu với trang tham khảo

Tham khảo [danh mục Game PC](https://muakey.com/categories/game-pc) và [trang sản phẩm](https://muakey.com/products/karma-koin-usd-global-discount-promo?variant_id=2739) để đối chiếu cách tổ chức danh mục, biến thể, đơn hàng và hỗ trợ. Không sao chép nội dung hoặc giao diện của Muakey.

| Nhóm chức năng                | Trạng thái KEYNEST                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Danh mục, phân loại, nền tảng | Menu nhiều tầng, bộ lọc kết hợp, quản trị phân loại con                                                                |
| Nội dung trang chủ            | Banner động và quản trị xuất bản, nhóm sản phẩm, ưu đãi                                                                |
| Tìm kiếm, sản phẩm            | Gợi ý, lọc, sắp xếp, phân trang, biến thể, đánh giá, vừa xem                                                           |
| Mua hàng                      | Giỏ, coupon, ví/SePay, nhận key, theo dõi và xử lý dịch vụ                                                             |
| Tài khoản, hỗ trợ             | Hồ sơ, lịch sử đơn/ví, khôi phục mật khẩu, ticket và hướng dẫn                                                         |
| Chưa triển khai               | Yêu thích đồng bộ tài khoản, CMS tin tức, email marketing, tích hợp nhà cung cấp nạp game/proxy |

Catalog hiện tải về frontend để tìm kiếm/lọc. Khi có nhiều nghìn sản phẩm nên chuyển tìm kiếm và phân trang sang truy vấn server. Chưa xác minh Supabase Auth/SePay với thông tin kết nối thật; các kiểm thử tự động dùng demo hoặc PostgreSQL PGlite.
