import "dotenv/config";
const provider=process.env.BANK_PAYMENT_PROVIDER || 'tingee';
const required = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "INVENTORY_ENCRYPTION_KEY",
  "BANK_ACCOUNT_NUMBER",
  "BANK_ACCOUNT_NAME",
  ...(provider==='sepay' ? ['SEPAY_WEBHOOK_KEY'] : ['PAY2S_WEBHOOK_TOKEN']),
  ...(provider==='tingee' ? ['TINGEE_CLIENT_ID','TINGEE_SECRET_TOKEN','TINGEE_BANK_BIN','TINGEE_VA_ACCOUNT','TINGEE_ACCOUNT_NAME'] : []),
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
if (provider === 'tingee') valid('TINGEE_BANK_BIN (6 chu so)', /^\d{6}$/.test(process.env.TINGEE_BANK_BIN || ''));
valid(
  "BANK_PAYMENT_PROVIDER (tingee/pay2s/sepay)",
  ['tingee','pay2s','sepay'].includes(provider),
);
valid(
  "BANK_CODE (ngan hang Pay2S du phong)",
  !!process.env.BANK_CODE,
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
if(provider!=='sepay') valid(
  "PAY2S_WEBHOOK_TOKEN (khong gom Bearer)",
  Boolean(
    process.env.PAY2S_WEBHOOK_TOKEN &&
    !/\s/.test(process.env.PAY2S_WEBHOOK_TOKEN),
  ),
);
console.log(
  "Chỉ kiểm tra cấu hình; không gọi Tingee/Pay2S/Supabase, không xác nhận credentials hợp lệ và không in secret.",
);
process.exitCode = missing ? 1 : 0;
