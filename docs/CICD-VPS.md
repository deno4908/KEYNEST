# GitHub private → CI/CD → VPS 1 core / 1 GB

Hướng dẫn cho VPS Ubuntu 22.04/24.04 mới, tài khoản SSH có sudo, một domain trỏ về VPS. Không dùng Docker. Supabase chạy bên ngoài; Kafka/Redis tắt. GitHub build và test, VPS cài dependency production rồi chạy một tiến trình Node bằng systemd.

Luồng: push `main` → `npm ci` → test backend → test SQL trên database tạm → build → upload gói bằng SSH → restart → kiểm tra HTTP và đúng mã commit. Nếu kiểm tra thất bại, script khôi phục bản trước (nếu có). Đây là kiểm tra tiến trình/bản build, không chứng minh Supabase và thanh toán hoạt động.

## 1. Tạo repository private

Đăng nhập GitHub → dấu `+` → **New repository** → tên `keynest` → **Private** → không chọn tạo README/.gitignore/license → Create repository.

Trong PowerShell tại thư mục MMO_WEB:

```powershell
git init -b main
git config user.name "TEN_CUA_BAN"
git config user.email "EMAIL_GITHUB"
git add .
git status --short
git diff --cached --stat
```

Kiểm tra danh sách trước khi commit: không được có `.env`, `.data`, private key, bản dump database hay file chứa thông tin khách hàng. `.gitignore` đã bỏ qua các file môi trường và gói build phổ biến, nhưng file nhạy cảm đặt tên khác vẫn cần tự kiểm tra. Repo private vẫn không phải nơi lưu secret.

```powershell
git commit -m "Initial KEYNEST application and CI/CD"
git remote add origin https://github.com/USERNAME/keynest.git
git push -u origin main
```

Thay URL bằng repo của bạn. Khi Git yêu cầu, đăng nhập GitHub qua cửa sổ trình duyệt/Git Credential Manager; không dùng mật khẩu GitHub làm mật khẩu Git. Nếu thư mục đã có repo, bỏ qua `git init`; kiểm tra `git remote -v` trước khi thêm origin.

Mở tab **Actions**: job `check` chạy ngay, job `deploy` được bỏ qua cho đến khi bật biến ở bước 7. Chưa cần key Supabase cho CI, test sử dụng dữ liệu tạm. Giữ nguyên package-lock.json trong Git.

## 2. Chuẩn bị VPS và domain

Thay `IP_VPS`, `USER_VPS`, `shop.example.com` bằng giá trị thật. Các khối bash chạy trên VPS, các khối powershell chạy máy cá nhân.

```powershell
ssh USER_VPS@IP_VPS
```

```bash
sudo apt update
sudo apt install -y curl ca-certificates nginx certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh
sudo bash /tmp/nodesource_setup.sh
sudo apt install -y nodejs
node -v
npm -v
sudo adduser --disabled-password --gecos "" keynest
sudo mkdir -p /opt/keynest/releases /opt/keynest/incoming
sudo chown -R keynest:keynest /opt/keynest
sudo chmod 750 /opt/keynest
```

Tạo DNS A cho domain trỏ IP VPS. Nếu Cloudflare, dùng DNS only cho cấu hình một proxy này. Firewall của nhà cung cấp: mở cổng SSH của bạn, 80, 443; không mở 3001. Code production hiện bind 0.0.0.0:3001, nên cổng này phải bị chặn từ Internet để mọi truy cập đi qua Nginx.

Chỉ chạy một instance. Nếu VPS báo `Killed` khi cài npm, kiểm tra `free -h` và `journalctl -k` để xác nhận thiếu RAM; có thể bổ sung swap phù hợp với VPS. Swap không tăng năng lực chịu tải. Không chạy build, Kafka hoặc worker thanh toán trên cấu hình test này.

## 3. Tạo SSH key riêng cho deploy

Trên Windows PowerShell:

```powershell
ssh-keygen -t ed25519 -C "github-keynest-deploy" -f "$env:USERPROFILE\.ssh\keynest_deploy"
```

Để passphrase trống cho key tự động này. Nếu file đã tồn tại, chọn tên mới, không ghi đè key đang dùng.

```powershell
Get-Content "$env:USERPROFILE\.ssh\keynest_deploy.pub"
```

Copy duy nhất dòng public key. Trên VPS:

```bash
sudo install -d -m 700 -o keynest -g keynest /home/keynest/.ssh
sudo nano /home/keynest/.ssh/authorized_keys
```

Dán public key rồi lưu. Sau đó:

```bash
sudo chown keynest:keynest /home/keynest/.ssh/authorized_keys
sudo chmod 600 /home/keynest/.ssh/authorized_keys
sudo visudo -f /etc/sudoers.d/keynest-deploy
```

