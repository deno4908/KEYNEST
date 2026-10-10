# Phân quyền KEYNEST

## Áp dụng

Chạy các migration theo thứ tự đến `015_permission_hardening.sql` trong Supabase SQL Editor. Migration 015 giữ quyền đọc có RLS hiện tại, thu hồi quyền ghi của `PUBLIC`, `anon`, `authenticated`, kể cả quyền cấp riêng cho từng cột. Các hàm nghiệp vụ chỉ được gọi từ backend với quyền đã cấp cho `service_role`.

Role admin của website là `profiles.role`, không phải role PostgreSQL. Cả khách hàng và admin đăng nhập Supabase đều không được tự ghi bảng ứng dụng qua REST/RPC. Backend xác minh phiên, đọc role từ database, kiểm tra quyền và sở hữu dữ liệu trước khi dùng service key.

`service_role` có quyền vượt RLS: chỉ đặt trong môi trường backend; không đưa vào biến `VITE_*`, mã frontend hoặc repository. Không cấp service key cho khách hàng. Các quyền mặc định trong migration chỉ áp dụng cho role chạy migration; nếu tạo bảng/hàm bằng role khác phải cấu hình lại quyền mặc định và kiểm tra RLS.

## Kiểm thử

- `node --test tests/authorization.test.js`: duyệt các route admin đã đăng ký, kiểm tra khách chưa đăng nhập và tài khoản customer; thử giả role/số dư khi cập nhật hồ sơ, giả role khi đăng ký và giả cookie phiên.
- `npm run test:db`: chạy toàn bộ migration trên PostgreSQL tạm, kiểm tra quyền bảng/cột, RPC, RLS, metadata giả quyền admin, truy cập chéo tài khoản và các luồng tiền/đơn hàng.
- `npm test`: kiểm tra thêm quyền API, CSRF, MFA, phiên, thanh toán và nghiệp vụ.

Các kiểm thử này không thay thế kiểm tra cấu hình Supabase đang chạy. Chính sách Storage, các bảng/hàm ngoài migration, role tự tạo, cấu hình Auth và quyền đã thay đổi trên dashboard cần kiểm tra riêng trước khi triển khai. Các quyền SELECT theo chủ sở hữu có từ migration trước được giữ nguyên; dữ liệu đó vẫn có thể đọc bằng Supabase JWT ngoài API Node, theo RLS.

Quyền admin luôn bắt buộc ở API dù tùy chọn OTP email admin đang tắt. 2FA và OTP là lớp xác thực bổ sung, không thay thế kiểm tra role.
