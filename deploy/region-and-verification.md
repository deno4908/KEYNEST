# Giới hạn vùng và xác minh theo phiên

## Cloudflare

`deploy/cloudflare-vietnam-worker.js` được tạo bởi `node scripts/build-country-worker.js`.
Deploy toàn bộ file vào Worker đang gắn với `keynest.store/*`. Git chỉ deploy VPS.

Worker v6 dùng `request.cf.country` để xác định khu vực, không tin header/query do
khách tự gửi hay User-Agent. Ngoài Việt Nam hoặc không xác định được IP: trang
chủ, danh mục, sản phẩm và các đường dẫn tài khoản hiện trang giới hạn vùng;
API trả 403 `REGION_RESTRICTED`. `/terms`, `/privacy` vẫn đọc được toàn cầu.
Chỉ POST webhook Pay2S/SePay chính xác được chuyển về origin; Node vẫn xác thực webhook.

GET `/api/region` trả `{allowed}` và `private, no-store` ngay tại edge, không truy
vấn Supabase. Node có fallback cho môi trường local. Fallback không phải cơ chế
kiểm soát vùng: origin VPS phải tiếp tục chỉ nhận truy cập qua Cloudflare ingress.

Ứng dụng kiểm tra lại khi mở form, trước gửi đăng nhập/đăng ký/OAuth và khi tab
được focus/hiển thị lại. Khi vùng bị từ chối, form đóng và trang giới hạn vùng
thay thế ứng dụng; lỗi từ API refresh cũng đi cùng nhánh này thay vì báo lỗi phiên.
Không dùng localStorage để xác định vị trí hoặc ghi nhớ một lần cho phép.

CI sau deploy kiểm tra Worker v6, các chính sách và trang chủ trả 403 khi runner
được xác định ở ngoài Việt Nam. Các thử nghiệm trình duyệt giả lập đổi VPN;
kiểm tra thực tế từ nước ngoài được thực hiện bằng runner GitHub.

## Xác minh

Proof OTP email admin vẫn mã hóa và ràng buộc UID, email, `session_id` đã được
Supabase xác thực. Challenge gửi mã không thể đổi tên thành proof hợp lệ.
Proof dùng cùng cửa sổ 7 ngày như cookie refresh, được gia hạn khi refresh hợp lệ
và kiểm tra quyền truy cập thành công. Chỉ gia hạn proof có sẵn của đúng phiên;
không tạo proof từ refresh, token hoặc trạng thái lưu trong trình duyệt.

Tải lại trang, chuyển trang và đổi access token trong cùng phiên không buộc gửi
lại OTP sau mốc 12 giờ cũ. Đăng nhập lại bằng mật khẩu/OAuth hoặc khôi phục mật
khẩu xóa proof cũ; đăng xuất cũng xóa. Phiên bị thu hồi, đổi email/tài khoản,
cookie bị xóa/hết hạn hoặc phiên mới vẫn phải xác minh. Nếu proof cũ đã hết hạn
trước khi nâng cấp, cần xác minh thêm một lần để có proof mới.

`VerificationCard` và `VerificationCodeInput` dùng chung cho OTP email quản trị và
Authenticator của mọi vai trò. Không bắt khách hàng xác minh OTP email quản trị.
Giao diện có trạng thái tải/gửi/nhập mã/xác minh/thành công, animation theo trạng
thái, hỗ trợ giảm chuyển động, nhãn trường và thông báo lỗi. Không lưu mã OTP ở
trình duyệt; chỉ xác nhận thành công sau phản hồi máy chủ.

Không cần migration SQL mới.
