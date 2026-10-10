import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
  createHash,
} from "node:crypto";
export const opaque = () => randomBytes(32).toString("hex");
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export function safeEqual(a, b) {
  const x = Buffer.from(a || ""),
    y = Buffer.from(b || "");
  return x.length === y.length && timingSafeEqual(x, y);
}
export function hashPassword(value) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(value, salt, 64).toString("hex")}`;
}
export function verifyPassword(value, hash) {
  const [salt, key] = hash.split(":");
  return safeEqual(scryptSync(value, salt, 64).toString("hex"), key);
}
export function encrypt(value, key) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  return [
    iv.toString("hex"),
    c.update(value, "utf8", "hex") + c.final("hex"),
    c.getAuthTag().toString("hex"),
  ].join(":");
}
export function decrypt(value, key) {
  const [iv, text, tag] = value.split(":");
  const d = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    Buffer.from(iv, "hex"),
  );
  d.setAuthTag(Buffer.from(tag, "hex"));
  return d.update(text, "hex", "utf8") + d.final("utf8");
}
export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export function requireOrigin(origin, allowed, appHeader) {
  if (origin !== allowed || appHeader !== "keynest")
    throw new AppError("Yêu cầu không hợp lệ (CSRF).", 403);
}
export function webhookCode(body) {
  const found = `${body.code || ""} ${body.content || ""}`
    .toUpperCase()
    .match(/\bKN[A-F0-9]{16}\b/g);
  const unique = [...new Set(found || [])];
  if (unique.length !== 1)
    throw new AppError("Nội dung chuyển khoản không xác định.", 422);
  return unique[0];
}
