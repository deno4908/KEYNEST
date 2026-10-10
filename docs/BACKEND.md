# Backend Node.js

Express phục vụ API tại `/api`. Frontend dùng cookie HttpOnly; thao tác ghi phải có Origin đúng `APP_ORIGIN` và `X-App-Request: keynest`. Database thật dùng Supabase; quyền đọc/ghi trực tiếp được kiểm soát bằng RLS và grants. Service role và khóa kho chỉ ở server.

## Chạy và dữ liệu

- `npm run dev`: API + Vite; hoặc `npm run dev:api` để chạy riêng API tại cổng 3001.
- Demo: dữ liệu lưu `.data/demo.json`, không cần tài khoản dịch vụ ngoài.
- Supabase: chạy tuần tự migrations 001–008, điền cấu hình như README, rồi `npm run seed`. Không chạy lại các migration cũ trên database đã áp dụng. API vận hành mới: [OPERATIONS.md](OPERATIONS.md).
- Migration mới `007_catalog_backend.sql` chỉ thêm hàm tìm kiếm sản phẩm; không thay đổi thanh toán, đơn hàng hay số dư.

## Danh mục sản phẩm

`GET /api/catalog` nhận các query sau:

| Query | Giá trị |
| --- | --- |
| `q` | Từ khóa tối đa 120 ký tự; tìm không phân biệt dấu tiếng Việt/hoa thường |
| `category` | `all`, `game`, `gift`, `topup`, `mmo` |
| `sub`, `platform`, `region` | Phân loại, nền tảng, khu vực chính xác |
| `min`, `max` | Giá nguyên VND, 0–100.000.000 |
| `stock`, `sale` | `1` để chỉ còn hàng/đang giảm giá, `0` để không lọc |
| `delivery` | `key` hoặc `manual` |
| `sort` | `featured`, `asc`, `desc`, `name` |
| `page`, `page_size` | Trang 1–10.000; 1–48 mục/trang, mặc định 12 |

Ví dụ: `/api/catalog?category=mmo&stock=1&max=100000&sort=asc&page_size=12`.

Trả `{items,total,page,page_size,pages,facets}`. Facets gồm số lượng mỗi danh mục, các phân loại/nền tảng/khu vực trong danh mục đã chọn. Sản phẩm ẩn không có trong dữ liệu lẫn facets. Giá, tồn kho, khu vực, giảm giá và loại giao phải cùng thỏa trên **một biến thể**. Sắp xếp giá dùng giá thấp nhất của sản phẩm; khi bằng nhau dùng ID để phân trang ổn định. Thứ tự tên tùy collation database; demo dùng thứ tự tên JavaScript. Trang vượt số trang được đưa về trang cuối.

Supabase thực hiện lọc, đếm và phân trang trong `catalog_search`, chỉ trả sản phẩm trang hiện tại; không tải toàn bộ danh mục về Node để lọc. Demo có cùng hợp đồng API. `GET /api/products/:identifier` nhận UUID hoặc slug, trả 404 nếu sản phẩm không tồn tại/đang ẩn. `/api/products` cũ vẫn phục vụ dữ liệu trang chủ.

## Tài khoản

`POST /api/me/password` nhận:

```json
{
  "current_password": "CURRENT_PASSWORD",
  "password": "NEW_PASSWORD",
  "password_confirmation": "NEW_PASSWORD"
}
```

Yêu cầu đăng nhập, CSRF, xác minh mật khẩu hiện tại; mật khẩu mới khác cũ, tối thiểu 10 ký tự, có chữ hoa/thường/số. Giới hạn 5 yêu cầu/15 phút/IP. Không nhận user ID, email hay role từ request.

Demo lưu scrypt hash, thu hồi phiên cũ và phát cookie mới. Supabase xác thực lại bằng email của người đang đăng nhập, kiểm tra đúng user ID, rồi cập nhật qua Auth và đặt cookie phiên vừa xác thực. Không cam kết thu hồi ngay mọi access token Supabase trên thiết bị khác. Tài khoản OAuth chưa có mật khẩu dùng email khôi phục. Form nằm tại `/account?section=security`.

Tham chiếu: [Supabase signInWithPassword](https://supabase.com/docs/reference/javascript/auth-signinwithpassword), [Supabase updateUser](https://supabase.com/docs/reference/javascript/auth-updateuser).

## Đơn hàng, hỗ trợ và kho

| API | Quyền và kết quả |
| --- | --- |
| `GET /api/tickets/:id` | Chủ yêu cầu; trả lịch sử trao đổi. Khách khác nhận 404 |
| `GET /api/admin/tickets/:id` | Admin; yêu cầu, lịch sử, thông tin người gửi |
| `GET /api/admin/orders/:id` | Admin; người mua, sản phẩm, key đủ điều kiện, thông tin bảo hành và các yêu cầu bảo hành |
| `GET /api/admin/inventory/:variantId` | Admin; danh sách mã định danh kho, đơn/dòng hàng liên kết; không trả key, ciphertext hay hash |

Kho nhận `state=all|available|assigned`, `page`, `page_size` (tối đa 100, mặc định 25). `assigned` bao gồm mã giữ cho đơn chờ thanh toán và mã đã giao; mã của đơn hoàn tiền vẫn thuộc đơn cũ. Trả `{items,total,page,page_size}`; trang vượt cuối trả mảng rỗng. Endpoint này dùng cho kiểm kê, không phải endpoint đọc key hàng loạt.

API mới quản trị hiện có thể gọi độc lập; màn quản trị hiện tại vẫn lấy dữ liệu tổng quan từ `/api/admin/overview`. Các thao tác tạo đơn, giao hàng, bảo hành, phản hồi, đánh giá, coupon và upload đã có tại [API.md](API.md).

## Kiểm thử

`npm test`, `npm run test:db`, `npx playwright test tests/browser/backend-core.spec.ts tests/browser/store.spec.ts`.

Kiểm thử HTTP chạy demo cô lập; kiểm thử SQL chạy đúng migrations trên PostgreSQL WASM. Kiểm thử adapter Auth dùng phản hồi giả lập để kiểm tra xác thực lại và nhánh lỗi. Chưa kiểm thử Supabase Auth/Storage của dự án thật khi chưa có cấu hình. Pay2S/MBBank được mô tả tại [PAY2S-SETUP.md](PAY2S-SETUP.md); chưa xác minh tài khoản ngân hàng thật khi chưa có token.
