import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  encrypt,
  decrypt,
  hashPassword,
  verifyPassword,
  requireOrigin,
  safeEqual,
  webhookCode,
} from "../server/security.js";
test("AES-GCM protects delivery secrets and detects tampering", () => {
  const key = randomBytes(32).toString("hex");
  const text = "host:1080:user:secret";
  const a = encrypt(text, key),
    b = encrypt(text, key);
  assert.notEqual(a, b);
  assert.equal(decrypt(a, key), text);
  const segments = a.split(":");
  segments[1] = (segments[1][0] === "a" ? "b" : "a") + segments[1].slice(1);
  assert.throws(() => decrypt(segments.join(":"), key));
  assert.throws(() => decrypt(a, randomBytes(32).toString("hex")));
});
test("passwords use salted scrypt, never plaintext", () => {
  const a = hashPassword("MyPassword123!");
  const b = hashPassword("MyPassword123!");
  assert.notEqual(a, b);
  assert.ok(verifyPassword("MyPassword123!", a));
  assert.equal(verifyPassword("Wrong123!", a), false);
});
test("CSRF rejects foreign, missing and simple browser requests", () => {
  assert.throws(() =>
    requireOrigin("https://evil.test", "https://shop.test", "keynest"),
  );
  assert.throws(() => requireOrigin(undefined, "https://shop.test", "keynest"));
  assert.throws(() =>
    requireOrigin("https://shop.test", "https://shop.test", undefined),
  );
  assert.doesNotThrow(() =>
    requireOrigin("https://shop.test", "https://shop.test", "keynest"),
  );
});
test("webhook requires exactly one unambiguous code", () => {
  assert.equal(
    webhookCode({
      code: "KN0123456789ABCDEF",
      content: "kn0123456789abcdef payment",
    }),
    "KN0123456789ABCDEF",
  );
  assert.throws(() =>
    webhookCode({ content: "KN0123456789ABCDEF KNFFFFFFFFFFFFFFFF" }),
  );
  assert.throws(() => webhookCode({ content: "someone says paid" }));
  assert.equal(safeEqual("Apikey good", "Apikey bad"), false);
});
