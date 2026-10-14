# Tingee QR động chính, Pay2S tự động dự phòng

## Cập nhật ứng dụng

Tạm dừng API Node và payment worker khi nâng cấp. Chạy `supabase/migrations/037_tingee_payments.sql` một lần sau migration 036. Triển khai frontend/backend, chạy `npm ci` và `npm run build`, rồi khởi động lại cả hai. Không chạy backend cũ sau khi áp dụng migration mới. Giữ nguyên khóa mã hóa kho và các cấu hình Supabase hiện có.

Backend kiểm tra bảng `payment_routes` khi khởi động. Nếu chưa chạy migration hoặc Supabase không truy cập được, bản mới sẽ không vượt qua health check triển khai. Pipeline không tự chạy SQL hoặc thay `.env` trên VPS.

Trong `.env` trên VPS:

```dotenv
BANK_PAYMENT_PROVIDER=tingee
TINGEE_CLIENT_ID=YOUR_CLIENT_ID
TINGEE_SECRET_TOKEN=YOUR_SECRET_TOKEN
TINGEE_BANK_BIN=YOUR_BANK_BIN
TINGEE_VA_ACCOUNT=YOUR_LINKED_VA_ACCOUNT
TINGEE_ACCOUNT_NAME=YOUR_BENEFICIARY_NAME
# Chỉ dùng với credentials Master Merchant; tài khoản thường để trống.
TINGEE_MERCHANT_ID=
# Production mặc định; UAT chỉ dùng cùng credentials thử nghiệm.
TINGEE_BASE_URL=https://open-api.tingee.vn

# Pay2S dự phòng: giữ cấu hình đang hoạt động.
BANK_CODE=MB
BANK_ACCOUNT_NUMBER=YOUR_PAY2S_BANK_ACCOUNT
BANK_ACCOUNT_NAME=YOUR_PAY2S_ACCOUNT_NAME
PAY2S_WEBHOOK_TOKEN=YOUR_EXISTING_PAY2S_TOKEN
```

