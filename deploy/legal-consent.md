# Điều khoản và xác nhận điện tử — phiên bản 2026-11-06-v1

## Nội dung và căn cứ

`shared/legal-content.js` là nội dung chung cho React, HTML ban đầu của VPS và
bản tĩnh của Cloudflare Worker. Trang `/terms` và `/privacy` hiển thị ngày cập
nhật, phiên bản, liên kết nguồn chính thức và nút in/lưu.

Nội dung bổ sung phân biệt dữ liệu tài khoản, thực hiện giao dịch và an toàn hệ
thống; thông báo bên nhận, khả năng xử lý ngoài Việt Nam, nguyên tắc lưu trữ,
quyền truy cập/chỉnh sửa/xóa/hạn chế/phản đối, rút lại sự đồng ý và kênh hỗ trợ.
Không gộp quảng cáo vào xác nhận bắt buộc. Phần giao dịch giải thích rà soát/sửa
đơn, thanh toán, giao hàng/đặt trước, hủy, hoàn trả, khiếu nại và bản lưu.

Nguồn đã đối chiếu:

- [Luật 91/2025/QH15](https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/7/91qh.signed.pdf),
  đặc biệt Điều 9–10 về sự đồng ý và yêu cầu rút lại/hạn chế xử lý.
- [Luật 19/2023/QH15](https://datafiles.chinhphu.vn/cpp/files/vbpq/2023/7/luat19_2023.pdf),
  đặc biệt Điều 37–38 về thông tin, xác nhận, bản lưu và quyền trong giao dịch từ xa.
- [Luật 122/2025/QH15](https://vanban.chinhphu.vn/?classid=1&docid=216503&pageid=27160&typegroupid=3),
  có hiệu lực từ 01/07/2026.

Chủ website yêu cầu sử dụng tên **KEYNEST**; không cung cấp tên pháp lý, địa chỉ,
email/điện thoại riêng cho nội dung công khai. Bản này dùng Trung tâm hỗ trợ và
các kênh đã công bố ở chân trang, không tự tạo pháp nhân/địa chỉ hoặc mã số thuế.
Việc thêm nội dung và checkbox không chứng nhận đã hoàn tất mọi nghĩa vụ pháp
lý của chủ thể kinh doanh, bao gồm nghĩa vụ công bố thông tin nhận diện bắt buộc,
thông báo/đăng ký hoạt động, hồ sơ dữ liệu hoặc nghĩa vụ thuế nếu có áp dụng.

## Đăng ký và OAuth

- Hai ô mặc định bỏ chọn: chấp nhận điều khoản/đọc chính sách; đồng ý xử lý dữ
  liệu cần thiết cho tài khoản. Đăng nhập email hiện có không bắt buộc xác nhận
  lại. Google/Discord cần xác nhận trước khi chuyển đến nhà cung cấp, vì luồng đó
  có thể tạo tài khoản mới.
- POST `/api/auth/register` và POST `/api/auth/oauth/:provider` bắt buộc có:

```json
{"legal":{"version":"2026-11-06-v1","terms":true,"account_data":true}}
```

- Thiếu/từ chối xác nhận trả 400; phiên bản cũ trả 409 để tải lại và đọc bản mới.
  Không nhận timestamp hoặc hash tự khai từ trình duyệt.
- Đăng ký Supabase lưu xác nhận bằng `app_metadata.legal_acceptance` trong chính
  lệnh Admin Auth tạo tài khoản; người dùng không thể sửa app_metadata qua API
  sửa hồ sơ của website. Bản demo lưu trong user tại lần tạo.
- OAuth giữ bản xác nhận trong cookie giao dịch mã hóa, gắn với PKCE. Callback
  lưu `audit_logs` với action `account_legal_acceptance`, UID, phiên bản, hash và
  timestamp máy chủ trước khi phát phiên ứng dụng. Ghi nhận thất bại không phát
  phiên. Không ghi mật khẩu/token/mã OAuth vào log chấp thuận.

## Đặt hàng và bản tải về

- Giỏ hàng yêu cầu một ô xác nhận sau khi xem sản phẩm/giá/giao/bảo hành. Thay
  tài khoản, giỏ, giá/điều kiện sản phẩm, phương thức hoặc mã giảm giá/kết quả mã
  làm ô trở lại chưa chọn. Liên kết chính sách mở tab riêng, giữ nguyên biểu mẫu.
- POST `/api/orders` bắt buộc `legal: {version, terms: true}`. API kiểm tra trước
  khi tạo đơn/thanh toán và thêm SHA-256 của nội dung chính sách từ máy chủ.
- RPC `create_order` hiện có lưu toàn bộ payload trong `orders.fingerprint`.
  Xác nhận vì vậy được ghi cùng giao dịch tạo đơn, trừ tiền và giữ hàng; mốc thời
  gian là `orders.created_at` của DB. Không thêm timestamp thay đổi vào payload
  mỗi lần gửi lại để bảo toàn idempotency. Không cần migration SQL mới.
- GET `/api/orders/:id/contract` chỉ cho chủ đơn, giới hạn 10/phút, `no-store`.
  Chi tiết đơn có nút tải bản giao dịch TXT gồm thông tin đơn và bản chính sách
  đúng phiên bản đã xác nhận. Dữ liệu xuất được chọn theo danh sách trường, không
  chứa delivery keys, token hay bí mật payment route. Đây không phải hóa đơn thuế.
- Đơn cũ không có xác nhận không bị gán hồi tố một lần chấp thuận giả.

## Bảo toàn phiên bản và triển khai

`shared/legal-archive/2026-11-06-v1.json` lưu bản cố định để xuất giao dịch cũ.
Khi thay đổi nội dung sau phát hành, tăng `LEGAL_VERSION`, thêm archive mới,
giữ archive cũ và cập nhật bảng phiên bản trong `server/order-contract.js`.
Kiểm thử yêu cầu archive hiện hành khớp nội dung được công bố và hash chấp thuận.

Deploy VPS qua Git như hiện tại. Runtime đã đóng gói thư mục `shared`, bao gồm
archive. Cần deploy frontend và backend cùng release; bản frontend cũ chưa gửi
xác nhận sẽ bị API mới từ chối và cần tải lại trang.

Website đang dùng Cloudflare Worker chỉ Việt Nam. Sau khi sửa chính sách:

```sh
node scripts/build-country-worker.js
node --test tests/country-worker.test.js
```

Thay toàn bộ mã Worker đang chạy bằng `deploy/cloudflare-vietnam-worker.js` và
Deploy trong Cloudflare. Git/VPS không tự cập nhật Worker. Nếu bỏ bước này,
khách ngoài Việt Nam vẫn có thể nhận bản điều khoản tĩnh cũ. Các kiểm tra Worker
vẫn bảo đảm endpoint riêng tư bị chặn và webhook chỉ được miễn đúng đường dẫn.
