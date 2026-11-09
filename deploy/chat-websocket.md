# Chat seller – khách hàng qua WebSocket

Chat theo sản phẩm trong đơn và trả lời hỗ trợ seller/khách hàng dùng WebSocket
`/api/chat/live`. Không có vòng lặp GET chat 5 giây ở trình duyệt hoặc vòng lặp
đọc hội thoại trong backend. Các màn hình khác (đơn hàng, thanh toán, thông báo)
vẫn có lịch cập nhật riêng.

## Hoạt động

- `POST /api/chat/live-ticket` dùng phiên HTTP hiện có để xác thực và kiểm tra
  quyền của topic (`order:<item UUID>`, `seller-support`, `tickets`). Vé ngẫu
  nhiên hết hạn sau 30 giây, chỉ dùng một lần và không lưu trong database.
  Phản hồi kèm `initial`: lịch sử theo đúng quyền người xem từ lần đọc kiểm tra
  này, để giao diện hiển thị ngay mà không phải chờ mở socket. Trang hỗ trợ
  không cần GET lịch sử riêng lúc mở. Nút gửi vẫn chờ kết nối trực tiếp sẵn sàng.
- Browser gửi vé qua subprotocol `ticket.<vé>`, không đưa bearer/refresh token
  vào URL. Server chỉ chấp nhận Origin đúng `APP_ORIGIN` và subprotocol
  `keynest-chat`.
- Snapshot đầu tiên gồm lịch sử và quyền riêng của người đang xem. Gửi tin,
  yêu cầu/giải quyết hoàn tiền vẫn dùng các hàm/RPC và kiểm tra quyền hiện có.
  Chỉ xác nhận gửi sau khi lưu. Dữ liệu được đẩy lại cho các kết nối liên quan;
  không dùng lại snapshot của người gửi cho người nhận.
  Socket đọc lại dữ liệu sau Upgrade để nhận cả tin nhắn phát sinh từ lúc cấp vé;
  lần đầu dùng kết quả xác thực vừa kiểm tra tại Upgrade, các lần sau kiểm tra
  lại phiên như trước.
- HTTP chat API vẫn hoạt động cho client cũ; mutation thành công cũng kích hoạt
  cập nhật WebSocket. Thay đổi hỗ trợ làm mới các danh sách đang kết nối theo
  đúng quyền của từng tài khoản. Ghi trực tiếp vào Supabase ngoài ứng dụng không
  phát sự kiện; kết nối lại sẽ lấy lại trạng thái hiện tại.
- Mỗi lần gửi/đẩy dữ liệu đều kiểm tra lại auth, MFA, OTP admin, thu hồi phiên,
  khóa tài khoản và quyền hội thoại. Admin quan sát vẫn chỉ được đọc.
- Heartbeat ping/pong 25 giây không đọc DB. Kết nối được gia hạn sau 5 phút qua
  vé mới, giúp dùng access token vừa refresh. Reconnect tăng thời gian chờ từ
  khoảng 1 đến 30 giây; đồng bộ lại toàn bộ lịch sử được API hiện có trả về
  (tối đa 200 tin chat đơn), giữ nội dung đang nhập.
- Không tự gửi lại lệnh chưa nhận xác nhận. Tin chat đơn giữ `request_id` để
  chống trùng khi người dùng thử lại. Với hỗ trợ/hoàn tiền, kiểm tra trạng thái
  vừa đồng bộ trước khi thử lại.
- Giới hạn: 6 kết nối/tài khoản, 500/process, frame tối đa 16 KiB, hàng đợi tối
  đa 8 lệnh/kết nối, 60 frame và 20 lệnh ghi/phút/tài khoản. Tin hỗ trợ còn có
  giới hạn 15 lệnh/15 phút. Kết nối chậm và client không pong bị đóng.

## Proxy và triển khai

1. Cài dependency bằng `npm ci`; build bằng `npm run build` như hiện tại.
2. Vite `/api` đã bật `ws: true` cho môi trường dev.
3. Trên VPS, thêm location chính xác `/api/chat/live` trong `deploy/nginx.conf`
   vào server block Nginx đang phục vụ KEYNEST, gồm cả server block HTTPS nếu
   đang dùng Certbot. Cần giữ `Upgrade`, `Connection`, HTTP/1.1 và timeout 75s.
   Kiểm tra `sudo nginx -t` trước khi `sudo systemctl reload nginx`.
4. Giữ proxy Cloudflare và Worker giới hạn vùng hiện tại. Request VN được
   chuyển đến origin, bao gồm WebSocket Upgrade; không mở bypass quốc gia.
   Kiểm tra trình duyệt trong VN thấy handshake 101 ở `/api/chat/live`.