Trong Tingee BaaS Portal → **API Credentials**, tạo Client ID/Secret Token được cấp quyền QR. Tài khoản VA và ngân hàng phải hỗ trợ QR động và được liên kết trước. `TINGEE_BANK_BIN` là mã BIN ngân hàng 6 chữ số; `TINGEE_VA_ACCOUNT` là tài khoản định danh của Tingee, không tự lấy số tài khoản Pay2S điền thay. [Hướng dẫn Credentials chính thức](https://developers.tingee.vn/docs/config-info/).

Credentials chỉ nằm ở backend. Yêu cầu API được ký HMAC-SHA512 trên timestamp UTC+7 và JSON body. Frontend nhận ảnh PNG của chuỗi QR Tingee trả về, mã bill và thông tin thanh toán; không nhận Secret Token.

Tingee dùng API tạo QR `dynamic-one-time-payment`, có `billId`, số tiền, thời hạn tính bằng phút. Server tự render đúng chuỗi QR trả về thành ảnh; không tạo lại QR chuyển khoản tĩnh từ nội dung. [API tạo QR động](https://developers.tingee.vn/docs/qr/dynamic/generate-dynamic-qr/).

## Tự dự phòng

Môi trường thử nghiệm Tingee dùng `TINGEE_BASE_URL=https://uat-open-api.tingee.vn`. Không dùng credentials production trên UAT.

- Khi tạo thanh toán mới, backend thử Tingee trước. Timeout, lỗi HTTP, phản hồi không hợp lệ hoặc lỗi API sẽ chọn Pay2S nếu cấu hình dự phòng đầy đủ.
- Cổng thanh toán, tài khoản nhận và QR được lưu theo từng giao dịch. Khách không cần chọn cổng.
- QR Tingee đã cấp sẽ tiếp tục dùng Tingee. Lỗi tra cứu được thử lại, không chuyển QR đó sang Pay2S.
- Nếu tiến trình dừng giữa lúc tạo QR và lưu kết quả, sau 45 giây giao dịch được phục hồi sang Pay2S khi được tải lại. QR Tingee chưa lưu không được hiển thị cho khách; không tạo thêm bill Tingee cho giao dịch đó.
- Nếu cả hai cổng không dùng được, màn hình không hiển thị QR/tài khoản để nhận tiền. Kiểm tra cấu hình và liên hệ hỗ trợ; đơn chưa thanh toán vẫn tuân theo thời hạn hết hạn.
- Các giao dịch cũ trước migration giữ luồng chuyển khoản cũ. Duy trì webhook Pay2S và tài khoản nhận cũ để xử lý chúng. Không thay credentials sang merchant khác khi còn QR chờ thanh toán.

**Không cần webhook Tingee.** Worker chạy cùng Node, gọi API trạng thái theo `billId` và `qrAccount`, kiểm tra ngân hàng/VA/số tiền, chỉ tự ghi nhận khi `fully-paid` và số tiền khớp. Worker kiểm tra theo đợt khoảng 30 giây; trình duyệt cập nhật từ backend, kể cả khách đóng trang thì worker vẫn đối soát. [API trạng thái QR](https://developers.tingee.vn/docs/qr/dynamic/get-status-dynamic-qr/).

Pay2S dự phòng vẫn dùng webhook có xác thực hiện có tại `/api/webhooks/pay2s`. Nếu bật Kafka, giữ payment worker đang chạy để xử lý Pay2S; Tingee được đối soát trực tiếp trong tiến trình API Node. Chỉ thêm API Credentials Tingee không thay đổi cách nhận giao dịch Pay2S.

Báo cáo từ cổng khác với cổng đã gắn cho giao dịch được lưu với trạng thái `provider_mismatch`, không cộng tiền và không cho cộng tiền thủ công từ báo cáo đó. Điều này tránh cùng một chuyển khoản được Tingee và Pay2S báo lại rồi ghi có hai lần.

QR hết hạn hoặc đơn bị hủy được kiểm tra rồi vô hiệu hóa qua Tingee; tiền đã vào nhưng được phát hiện sau khi đơn hết hạn sẽ vào danh sách cần đối soát, không tự giao sản phẩm đã giải phóng khỏi đơn. Thanh toán thiếu/thừa cũng cần kiểm tra. [API vô hiệu hóa QR](https://developers.tingee.vn/docs/qr/dynamic/delete-dynamic-qr/).

## Kiểm tra trên VPS

```bash
npm run check:config
sudo systemctl restart keynest
sudo systemctl status keynest --no-pager
sudo journalctl -u keynest -n 60 --no-pager
```

Các lệnh systemd áp dụng khi dịch vụ tên `keynest`. `check:config` chỉ kiểm tra biến môi trường, không xác nhận credentials hoạt động. Trong quản trị → trạng thái ngân hàng, kiểm tra Tingee và Pay2S dự phòng.

Truy vấn chẩn đoán trong Supabase SQL Editor:

```sql
select p.id, p.status, p.amount, p.expires_at,
       r.provider, r.state, r.bill_id, r.attempts, r.last_error, r.remote_closed
from public.payments p
join public.payment_routes r on r.payment_id = p.id
order by p.created_at desc limit 30;

select transaction_id, code, amount, outcome, created_at
from public.payment_events where outcome = 'needs_review'
order by created_at desc limit 30;
```

`creating` quá 45 giây sẽ được phục hồi khi tải lại giao dịch. `failed` thường cần kiểm tra cả Tingee và Pay2S. `tingee_status_unavailable` cho biết tra cứu lỗi hoặc dữ liệu bill không khớp; không tự ghi có khi chưa xác minh được. Xem nhật ký Tingee để xác định nguyên nhân.

Sau triển khai, thử một khoản nhỏ: tạo QR, kiểm tra bill trong Tingee, thanh toán và xác nhận số dư/đơn cập nhật đúng một lần. Thử dự phòng bằng môi trường thử nghiệm có API Tingee giả lập lỗi; không sửa Secret Token production khi còn bill đang chờ. Kiểm thử trong repo dùng API giả lập và PostgreSQL cục bộ; chưa chứng minh cấu hình tài khoản Tingee thật của bạn đã hoạt động.
