# Authorization Bearer

Supabase mode: frontend gửi `Authorization: Bearer <access_token>` cho API. Token chỉ nằm trong bộ nhớ module `src/api.ts`, không lưu localStorage/sessionStorage. Cookie `kn_access` cũ được xóa khi đăng nhập hoặc gia hạn. Demo tiếp tục dùng phiên cookie nội bộ.

Đăng nhập, đăng ký, xác minh MFA và đổi mật khẩu trả access token qua header `X-Access-Token`, refresh token qua cookie HttpOnly/Secure trên production. Response có Cache-Control no-store. OAuth callback giữ refresh cookie rồi redirect; không đưa token vào URL. Sau reload/redirect, frontend gọi POST `/api/auth/refresh` để lấy access token mới. Các request đồng thời trong cùng tab dùng chung một lần refresh. API xác minh JWT bằng Supabase getUser, đọc role từ database, kiểm tra thu hồi phiên và MFA/admin OTP như trước.

Refresh phải có Origin đúng APP_ORIGIN và X-App-Request: keynest. Các API ghi khác vẫn giữ kiểm tra CSRF hiện tại. Gửi Bearer giả hoặc hết hạn không tự chuyển sang xác thực cookie ở backend. Frontend chỉ thử gia hạn và gửi lại một lần khi middleware xác thực trả AUTH_REQUIRED; không tự thử lại giao dịch đã chạy mà lỗi nghiệp vụ.

Deploy frontend và backend cùng release. Người đã có refresh cookie tiếp tục được khôi phục phiên khi tải lại trang. DevTools → Network → `/api/me` hiển thị Authorization. `/api/auth/refresh` dùng cookie và không cần Bearer. Không gửi token thật vào chat/log. Khi Supabase đã thu hồi refresh token, đăng nhập lại.

Môi trường local đã kiểm tra adapter xác minh, phân quyền backend và build; OAuth/refresh token rotation thực tế cần kiểm tra với project Supabase sau deploy.