5. Restart/redeploy Node qua entrypoint `server/index.js`. Live hub được gắn
   vào HTTP server do `createServer()` tạo. Kết nối cũ tự reconnect sau restart.

Hub hiện phù hợp cấu hình một process API của KEYNEST. Khi chạy nhiều process
hoặc nhiều replica, cần broker phát sự kiện và cơ chế vé dùng chung/sticky
routing; không tăng số process trước khi bổ sung phần đó. Payment worker riêng
không tham gia gửi tin chat.

Không cần thêm migration, bật Supabase Realtime hoặc cấp key Supabase cho
trình duyệt. File Worker được sinh sẵn không cần thay đổi cho tính năng này.

## Hướng dẫn từng bước cho KEYNEST đang chạy trên VPS

Có hai việc riêng: cập nhật Nginx một lần trên VPS và đưa mã ứng dụng mới lên
bằng GitHub Actions. Workflow hiện tại chạy `deploy/release.sh`, cài dependency
và restart service; nó không cài `deploy/nginx.conf` vào Nginx.

Những lệnh dưới đây là hướng dẫn để người vận hành thực hiện. Việc có tài liệu
này trong repository chưa có nghĩa cấu hình hoặc mã đã được đưa lên VPS.

### 1. Kết nối VPS từ Windows

Mở PowerShell trên máy của bạn, thay tên tài khoản, địa chỉ và cổng SSH bằng
thông tin VPS đang dùng:

```powershell
ssh -p 22 TEN_TAI_KHOAN@IP_VPS
```

Nếu đã có kết nối SSH riêng trong VS Code/terminal, dùng kết nối đó. Những
lệnh ở bước 2–4 bên dưới chạy trong terminal Linux của VPS.

### 2. Tìm đúng cấu hình Nginx

```bash
sudo nginx -T 2>&1 | grep -n -E 'configuration file|server_name|listen|proxy_pass'
```

Tìm domain `keynest.store` và các dòng `# configuration file ...`. Lưu ý server
block có `listen 443 ssl` nếu Nginx đang kết thúc HTTPS; nếu Cloudflare kết nối
origin bằng cổng khác, cần sửa block thực sự nhận lưu lượng đó. Không chỉ sửa
block cổng 80 nếu block đó chỉ redirect sang HTTPS.

Đường dẫn có thể là `/etc/nginx/sites-enabled/keynest`, nhưng cần dùng đường
dẫn tìm được từ cấu hình thực tế. Ví dụ sau giả sử đường dẫn đó đúng:

```bash
nginx_file=/etc/nginx/sites-enabled/keynest
sudo test -f "$nginx_file"
```

Nếu file nằm ở nơi khác, đổi giá trị `nginx_file`. Chỉ tiếp tục khi file tồn tại.

### 3. Sao lưu và thêm location WebSocket

Trong cùng phiên SSH:

```bash
sudo install -d -m 700 /var/backups/keynest-nginx
backup_file="/var/backups/keynest-nginx/site-$(date +%Y%m%d-%H%M%S).conf"
sudo cp -L -- "$nginx_file" "$backup_file"
printf 'Backup Nginx: %s\n' "$backup_file"
sudo nano "$nginx_file"
```

Ghi lại đường dẫn backup vừa in. Trong block `server { ... }` đang phục vụ
domain, thêm đoạn này cùng cấp với `location / { ... }`, không lồng bên trong
location khác:

```nginx
location = /api/chat/live {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 75s;
    proxy_send_timeout 75s;
    proxy_buffering off;
}
```

Giữ nguyên cấu hình SSL, chứng chỉ, redirect, giới hạn truy cập và các location
hiện tại. Nếu đã có location này, chỉnh location đó thay vì thêm trùng. Không
chép toàn bộ file mẫu có `shop.example.com` đè lên cấu hình đang chạy. `proxy_pass`
ở trên không có dấu `/` cuối để giữ nguyên đường dẫn `/api/chat/live`.

Trong nano, nhấn **Ctrl+O**, **Enter** để lưu, rồi **Ctrl+X** để thoát.

```bash
sudo nginx -t
```

Chỉ khi thấy `syntax is ok` và `test is successful` mới chạy:

```bash
sudo systemctl reload nginx
```

Nếu kiểm tra thất bại, sửa lỗi theo số dòng Nginx báo hoặc phục hồi bản backup;
không reload cấu hình đang lỗi:

```bash
sudo cp -- "$backup_file" "$nginx_file"
sudo nginx -t
```

