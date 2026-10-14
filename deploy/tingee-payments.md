# Tingee QR tĩnh VCB, Pay2S tự động dự phòng

KEYNEST mặc định tạo VietQR tĩnh qua Tingee cho tài khoản VCB cá nhân. Pay2S chỉ được gán cho giao dịch mới nếu Tingee không tạo được QR hoặc không đọc được lịch sử giao dịch. Cổng thanh toán được lưu cố định theo từng giao dịch; không đổi QR của một giao dịch đã phát hành.

Tingee ghi rõ VCB cá nhân không hỗ trợ QR động, nhưng hỗ trợ QR tĩnh. QR tĩnh có thể điền sẵn số tiền và nội dung chuyển khoản; nó không phải bill QR một lần của API động. [Bảng hỗ trợ QR của Tingee](https://developers.tingee.vn/docs/luu-y-quan-trong/) · [API tạo VietQR tĩnh](https://developers.tingee.vn/docs/qr/static/generate-viet-qr/).

## Triển khai

1. Tạm dừng API Node và worker thanh toán trong lúc áp dụng schema.
2. Chạy `supabase/migrations/037_tingee_payments.sql`, sau đó `supabase/migrations/038_tingee_static_qr.sql` trong Supabase SQL Editor. Không chạy migration 038 trước 037.
3. Cập nhật `.env` trên VPS, triển khai frontend/backend mới, rồi khởi động lại API và worker.
4. Tạo **giao dịch mới** để kiểm tra. Những giao dịch đã phát hành QR Pay2S tiếp tục dùng Pay2S.

Pipeline không tự chạy SQL hoặc thay `.env` trên VPS. Backend kiểm tra bảng `payment_routes` và cột `qr_kind` khi khởi động; thiếu migration thì health check sẽ thất bại.

## Cấu hình VPS

```dotenv
BANK_PAYMENT_PROVIDER=tingee
TINGEE_QR_MODE=static
TINGEE_CLIENT_ID=YOUR_CLIENT_ID
TINGEE_SECRET_TOKEN=YOUR_SECRET_TOKEN
TINGEE_BANK_BIN=970436
TINGEE_VA_ACCOUNT=YOUR_TINGEE_VA_ACCOUNT
TINGEE_ACCOUNT_NAME=YOUR_VCB_ACCOUNT_NAME
TINGEE_BASE_URL=https://open-api.tingee.vn

# Chỉ credentials Master Merchant mới cần giá trị này.
TINGEE_MERCHANT_ID=

# Pay2S tự động dự phòng; giữ đúng thông tin nhận tiền và webhook đang hoạt động.
BANK_CODE=MB
BANK_ACCOUNT_NUMBER=YOUR_PAY2S_BANK_ACCOUNT
BANK_ACCOUNT_NAME=YOUR_PAY2S_ACCOUNT_NAME
PAY2S_WEBHOOK_TOKEN=YOUR_EXISTING_PAY2S_TOKEN
```

`TINGEE_VA_ACCOUNT` là **số VA Tingee đã liên kết với tài khoản VCB** và là số nhận tiền trong QR. Không dùng số tài khoản VCB gốc ở đây. Theo hướng dẫn Tingee, VCB cá nhân cần nhận chuyển khoản vào VA để Tingee nhìn thấy biến động; chuyển vào STK gốc có thể không xuất hiện trong dữ liệu đối soát. `TINGEE_BANK_BIN=970436` là BIN VCB; tên chủ tài khoản phải khớp tài khoản ngân hàng. [Điều kiện tạo/liên kết VA VCB](https://developers.tingee.vn/docs/banking/create-va/) · [Lưu ý về STK gốc và VA](https://developers.tingee.vn/docs/luu-y-quan-trong/).

Trong Tingee BaaS Portal → **API Credentials**, dùng Client ID/Secret Token có quyền tạo VietQR và truy vấn lịch sử giao dịch. Tài khoản VCB cần được liên kết/cấp quyền nhận biến động cho merchant. Secrets chỉ lưu ở backend. [Hướng dẫn API Credentials](https://developers.tingee.vn/docs/config-info/).

Nếu `TINGEE_QR_MODE=dynamic`, giữ `TINGEE_VA_ACCOUNT` và chỉ dùng với ngân hàng/tài khoản hỗ trợ QR động. VCB cá nhân phải để `static`; QR tĩnh của KEYNEST vẫn được điền sẵn số tiền và mã đơn nhưng chuyển tiền vào VA.

## Đối soát QR tĩnh

Mỗi giao dịch có QR VietQR điền sẵn số tiền và mã `KN…` riêng. Người mua phải giữ nguyên nội dung và chuyển đúng số tiền. Worker backend đọc API lịch sử giao dịch Tingee, chỉ tự ghi nhận giao dịch `CREDIT` khớp ngân hàng, tài khoản nhận, mã đơn, thời gian và số tiền. [API lịch sử giao dịch Tingee](https://developers.tingee.vn/docs/banking/get-paging-transaction/).

Worker truy vấn định kỳ, không cần webhook Tingee. Nếu lịch sử giao dịch không khả dụng ngay lúc tạo QR, hệ thống không phát hành QR Tingee cho giao dịch đó và sẽ thử Pay2S dự phòng. Nếu QR Tingee đã được phát hành, lỗi truy vấn chỉ được thử lại; không chuyển giao dịch đó sang Pay2S.

QR tĩnh không thể bị vô hiệu hóa ở phía ngân hàng. KEYNEST chỉ tự đối soát giao dịch trong hạn thanh toán; giao dịch đến muộn hoặc sai số tiền cần admin kiểm tra, không được tự cộng tiền/giao hàng. Backend tiếp tục dò lịch sử tối đa 7 ngày để đưa các khoản chuyển muộn vào danh sách cần đối soát. Chuyển khoản thiếu/thừa hoặc sai nội dung không được tự xác nhận.

Khi Tingee tạo QR lỗi, giao dịch mới tự dùng Pay2S nếu cấu hình dự phòng đầy đủ. Mã QR của giao dịch đã gắn với Pay2S/Tingee không bị đổi sau đó, tránh cùng một khoản chuyển bị ghi nhận hai lần. Giao dịch cũ trước migration vẫn giữ luồng thanh toán cũ.

## Kiểm tra trên VPS

```bash
npm run check:config
sudo systemctl restart keynest
sudo systemctl status keynest --no-pager
sudo journalctl -u keynest -n 60 --no-pager
```

`check:config` kiểm tra biến môi trường nhưng không gọi Tingee/Supabase và không xác nhận credentials có hiệu lực. Tạo giao dịch mới rồi kiểm tra route:

```sql
select p.id, p.status, p.amount, p.expires_at,
       r.provider, r.qr_kind, r.state, r.bill_id, r.attempts,
       r.last_error, r.remote_closed
from public.payments p
join public.payment_routes r on r.payment_id = p.id
order by p.created_at desc limit 30;

select transaction_id, code, amount, outcome, created_at
from public.payment_events where outcome = 'needs_review'
order by created_at desc limit 30;
```

Với QR VCB tĩnh, route mới phải có `provider='tingee'`, `qr_kind='static'` và `state='ready'`. Nếu vẫn thấy MB/Pay2S, đó có thể là giao dịch cũ hoặc Tingee đã lỗi và route mới dùng fallback. Xem log `Tingee QR creation failed (...)` và cột `last_error`; các mã lỗi đã được rút gọn, không log Secret Token hoặc nội dung response thô. Sửa cấu hình xong hãy tạo giao dịch mới. Nếu tiền đã được chuyển vào STK VCB gốc thay vì VA, Tingee có thể không cung cấp giao dịch đó cho hệ thống; cần kiểm tra lịch sử trong app Tingee/ngân hàng và xử lý đơn thủ công.

`creating` quá 45 giây được phép thử lại khi tải giao dịch. Nếu giao dịch không xuất hiện trong Tingee, kiểm tra BIN, số VA đã liên kết với VCB, quyền API tạo QR/lịch sử giao dịch, môi trường production/UAT và đồng hồ VPS. Không đổi merchant/credentials khi còn giao dịch đang chờ thanh toán.
