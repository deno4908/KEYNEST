import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (existsSync(".env")) {
  console.log("Đã có .env; giữ nguyên cấu hình và khóa mã hóa hiện tại.");
} else {
  const template = readFileSync(".env.example", "utf8").replace(
    /^INVENTORY_ENCRYPTION_KEY=.*$/m,
    `INVENTORY_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`,
  );
  writeFileSync(".env", template, { flag: "wx", mode: 0o600 });
  console.log(
    "Đã tạo .env ở chế độ demo, chọn Pay2S và sinh khóa kho. Điền thông tin theo docs/PAY2S-SETUP.md.",
  );
}
