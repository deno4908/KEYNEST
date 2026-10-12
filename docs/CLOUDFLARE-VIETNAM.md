# Chỉ cho truy cập KEYNEST từ IP Việt Nam

Trang thông báo: `public/vietnam-only.html`, xem tại `/vietnam-only.html` sau deploy. HTML độc lập, không tải font/ảnh/API. Upload file này không tự chặn IP: phải bật một trong hai cách dưới đây tại Cloudflare.

Quốc gia lấy từ IP do Cloudflare xác định. Không xác định chắc chắn người dùng có VPN: VPN IP Việt Nam vẫn được vào; người ở Việt Nam dùng IP nước ngoài có thể bị chặn. IP không rõ quốc gia cũng bị chặn. Không cho qua dựa trên cookie/header do khách tự gửi.

## Chuẩn bị chung

1. Domain `keynest.store` phải dùng nameserver Cloudflare và đã Active.
2. DNS → Records → bản ghi web `keynest.store` trỏ VPS, bật **Proxied (mây cam)**. Nếu dùng `www`, bật proxy cả bản ghi đó.
3. SSL/TLS → Overview → **Full (strict)**; VPS đang có chứng chỉ HTTPS hợp lệ. Không chọn Flexible.
4. Quy tắc Cloudflare chỉ bảo vệ lưu lượng qua Cloudflare. Nếu VPS còn nhận web trực tiếp từ mọi IP, có thể bỏ qua rule bằng origin IP. Firewall của VPS cần giới hạn cổng web 80/443 chỉ từ dải IP Cloudflare (https://www.cloudflare.com/ips/), giữ SSH/Bitvise truy cập được, không mở public 3001. Kiểm tra cả IPv4/IPv6 và cách gia hạn chứng chỉ trước khi đổi firewall; tài liệu này không tự sửa firewall.
5. Khi bật proxy, backend có thể thấy IP Cloudflare thay vì khách: cấu hình Nginx Real IP chỉ tin các dải Cloudflare, `real_ip_header CF-Connecting-IP;`, rồi tiếp tục chuyển `$remote_addr` sang X-Forwarded-For cho Node. Không tin CF-Connecting-IP từ mọi nguồn và không tăng TRUST_PROXY tùy tiện. Xem https://developers.cloudflare.com/support/troubleshooting/restoring-visitor-ips/restoring-original-visitor-ips/ .

## Cách A — WAF Custom Rule (chặn đơn giản; trang riêng cần Pro+)

1. Chọn domain → **Security → Security rules → Create rule → Custom rules** (giao diện cũ: Security → WAF → Custom rules).
2. Tên: `KEYNEST - Vietnam only`.
3. Chọn **Edit expression**, dán:

```text
(http.host in {"keynest.store" "www.keynest.store"} and ip.src.country ne "VN" and not (http.request.method eq "POST" and http.request.uri.path in {"/api/webhooks/pay2s" "/api/webhooks/sepay"}))
```

4. Action: **Block** (không chọn Managed Challenge, vì vượt qua challenge sẽ vẫn vào được).
5. Nếu có **Custom response** (Pro trở lên): chọn HTML, status 403, dán toàn bộ nội dung `public/vietnam-only.html` vào response body. HTML này không cần URL tải tài nguyên bên ngoài. API cũng nhận HTML 403 khi dùng phương án này.
6. **Deploy**. Free không có custom response sẽ hiện trang block mặc định Cloudflare. Nếu muốn đúng trang KEYNEST trên Free, dùng cách B và không bật rule A cùng lúc.

Ngoại lệ chỉ cho POST vào đúng hai webhook; backend vẫn kiểm tra token nhà cung cấp, tài khoản nhận, số tiền và chống trùng. Không dùng Skip toàn bộ WAF hoặc miễn toàn bộ `/api`. Browser OAuth callback không cần ngoại lệ: trình duyệt khách Việt Nam vẫn vào được bình thường.

## Cách B — Worker để hiện trang riêng trên Free

Worker dùng quốc gia từ `request.cf.country`, không dùng header CF-IPCountry khách tự đặt. Trả 403 HTML cho trang web và JSON cho API. Có thể dùng Workers Free trong hạn mức của tài khoản; hết hạn mức ở chế độ fail closed thì website có thể bị gián đoạn, kể cả webhook. Theo dõi Usage, không coi Worker Free là không giới hạn.

1. Mở file **`deploy/cloudflare-vietnam-worker.js`** trong VS Code. Đây là file đã gộp HTML + code, có thể copy toàn bộ. Không copy riêng file `cloudflare-country-handler.js`.
2. Cloudflare → **Workers & Pages → Create application / Create Worker → Hello World**. Đặt tên `keynest-vietnam`, Deploy bản khởi tạo.
3. Vào **Edit code**, xóa mã Hello World, dán toàn bộ file ở bước 1. **Deploy**.
4. Worker → **Settings → Domains & Routes → Add → Route**. Chọn zone `keynest.store`, route:

```text
keynest.store/*
```

Chọn **Route**, không thay bản ghi web thành Custom Domain Worker, vì Worker cần chuyển tiếp về VPS hiện có. Nếu dùng www, thêm `www.keynest.store/*`.

5. Giữ chế độ **Fail closed** nếu có tùy chọn. Fail open có thể bỏ qua giới hạn quốc gia khi Worker không chạy.
6. Nếu đã bật rule chặn quốc gia ở cách A, tắt riêng rule đó sau khi Worker route được gắn: WAF chặn trước thì Worker không thể hiển thị trang KEYNEST. Các rule bảo mật khác giữ nguyên.
7. Không tạo ngoại lệ rộng cho static/API: route `/*` phải bao phủ website và API. Worker chuyển request VN về origin bằng fetch(request), các POST webhook chính xác được chuyển về backend để xác thực.

Worker độc lập với GitHub Actions hiện tại. Push code chỉ cập nhật web trên VPS; lần đầu và khi sửa Worker phải dán/deploy lại trên Cloudflare. Sau sửa HTML hoặc handler, chạy `node scripts/build-country-worker.js` để tạo lại file Worker rồi dán file mới.

## Cập nhật hiện tại — vietnam-region-v5

Đã mở lại GET/HEAD robots.txt, ảnh công khai `/images/share/`, `/images/products/` và `/api/media/<id>.webp` theo định dạng cho phép trong handler. Khách truy cập thông thường ngoài VN vào `/` nhận giao diện giới hạn khu vực; `/privacy` và `/terms` vẫn là trang tĩnh công khai. Bot chia sẻ Discord/Facebook và các bot được liệt kê chỉ nhận metadata trang chủ hoặc sản phẩm, không được vào ứng dụng/API nghiệp vụ. Cookie, Authorization và query được bỏ khi lấy preview/ảnh. Cần Deploy lại Worker. Chế độ v3 bên dưới là cấu hình cũ.

## Chế độ chặn chặt cũ — strict-vietnam-v3

Worker hiện chỉ cho IP ngoài Việt Nam (hoặc không xác định quốc gia) đọc `GET/HEAD /`, `/privacy`, `/terms`, gồm dấu `/` cuối đường dẫn chính sách. Ba trang này là HTML tự chứa, dùng chung nội dung giới thiệu/chính sách của website, không tải JavaScript, ảnh hoặc gọi API. Không có ngoại lệ theo User-Agent.

Mọi đường dẫn khác trả 403, bao gồm API công khai, API tài khoản, ảnh `/api/media`, tài nguyên `/assets`, trang sản phẩm, preview và robots.txt. Ngoại lệ duy nhất ngoài ba trang là **POST chính xác** `/api/webhooks/pay2s` và `/api/webhooks/sepay`; backend vẫn phải xác thực webhook. Bot Facebook/Discord ngoài VN không còn lấy được ảnh chia sẻ sản phẩm trong chế độ này.

Khi sửa chính sách, chạy `node scripts/build-country-worker.js` và dán lại toàn bộ file Worker đã tạo → Deploy để cập nhật bản HTML công khai. Git push không cập nhật Worker. Header nhận diện: `X-Keynest-Region-Worker: strict-vietnam-v3`.

Giới hạn này chỉ áp dụng request đi qua Worker. Cần khóa truy cập trực tiếp cổng web của VPS để tránh bỏ qua Cloudflare; không coi việc triển khai Worker là đã khóa origin.

## Kiểm tra sau bật

- Mạng Việt Nam: trang chủ, đăng nhập, account, mua hàng hoạt động.
- VPN IP Singapore/Mỹ: trang chủ hiện giao diện giới hạn khu vực; `/privacy` và `/terms` đọc được. `/account` trả trang chặn 403; `/api/config` và các API khác trả 403 với code REGION_RESTRICTED, trừ POST webhook nêu trên.
- Tắt VPN và bấm “Thử truy cập lại”: trở lại cửa hàng.
- Chỉ thêm header `CF-IPCountry: VN` trên request IP nước ngoài không được mở quyền.
- Callback Pay2S hợp lệ vẫn phải được backend nhận và xác nhận thanh toán. Không gửi thanh toán thật chỉ để thử; kiểm tra staging hoặc công cụ thử webhook của nhà cung cấp.
- Health CI/CD đang gọi 127.0.0.1 trên VPS, không qua rule. Nếu thêm kiểm tra domain công khai từ GitHub runner nước ngoài, sẽ nhận 403 là đúng.
- Truy cập trực tiếp VPS bằng IP/Host phải bị firewall chặn; chỉ kiểm tra domain qua Cloudflare chưa chứng minh origin được khóa.

Rollback: cách A tắt rule; cách B gỡ route Worker khỏi domain. Không xóa bản ghi DNS hay thay nameserver để tắt tính năng.

## Nguồn chính thức

- Country expression: https://developers.cloudflare.com/waf/custom-rules/use-cases/allow-traffic-from-specific-countries/
- WAF custom response Pro+: https://developers.cloudflare.com/waf/custom-rules/create-dashboard/
- Custom Errors plans: https://developers.cloudflare.com/rules/custom-errors/
- Worker route: https://developers.cloudflare.com/workers/configuration/routing/routes/
- Country metadata: https://developers.cloudflare.com/workers/runtime-apis/request/
- Worker limits: https://developers.cloudflare.com/workers/platform/limits/