Dán đúng một dòng:

```text
keynest ALL=(root) NOPASSWD: /usr/bin/systemctl restart keynest, /usr/bin/systemctl stop keynest
```

Kiểm tra:

```bash
sudo visudo -cf /etc/sudoers.d/keynest-deploy
```

User deploy không cần sudo toàn quyền. Tuy nhiên key deploy có quyền thay code ứng dụng và đọc môi trường runtime của user đó; phải bảo vệ như secret production.

Trên Windows, thử SSH (thêm `-p PORT` nếu cổng khác 22):

```powershell
ssh -i "$env:USERPROFILE\.ssh\keynest_deploy" keynest@IP_VPS
```

## 4. Cài service và cấu hình runtime lần đầu

Trên Windows, tại MMO_WEB:

```powershell
scp deploy/keynest.service deploy/nginx.conf .env.example USER_VPS@IP_VPS:/tmp/
```

Trên VPS:

```bash
sudo install -m 644 /tmp/keynest.service /etc/systemd/system/keynest.service
sudo install -m 644 /tmp/nginx.conf /etc/nginx/sites-available/keynest
sudo install -m 600 -o keynest -g keynest /tmp/.env.example /opt/keynest/.env
sudo nano /opt/keynest/.env
```

Lệnh tạo `.env` chỉ chạy lần đầu; không ghi đè file đã điền. Chỉnh:

```dotenv
NODE_ENV=production
APP_MODE=supabase
PORT=3001
APP_ORIGIN=https://shop.example.com
TRUST_PROXY=1
SUPABASE_URL=https://PROJECT.supabase.co
SUPABASE_ANON_KEY=DIEN_GIA_TRI_THAT
SUPABASE_SERVICE_ROLE_KEY=DIEN_GIA_TRI_THAT
INVENTORY_ENCRYPTION_KEY=GIU_NGUYEN_KHOA_64_HEX_DANG_DUNG
BANK_PAYMENT_PROVIDER=tingee
TINGEE_CLIENT_ID=DIEN_CLIENT_ID_THAT
TINGEE_SECRET_TOKEN=DIEN_SECRET_TOKEN_THAT
TINGEE_BANK_BIN=DIEN_BIN_NGAN_HANG_6_CHU_SO
TINGEE_VA_ACCOUNT=DIEN_TAI_KHOAN_VA_TINGEE
TINGEE_ACCOUNT_NAME=DIEN_TEN_NGUOI_NHAN
BANK_CODE=MB
BANK_ACCOUNT_NUMBER=DIEN_SO_TAI_KHOAN
BANK_ACCOUNT_NAME=DIEN_TEN_CHU_TAI_KHOAN
PAY2S_WEBHOOK_TOKEN=DIEN_TOKEN_THAT
KAFKA_ENABLED=false
REDIS_ENABLED=false
AUTH_GOOGLE_ENABLED=true
AUTH_DISCORD_ENABLED=true
```

Chỉ bật OAuth đã cấu hình. OTP email admin bắt buộc; cấu hình SMTP và mẫu Magic Link theo `docs/ADMIN-OTP.md` trước khi deploy. Cờ cũ `ADMIN_OTP_ENABLED=false` không còn tắt được OTP. Production yêu cầu thông tin ngân hàng và token webhook đầy đủ; không dùng placeholder để nhận thanh toán. Giữ nguyên khóa mã hóa khi dùng database đã có key sản phẩm. File `.env` ở VPS không đi qua GitHub và không bị thay khi deploy.

Chạy các migration Supabase còn thiếu theo thứ tự đến 037. Không chạy lại toàn bộ trên database đã có schema. Pipeline **không tự chạy migration hosted**. Với migration 037, tạm dừng Node/payment worker và triển khai đồng bộ schema, backend, frontend theo [hướng dẫn Tingee](../deploy/tingee-payments.md). Rollback code không rollback database.

```bash
sudo systemctl daemon-reload
sudo systemctl enable keynest
sudo nano /etc/nginx/sites-available/keynest
```

Thay `shop.example.com` trong file Nginx. Bật site:

```bash
sudo ln -s /etc/nginx/sites-available/keynest /etc/nginx/sites-enabled/keynest
sudo nginx -t
sudo systemctl reload nginx
```

Chưa start service ở đây vì `current` chưa có; deploy lần đầu sẽ tạo. Site có thể trả 502 trước deploy.

## 5. Xác minh SSH host key

Trên VPS qua phiên SSH/console đáng tin:

