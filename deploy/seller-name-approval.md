# Hồ sơ và xét duyệt tên gian hàng

Áp dụng `supabase/migrations/057_seller_name_approval.sql` trong Supabase SQL Editor **trước khi deploy**. File chạy trong một transaction, không đổi tên hoặc dữ liệu gian hàng hiện có. Yêu cầu database đã có migration đến 056.

1. Mở dự án Supabase đang dùng cho KEYNEST → SQL Editor → New query.
2. Dán toàn bộ nội dung file 057, chọn Run một lần. Nếu có lỗi, giữ nguyên thông báo lỗi để kiểm tra; không bỏ từng lệnh rồi chạy tiếp.
3. Kiểm tra bằng truy vấn:

```sql
select to_regclass('public.seller_name_requests') as request_table,
       to_regprocedure('public.request_seller_name(uuid,text)') as submit_function,
       to_regprocedure('public.review_seller_name(uuid,uuid,text,text)') as review_function;
```

Ba cột phải có giá trị. Sau đó deploy ứng dụng. Backend mới kiểm tra bảng này khi khởi động; thiếu migration sẽ không vượt qua health check của deployment.

Seller mở Hồ sơ & điều khoản, nhập tên mới rồi gửi yêu cầu. Tên hiện tại giữ nguyên, mỗi người chỉ có một yêu cầu chờ duyệt. Gửi lại cùng tên trả lại yêu cầu đang chờ; không tạo thêm thông báo. Admin mở Người bán & rút tiền → Yêu cầu đổi tên gian hàng để duyệt hoặc từ chối kèm lý do. Người bán nhận thông báo kết quả và có thể gửi yêu cầu mới sau khi bị từ chối.

Việc duyệt cập nhật tên, kết quả xét duyệt, thông báo và nhật ký trong cùng transaction. Database chặn cả API đổi tên cũ và thay tên bằng cách gửi lại hồ sơ. Tên snapshot trong đơn hàng cũ không đổi. Tạo hồ sơ seller lần đầu vẫn nhận tên ban đầu; thay đổi tên về sau cần xét duyệt.

Nếu rollback ứng dụng, giữ migration 057 để bảo toàn yêu cầu và lịch sử xét duyệt. Giao diện cũ sẽ không đổi tên trực tiếp được do trigger bảo vệ; những chức năng khác vẫn sử dụng schema cũ. Không xóa bảng hoặc trigger để làm API cũ đổi tên trở lại.

Kiểm tra cục bộ: `npm run build`, `node --test tests/sellers.test.js`, `npm run test:db`, `npx playwright test tests/browser/seller-name-approval.spec.ts`. Bộ database dùng PostgreSQL tạm trong PGlite, không truy cập database thật. Kiểm tra browser yêu cầu API demo và thực hiện cả gửi, từ chối, gửi lại và duyệt bằng hai phiên đăng nhập riêng.
