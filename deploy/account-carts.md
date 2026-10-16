# Giỏ hàng theo tài khoản

Chạy `supabase/migrations/044_account_carts.sql` trong SQL Editor của đúng dự án Supabase trước khi triển khai bản ứng dụng này.

Giỏ hàng đăng nhập được lưu trên server theo tài khoản. Đăng nhập lại hoặc mở trên thiết bị khác sẽ tải giỏ hàng của tài khoản đó. Giỏ hàng khách chưa đăng nhập vẫn lưu trên trình duyệt, tách riêng và không tự nhập vào tài khoản để tránh trộn hàng trên máy dùng chung.

API `/api/cart` yêu cầu đăng nhập; không nhận giá từ trình duyệt. Khi thanh toán, hệ thống vẫn kiểm tra giá và tồn kho hiện tại. Sau khi tạo đơn thành công, ứng dụng lưu giỏ hàng rỗng. Nếu không tải/lưu được, giao diện báo lỗi và cho tải lại, không ghi giỏ rỗng đè lên dữ liệu chưa tải.

Kiểm tra: đăng nhập tài khoản A, thêm sản phẩm; đăng xuất và đăng nhập B, kiểm tra giỏ riêng; quay lại A và tải lại trang, sản phẩm vẫn còn. Thử thêm trên một thiết bị rồi đăng nhập hoặc tải lại trang trên thiết bị khác.