Nếu đã reload rồi và cần quay về bản cũ, sau khi phục hồi và kiểm tra thành công
thì chạy lại `sudo systemctl reload nginx`. Hai biến trên chỉ còn trong phiên SSH
hiện tại; nếu đăng nhập lại, đặt lại đúng đường dẫn trước khi dùng lệnh phục hồi.

Nginx cần chuyển tiếp rõ `Upgrade` và `Connection` để mở đường hầm WebSocket.
Tham khảo [tài liệu Nginx](https://nginx.org/en/docs/http/websocket.html).

### 4. Kiểm tra domain của ứng dụng

Chỉ đọc dòng cấu hình cần thiết, không in toàn bộ file chứa secrets:

```bash
sudo grep -n '^APP_ORIGIN=' /opt/keynest/.env
```

Nếu người dùng mở website tại `https://keynest.store`, giá trị phải là:

```dotenv
APP_ORIGIN=https://keynest.store
```

Không có dấu `/` cuối. Nếu website dùng domain khác, dùng đúng origin đó. Browser
gửi Origin theo địa chỉ đang mở, nên không dùng `www.keynest.store` khi cấu hình
chỉ cho phép `keynest.store`. Nếu cần đổi giá trị, sửa đúng dòng trong
`sudo nano /opt/keynest/.env`; deployment ở bước sau sẽ restart Node để nạp lại.

### 5. Đưa mã mới lên GitHub từ Windows

Mở terminal PowerShell khác trên máy Windows, không chạy các lệnh Git bên dưới
trong thư mục release trên VPS:

```powershell
Set-Location 'C:\Users\The vinh\Downloads\MMO_WEB'
git status --short
git branch --show-current
```

Hiện tính năng được chuẩn bị trên nhánh `main`. Stage đúng các file của tính
năng, tránh gom các tài liệu và thay đổi khác trong workspace:

```powershell
git add package.json package-lock.json server/index.js server/chat-live.js server/seller-conversations.js server/sellers.js
git add src/useChatLive.ts src/OrderChat.tsx src/SellerDashboard.tsx src/App.tsx src/AdminSupport.tsx src/order-chat.css
git add vite.config.ts deploy/nginx.conf deploy/chat-websocket.md deploy/supabase-free-usage.md
git add tests/chat-live.test.js tests/browser/chat-live.spec.ts
git diff --cached --stat
git diff --cached --name-status
```

Kiểm tra danh sách chỉ có những file định đưa lên. Sau đó:

```powershell
git commit -m "Use WebSocket for seller and customer chat"
git push origin main
```

Mở repository GitHub → **Actions** → **Test and deploy KEYNEST** → lần chạy của
commit vừa push. Chờ cả job `check` và `deploy` thành công. Workflow hiện tại
chỉ deploy từ `main` và khi repository variable `VPS_DEPLOY_ENABLED` là `true`;
nếu `deploy` bị skipped, kiểm tra điều kiện đó tại Settings → Secrets and
variables → Actions → Variables.

Chạy lại workflow của commit cũ không đưa các file chưa commit trên máy lên VPS.
Không cần `git pull`, build hoặc `npm install` trực tiếp trong release đang chạy;
workflow đã đóng gói frontend và cài dependency runtime của bản release mới.

### 6. Kiểm tra Cloudflare

Vào Cloudflare → chọn domain → **Network** → kiểm tra **WebSockets** đang **On**.
Cloudflare hỗ trợ WebSocket trên mọi gói; xem
[hướng dẫn Cloudflare](https://developers.cloudflare.com/network/websockets/).

Giữ cấu hình proxy, SSL và Worker giới hạn Việt Nam hiện tại. Không thêm API
key hay sửa file Worker để cấp quyền chat. Lần kiểm tra thực tế cần đi từ IP
được Worker cho phép ở Việt Nam.

### 7. Xác nhận bản mới đang chạy

Trên VPS:

```bash
sudo systemctl status keynest --no-pager
curl --fail --silent --show-error http://127.0.0.1:3001/api/health
curl --fail --silent --show-error http://127.0.0.1:3001/release.txt
```

Service cần ở trạng thái `active (running)`, health trả `ok: true` và
`mode: supabase`. `release.txt` cần trùng SHA của commit vừa deploy trên GitHub.
Health thành công mới xác nhận Node hoạt động, chưa xác nhận WebSocket đã thông.

### 8. Thử chat trên trình duyệt

1. Mở website tại đúng domain trên mạng Việt Nam, nhấn **Ctrl+Shift+R** sau deploy.
2. Đăng nhập tài khoản người mua; mở chi tiết đơn có sản phẩm của seller rồi mở
   **Chat với người bán**.
3. Mở cửa sổ ẩn danh hoặc profile trình duyệt khác, đăng nhập seller của đúng sản
   phẩm, vào đơn bán và mở **Chat**. Admin khác không tham gia đơn chỉ được xem.
4. Trên một cửa sổ, nhấn **F12** → **Network** → chọn bộ lọc **WS**. Mở lại chat
   nếu đã mở trước khi bật DevTools.
5. Tìm kết nối `wss://keynest.store/api/chat/live`: handshake phải trả **101
   Switching Protocols**. Tab Messages/Frames hiển thị `snapshot` và các frame
   gửi/nhận. Kết nối duy trì trạng thái mở/pending là bình thường.
6. Gửi một tin từ người mua rồi trả lời từ seller. Hai bên cần thấy ngay mà không
   tải lại trang; giao diện chat hiện **Đã kết nối chat trực tiếp**.
7. Chuyển Network sang All hoặc Fetch/XHR, theo dõi ít nhất 15 giây. Không còn
   GET `/api/order-chat/<id>` hay GET `/api/seller/support` lặp mỗi 5 giây.
   `POST /api/chat/live-ticket` lúc mở/gia hạn/kết nối lại là bình thường; các
   request cập nhật đơn hàng, overview và thông báo vẫn có thể xuất hiện.
8. Kiểm tra thêm mục hỗ trợ của khách và seller với yêu cầu thuộc đúng đơn của
   seller. Phản hồi cần hiện ở phía còn lại mà không tải lại trang.

Không mở trực tiếp URL `/api/chat/live` để kết luận có lỗi: kết nối yêu cầu
Upgrade và vé một lần do ứng dụng cấp. Không copy vé hoặc bearer token vào công
cụ online. Khi ứng dụng reconnect sau ngắt mạng/redeploy, nó tự lấy lại lịch sử
và giữ draft; sau khoảng 5 phút cũng có một lần gia hạn kết nối theo thiết kế.

### 9. Nếu chưa kết nối được

| Dấu hiệu | Kiểm tra |
| --- | --- |
| `/api/chat/live-ticket` trả 404 | Bản mã mới chưa chạy hoặc proxy đổi đường dẫn; đối chiếu release SHA |
| Vé trả 401 | Đăng nhập lại; xem phiên có hết hạn/đã thu hồi không |
| Vé trả 403 | Xem nội dung lỗi: quyền hội thoại, MFA/OTP hoặc Worker chặn vùng |
| Upgrade `/api/chat/live` trả 400/426 | Kiểm tra `Upgrade`, `Connection` và đúng server block Nginx |
| Upgrade trả 401 | Vé hết hạn/đã dùng, phiên không hợp lệ; đóng chat rồi mở lại; nếu nhiều replica, xem giới hạn kiến trúc ở trên |
| Upgrade trả 403 | Origin không đúng `APP_ORIGIN`, Worker/WAF chặn; phân biệt bằng response/log |
| Trả 502 | Kiểm tra service Node và upstream `127.0.0.1:3001` |
| Browser báo CSP chặn `wss:` | Kiểm tra backend mới và `APP_ORIGIN`; bản mới cho phép WebSocket tại origin đã cấu hình |
| Liên tục ngắt sau khoảng một phút | Kiểm tra heartbeat và timeout của proxy đang thực sự phục vụ domain |
| UI vẫn GET chat mỗi 5 giây | Frontend cũ đang được phục vụ; hard refresh và đối chiếu release/build |

Xem log trên VPS nếu cần:

```bash
sudo journalctl -u keynest -n 80 --no-pager
sudo tail -n 80 /var/log/nginx/error.log
```

Nginx có thể dùng đường dẫn error log riêng; xem `error_log` trong cấu hình khi
file mặc định không có thông tin. Không cần mở cổng 3001 ra Internet để bật chat;
trình duyệt kết nối HTTPS/WSS qua Cloudflare và Nginx hiện tại.

## Kiểm tra

```sh
node --test tests/chat-live.test.js
npm test
npm run test:db
npm run build
```

Browser test `tests/browser/chat-live.spec.ts` cần API demo và Vite. Chạy với
`APP_MODE=demo`, `RECAPTCHA_ENABLED=false`, `APP_ORIGIN=http://127.0.0.1:5173`
và `DEMO_DATA_PATH` trỏ đến file demo thử nghiệm riêng. Không dùng dữ liệu thật.
Test tạo seller, sản phẩm, đơn, mở hai browser context, gửi tin hai chiều qua
proxy WebSocket thật, ngắt/reconnect, kiểm tra lịch sử và draft, đồng thời xác
nhận không phát sinh GET chat sau hơn một chu kỳ polling cũ.

Thư viện/proxy: [ws](https://github.com/websockets/ws#client-authentication),
[Vite proxy](https://vite.dev/config/server-options#server-proxy).
