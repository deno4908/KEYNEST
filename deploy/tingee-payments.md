# Tingee QR động MBBank, Pay2S dự phòng

KEYNEST dùng Tingee để tạo QR động một lần cho từng giao dịch, với MBBank làm ngân hàng nhận tiền. Mỗi bill có mã riêng và backend kiểm tra trạng thái cùng số tiền trước khi ghi nhận. Nếu Tingee không tạo được bill, giao dịch mới có thể dùng Pay2S khi Pay2S đã cấu hình đầy đủ. Sau khi QR đã phát hành, hệ thống giữ nguyên cổng của giao dịch đó.

Tingee công bố MBBank hỗ trợ QR động cho tài khoản cá nhân, hộ kinh doanh và doanh nghiệp; BIN MBBank là `970422`. API động cần VA, BIN, số tiền, loại QR và thời hạn. [Bảng hỗ trợ ngân hàng của Tingee](https://developers.tingee.vn/docs/luu-y-quan-trong/) · [API tạo QR động](https://developers.tingee.vn/docs/qr/dynamic/generate-dynamic-qr/) · [API trạng thái bill](https://developers.tingee.vn/docs/qr/dynamic/).

## Cấu hình VPS

Mở file môi trường thật trên VPS:

```bash
sudo nano /opt/keynest/.env
```

Đặt cấu hình Tingee như sau. `TINGEE_VA_ACCOUNT` phải là VA MBBank đã liên kết/cấp cho tài khoản Tingee của bạn; không lấy số tài khoản VCB cũ hoặc tự điền số tài khoản thường nếu Tingee yêu cầu VA.

```dotenv
BANK_PAYMENT_PROVIDER=tingee
TINGEE_QR_MODE=dynamic
TINGEE_BANK_BIN=970422
TINGEE_VA_ACCOUNT=YOUR_MBBANK_LINKED_VA
TINGEE_ACCOUNT_NAME=YOUR_MBBANK_ACCOUNT_NAME
TINGEE_CLIENT_ID=YOUR_CLIENT_ID
TINGEE_SECRET_TOKEN=YOUR_SECRET_TOKEN
TINGEE_BASE_URL=https://open-api.tingee.vn

# Chỉ cần nếu Client ID/Secret thuộc Master Merchant.
TINGEE_MERCHANT_ID=

# Pay2S là dự phòng cho các giao dịch mới khi Tingee không tạo được QR.
BANK_CODE=MB
BANK_ACCOUNT_NUMBER=YOUR_PAY2S_ACCOUNT
BANK_ACCOUNT_NAME=YOUR_PAY2S_ACCOUNT_NAME
PAY2S_WEBHOOK_TOKEN=YOUR_EXISTING_PAY2S_TOKEN
```

Trong Tingee BaaS Portal, bảo đảm credentials có quyền tạo QR động và truy vấn trạng thái bill, đồng thời VA đã liên kết với MBBank. Không gửi Client ID/Secret hoặc nội dung `.env` vào chat hay commit lên Git. Nếu bạn chưa có VA MBBank, cần tạo/liên kết VA trong Tingee trước khi bật cấu hình này.

Sau khi lưu file, khởi động lại API để nạp cấu hình mới:

```bash
sudo systemctl restart keynest
sudo systemctl status keynest --no-pager
sudo journalctl -u keynest -n 60 --no-pager
```

Pipeline deploy không sửa `/opt/keynest/.env`. Thay đổi này áp dụng cho **giao dịch mới**; QR đã phát hành và các giao dịch cũ vẫn giữ nguyên tuyến nhận tiền. Không yêu cầu khách trả lần hai nếu giao dịch cũ đã chuyển tiền; hãy đối soát giao dịch đó riêng.

## Kiểm tra

Tạo một giao dịch mới rồi xác nhận route đã dùng đúng ngân hàng và loại QR:

```sql
select p.code, p.status, p.amount, p.expires_at,
       r.provider, r.qr_kind, r.state, r.bill_id,
       r.bank, r.bank_bin, r.va_account, r.last_error
from public.payments p
join public.payment_routes r on r.payment_id = p.id
order by p.created_at desc limit 20;
```

Giao dịch mới cần có `provider='tingee'`, `qr_kind='dynamic'`, `bank_bin='970422'`, `state='ready'` và `bill_id` khác rỗng. Nếu thấy Pay2S, Tingee đã lỗi khi tạo bill hoặc cấu hình/VA chưa được chấp nhận; xem mã lỗi rút gọn trong `last_error` và log journalctl. Nếu Tingee trả lỗi như `tingee_rejected_1018`, kiểm tra VA MBBank, quyền API, merchant ID (nếu dùng Master Merchant), và môi trường production/UAT với bộ phận Tingee.

Tingee lưu bill theo giao dịch và worker kiểm tra trạng thái định kỳ; không cần webhook Tingee. Backend chỉ tự ghi nhận bill đúng với giao dịch và số tiền đã tạo. Tingee lưu ý một số ứng dụng ngân hàng có thể cho phép người trả sửa số tiền khi quét QR động; giao dịch sai số tiền sẽ không được tự xác nhận. [Lưu ý về QR động](https://developers.tingee.vn/docs/luu-y-quan-trong/).

Các migration cần áp dụng theo thứ tự: `037_tingee_payments.sql`, `038_tingee_static_qr.sql`, rồi `039_tingee_late_wallet_credit.sql`. Migration 039 cho phép hệ thống ghi nhận khoản nạp ví được Tingee xác nhận muộn nhưng thời điểm chuyển khoản nằm trước hạn QR; thanh toán đơn hàng đến muộn vẫn được giữ để admin đối soát vì hàng có thể đã được nhả. Không chạy lại migration 037/038 nếu schema đã tồn tại; khi chỉ đổi cấu hình mới từ VCB tĩnh sang MBBank động thì không cần migration mới ngoài bản vá 039 này.