```bash
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Trên Windows:

```powershell
ssh-keyscan -t ed25519 -p 22 IP_VPS 2>$null | Set-Content -Encoding ascii "$env:USERPROFILE\.ssh\keynest_known_hosts"
ssh-keygen -lf "$env:USERPROFILE\.ssh\keynest_known_hosts"
```

Đối chiếu fingerprint SHA256 hai bên phải giống nhau. `ssh-keyscan` một mình không xác minh danh tính server. Giữ đúng hostname/IP và port sẽ dùng trong Secrets; port khác 22 thì thay ở cả hai nơi.

## 6. Thêm GitHub Repository Secrets

Repo → **Settings → Secrets and variables → Actions → Secrets → New repository secret**:

| Tên | Giá trị |
| --- | --- |
| `VPS_HOST` | IP hoặc hostname VPS, không có `https://` |
| `VPS_PORT` | Cổng SSH, thường `22` |
| `VPS_USER` | `keynest` |
| `VPS_SSH_KEY` | Toàn bộ nội dung file `keynest_deploy` (không phải `.pub`) |
| `VPS_KNOWN_HOSTS` | Nội dung file `keynest_known_hosts` đã đối chiếu fingerprint |

Mở các file bằng editor để copy vào GitHub Secrets; không gửi private key trong chat hoặc commit vào repo. Repo private checkout dùng quyền `GITHUB_TOKEN` có sẵn của Actions, VPS không cần PAT/GitHub password/deploy key đọc repo.

## 7. Bật deploy và chạy lần đầu

Cùng trang Actions settings → **Variables → New repository variable**:

```text
VPS_DEPLOY_ENABLED = true
```

Nếu dùng liên kết mạng xã hội, thêm Variables `VITE_DISCORD_URL` và `VITE_FACEBOOK_URL`; chúng được đưa vào frontend khi build, không phải secret.

Vào **Actions → Test and deploy KEYNEST → Run workflow → main → Run workflow**.

Theo dõi hai job `check`, `deploy`. Chỉ main được deploy; pull request chỉ test/build. Không đặt self-hosted GitHub runner trên VPS 1 GB. GitHub Actions có hạn mức theo tài khoản/gói, kiểm tra Usage nếu dùng private repo thường xuyên.

Trên VPS sau job thành công:

```bash
sudo systemctl status keynest --no-pager
curl -f http://127.0.0.1:3001/api/health
curl -f http://127.0.0.1:3001/release.txt
sudo certbot --nginx -d shop.example.com
sudo certbot renew --dry-run
```

## 8. Cập nhật OAuth, webhook và kiểm tra website

Supabase → Auth → URL Configuration:

- Site URL: `https://shop.example.com`
- Redirect URLs: `https://shop.example.com/api/auth/oauth/callback` và `https://shop.example.com/reset-password`.

Tingee là cổng QR động mặc định, đối soát bằng API Credentials; không cần webhook Tingee. Pay2S tự dự phòng khi tạo QR Tingee lỗi. Giữ webhook Pay2S: `https://shop.example.com/api/webhooks/pay2s`, token trùng `.env`. Các biến `BANK_*` là tài khoản Pay2S dự phòng, có thể khác VA Tingee. Xem [cấu hình và kiểm tra Tingee](../deploy/tingee-payments.md).

Mở website HTTPS kiểm tra danh mục, đăng nhập, avatar, đặt hàng, ví và phản hồi hỗ trợ. Health check của pipeline không kiểm tra các luồng này. Kafka tắt thì xử lý thanh toán đồng bộ, không chạy worker. Redis tắt thì rate limit trong RAM của một tiến trình, reset khi restart.

## 9. Mỗi lần cập nhật

```powershell
git add .
git diff --cached --stat
git commit -m "Describe the change"
git push origin main
```

GitHub tự test/build/deploy. `.env` ở VPS được giữ nguyên. Deploy restart một tiến trình nên có gián đoạn ngắn; chưa phải zero downtime. Trước khi cài package, script dọn release cũ và bản upload dư, giữ release đang chạy làm rollback; sau khi deploy khỏe, giữ bản mới cùng rollback. Nếu `npm ci` lỗi, thư mục staging dở dang được xóa. Theo dõi `df -h`; mỗi release chiếm khoảng 135 MB.

Nếu GitHub báo lỗi:

```bash
sudo journalctl -u keynest -n 100 --no-pager
readlink -f /opt/keynest/current
free -h
df -h
```

Khôi phục bằng Git: `git revert COMMIT_LOI`, rồi push main; pipeline tạo release mới từ nội dung đã khôi phục. Nếu thay `.env` thì chạy `sudo systemctl restart keynest`; không cần build lại trừ biến `VITE_*`.

Nguồn: [GitHub Secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets), [NodeSource Node 24](https://github.com/nodesource/distributions/blob/master/scripts/deb/setup_24.x), [Nginx proxy](https://nginx.org/en/docs/http/ngx_http_proxy_module.html).
