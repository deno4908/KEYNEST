import "dotenv/config";
import { randomBytes } from "node:crypto";
import { captchaConfig } from './captcha.js';
export const config = {
  receipts: {
    enabled: process.env.ORDER_RECEIPTS_ENABLED === 'true',
    apiKey: process.env.BREVO_API_KEY || '',
    sender: process.env.ORDER_RECEIPTS_FROM || '',
  },
  captcha: captchaConfig(),
  mode: process.env.APP_MODE || "demo",
  production: process.env.NODE_ENV === "production",
  port: Number(process.env.PORT || 3001),
  origin: process.env.APP_ORIGIN || "http://127.0.0.1:5173",
  url: process.env.SUPABASE_URL,
  anon: process.env.SUPABASE_ANON_KEY,
  service: process.env.SUPABASE_SERVICE_ROLE_KEY,
  encryption: process.env.INVENTORY_ENCRYPTION_KEY,
  webhook: process.env.SEPAY_WEBHOOK_KEY,
  paymentProvider: process.env.BANK_PAYMENT_PROVIDER || "pay2s",
  pay2sWebhook: process.env.PAY2S_WEBHOOK_TOKEN || "",
  bank:
    process.env.BANK_CODE ||
    process.env.SEPAY_BANK ||
    (process.env.BANK_PAYMENT_PROVIDER === "sepay" ? "VCB" : "MB"),
  account:
    process.env.BANK_ACCOUNT_NUMBER || process.env.SEPAY_ACCOUNT_NUMBER || "",
  accountName:
    process.env.BANK_ACCOUNT_NAME || process.env.SEPAY_ACCOUNT_NAME || "",
  trustProxy: Number(process.env.TRUST_PROXY || 0),
  oauthProviders: {
    google: process.env.AUTH_GOOGLE_ENABLED === "true",
    discord: process.env.AUTH_DISCORD_ENABLED === "true",
  },
};
if (!["sepay", "pay2s"].includes(config.paymentProvider))
  throw new Error("BANK_PAYMENT_PROVIDER phải là pay2s hoặc sepay.");
if (config.receipts.enabled && (!config.receipts.apiKey || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.receipts.sender)))
  throw new Error('Email biên nhận cần BREVO_API_KEY và ORDER_RECEIPTS_FROM hợp lệ.');
if (!["demo", "supabase"].includes(config.mode))
  throw new Error("APP_MODE phải là demo hoặc supabase.");
if (config.production && config.mode === "demo")
  throw new Error("Không được chạy demo trong production.");
if (
  config.mode === "supabase" &&
  (!config.url ||
    !config.anon ||
    !config.service ||
    !/^[a-f0-9]{64}$/i.test(config.encryption || ""))
)
  throw new Error("Thiếu cấu hình Supabase / khóa mã hóa 32 byte.");
if (
  config.production &&
  (!config.origin.startsWith("https://") ||
    (config.paymentProvider === "pay2s" &&
      (!config.pay2sWebhook || !config.account || !config.accountName)) ||
    (config.paymentProvider === "sepay" &&
      (!config.webhook ||
        config.webhook.length < 32 ||
        !config.account ||
        !config.accountName)))
)
  throw new Error(
    "Production yêu cầu HTTPS, thông tin ngân hàng và token webhook của nhà cung cấp đã chọn.",
  );
// Demo key persisted by DemoStore. Never replace the production key after importing stock.
if (config.mode === "demo")
  config.encryption ||= randomBytes(32).toString("hex");
