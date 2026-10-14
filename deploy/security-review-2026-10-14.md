# Đối chiếu báo cáo bảo mật ngày 14/10/2026

Phạm vi: hai báo cáo suy luận từ frontend, đối chiếu backend và migrations trong repository. Kiểm thử dùng HTTP local/demo, Auth giả lập và PostgreSQL qua PGlite. Không thử khai thác trên production, không xác nhận cấu hình hoặc migrations đang chạy trên Supabase thật.

## Lỗi xác nhận: vượt OTP email admin bằng tráo loại cookie

Mức độ: cao. Điều kiện: đã có phiên admin hợp lệ, có thể gọi endpoint gửi OTP. Nếu tài khoản bật TOTP, lớp kiểm tra TOTP vẫn áp dụng; lỗi này không cấp vai trò admin cho khách hàng.

Trong `server/admin-otp.js`, cookie challenge và cookie proof cũ dùng cùng khóa mã hóa, cùng các trường định danh/phiên/thời hạn được kiểm tra. Chuyển giá trị cookie challenge sang tên cookie proof làm guard chấp nhận dù chưa xác minh mã. Thuộc tính HttpOnly không ngăn người gọi tự dựng header Cookie.

Tái hiện local: kiểm thử gửi mã rồi tráo tên cookie nhận HTTP 200 ở API được bảo vệ, trong khi kết quả đúng phải là 403. Đây là nguyên nhân thực tế khác với giả định “backend chỉ kiểm tra JWT” trong báo cáo.

Đã sửa:

- Tách khóa mã hóa theo mục đích challenge/proof.
- Đổi miền dẫn xuất khóa sang v2, từ chối cả challenge và proof cũ. Không chấp nhận cơ chế v1 để tương thích ngược.
- Kiểm thử tráo cookie hai chiều, proof v1, sai phiên, sửa ciphertext, hết hạn, sai OTP và luồng xác minh hợp lệ.

Triển khai: cập nhật và khởi động lại **tất cả** instance Node. Admin cần gửi và xác minh OTP mới. Không cần migration SQL hay thay khóa mã hóa kho hàng. Không để instance cũ tiếp tục nhận lưu lượng; không rollback về phiên bản có lỗi. `ADMIN_OTP_ENABLED=false` chủ động tắt lớp OTP, không được xem là đang được lớp này bảo vệ.

## Kết quả đối chiếu các nhận định khác

| Nhận định | Kết quả trong code hiện tại |
| --- | --- |
| Người mua/seller tự gửi `action: refund/reject` qua order-chat | Không tái hiện. `server/seller-conversations.js` và hàm SQL `seller_conversation` trong migration 033 kiểm tra admin riêng cho các action này. `resolve_warranty_refund` còn kiểm tra admin. Actor lấy từ phiên đã xác thực. Đã bổ sung ma trận cả hai action với cả buyer và seller, xác nhận số dư và trạng thái tranh chấp không đổi. |
| Rút vượt số dư bằng nhiều UUID | Không thấy đường chạy read/check/write ngoài transaction như báo cáo giả định. `seller_command` trong migration 022 khóa dòng profile bằng `FOR UPDATE` trước khi đọc/kiểm tra số dư và tạo lệnh rút trong cùng transaction. Idempotency không phải cơ chế duy nhất. Kiểm thử PGlite không chứng minh tranh chấp giữa nhiều kết nối PostgreSQL thật; phần này vẫn cần integration test trước khi khẳng định đã kiểm thử đồng thời trên production. |
| Token AAL1 gọi API riêng tư; gỡ MFA không cần OTP | `server/index.js` áp dụng kiểm tra phiên, trạng thái khóa, `needsMfa` và admin OTP ở server; `api-access.js` mặc định bảo vệ API không công khai. `mfa.js` kiểm tra factor thuộc user, challenge và verify mã trước khi DELETE bằng token vừa nâng mức xác thực. Ngoại lệ OTP cookie nêu trên đã được sửa. |
| Tự nâng quyền bằng user_metadata | Không tái hiện. Backend lấy role từ `profiles`; migrations chặn browser sửa bảng và gọi RPC nghiệp vụ. Kiểm thử SQL gửi metadata role=admin vẫn tạo customer, balance=0. |
| Upload HTML/SVG giả MIME để XSS | Không tái hiện. `server/media.js` kiểm tra magic bytes, giải mã ảnh bằng sharp, giới hạn pixel, loại ảnh động và tạo WebP mới; phục vụ `image/webp` cùng `nosniff`. Test SVG giả `image/png` bị từ chối. QR MFA hiển thị bằng `<img>` với data URL, không chèn SVG trực tiếp vào DOM qua innerHTML. |
| Dùng URL ảnh tùy ý để theo dõi khách | Schema sản phẩm dùng `isStoreImage`: ảnh có sẵn, đường dẫn media UUID của website hoặc hostname Steam CDN cụ thể. Đã bổ sung test URL bên ngoài và hostname giả có hậu tố bị từ chối. |
| Bỏ mã hóa mật khẩu, gửi lại nonce hoặc đổi endpoint | Chế độ Supabase bật `requireEncrypted: true`; plaintext bị từ chối. Payload JWE được kiểm tra path, thời hạn, chữ ký nonce và claim nonce một lần bằng RPC migration 030 dùng khóa chính + `ON CONFLICT DO NOTHING`. Lỗi kho nonce làm request thất bại, không tự chuyển sang bỏ kiểm tra. Nhánh plaintext chỉ phục vụ demo/test; cấu hình cấm demo trong production. Không cần chuyển sang Redis để đạt tính chất này. |
| IDOR kho, giao hàng, ẩn sản phẩm, ticket/chat | Các đường được nêu có kiểm tra quyền sở hữu: `seller_command` nối variant→product và kiểm tra seller; fulfill kiểm tra seller của item; visibility lọc cả id và seller_id; ticket khách lọc user_id; chat kiểm tra buyer/seller của item. `seller_support` migration 032 không lộ ticket dùng chung của đơn nhiều seller. Đã bổ sung HTTP test nhập kho của sản phẩm không thuộc seller bị từ chối. |

Giữ endpoint đa năng phù hợp với kiến trúc hiện tại vì kiểm tra quyền nằm ở server và SQL. Tách endpoint admin, chuyển nonce sang Redis hoặc buộc tách API gỡ MFA không tự sửa lỗi cookie đã xác nhận; không thực hiện các thay đổi đó chỉ dựa trên tên endpoint/frontend.

## Giới hạn và kiểm thử

- `npm test`: 123 test đạt, gồm HTTP, phân quyền, ảnh, MFA/OTP, JWE và nghiệp vụ.
- `npm run test:db`: 35 kiểm tra đạt; áp dụng migrations và kiểm tra quyền/RLS, metadata, escrow, hoàn tiền, nonce và thu hồi phiên trên PGlite.
- Chưa kiểm thử nhiều kết nối PostgreSQL thực, cấu hình Auth/Storage production hoặc trạng thái triển khai migrations 030–033. Kết quả không phải cam kết website không còn lỗ hổng khác.
