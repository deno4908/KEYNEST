import "dotenv/config";
const required = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "INVENTORY_ENCRYPTION_KEY",
  "BANK_ACCOUNT_NUMBER",
  "BANK_ACCOUNT_NAME",
  "PAY2S_WEBHOOK_TOKEN",
];
let missing = false;
for (const name of required) {
  const present = Boolean(process.env[name]?.trim());
  console.log(`${present ? "OK" : "THIEU"} ${name}`);
  if (!present) missing = true;
}
const valid = (name, result) => {
  console.log(`${result ? "OK" : "KIEM TRA"} ${name}`);
  if (!result) missing = true;
};
valid("APP_MODE=supabase", process.env.APP_MODE === "supabase");
valid(
  "BANK_PAYMENT_PROVIDER=pay2s",
  process.env.BANK_PAYMENT_PROVIDER === "pay2s",
);
valid(
  "BANK_CODE=MB",
  ["MB", "MBBANK", "970422"].includes(process.env.BANK_CODE?.toUpperCase()),
);
valid(
  "INVENTORY_ENCRYPTION_KEY (64 hex)",
  /^[a-f0-9]{64}$/i.test(process.env.INVENTORY_ENCRYPTION_KEY || ""),
);
valid(
  "APP_ORIGIN (HTTPS, khong co path)",
  (() => {
    try {
      const u = new URL(process.env.APP_ORIGIN);
      return u.protocol === "https:" && u.origin === process.env.APP_ORIGIN;
    } catch {
      return false;
    }
  })(),
);
valid(
  "PAY2S_WEBHOOK_TOKEN (khong gom Bearer)",
  Boolean(
    process.env.PAY2S_WEBHOOK_TOKEN &&
    !/\s/.test(process.env.PAY2S_WEBHOOK_TOKEN),
  ),
);
console.log(
  "Chỉ kiểm tra cấu hình; không gọi Pay2S/Supabase, không xác nhận token hợp lệ và không in secret.",
);
process.exitCode = missing ? 1 : 0;
