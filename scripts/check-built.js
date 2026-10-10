// Smoke test the real built assets served by Node, including CSP and cookies.
import { chromium } from "@playwright/test";
import { existsSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
process.env.NODE_ENV = "test";
process.env.APP_MODE = "demo";
const dir = mkdtempSync(join(tmpdir(), "keynest-build-"));
process.env.DEMO_DATA_PATH = join(dir, "demo.json");
const { app } = await import("../server/index.js");
const { config } = await import("../server/config.js");
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
config.origin = base;
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(edge) ? { executablePath: edge } : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  const csp = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /content security policy/i.test(m.text()))
      csp.push(m.text());
  });
  const response = await page.goto(base, { waitUntil: "networkidle" });
  assert.ok(response.headers()["content-security-policy"]);
  assert.equal(await page.locator(".product-card").count(), 12);
  await page.locator(".account-button").click();
  await page.waitForLoadState("networkidle");
  assert.ok(await page.locator(".auth-dialog").isVisible());
  await page.keyboard.press("Escape");
  const login = await page.request.post(base + "/api/auth/login", {
    headers: { Origin: base, "X-App-Request": "keynest" },
    data: { email: "student@keynest.local", password: "Student123!" },
  });
  assert.equal(login.status(), 200);
  const cookies = await page.context().cookies();
  assert.ok(cookies.find((c) => c.name === "kn_session")?.httpOnly);
  const products = await (
    await page.request.get(base + "/api/products")
  ).json();
  const purchase = await page.request.post(base + "/api/orders", {
    headers: {
      Origin: base,
      "X-App-Request": "keynest",
      "Idempotency-Key": randomUUID(),
    },
    data: {
      items: [
        {
          variant_id: products.find((p) => p.slug === "hollow-knight")
            .variants[0].id,
          quantity: 1,
        },
      ],
      method: "wallet",
    },
  });
  assert.equal(purchase.status(), 201);
  const order = await purchase.json();
  await page.evaluate(
    (id) =>
      localStorage.setItem(
        "kn-cart",
        JSON.stringify([{ variant_id: id, quantity: 1 }]),
      ),
    products.find((p) => p.slug === "hollow-knight").variants[0].id,
  );
  mkdirSync(".data/qa", { recursive: true });
  for (const route of [
    "/catalog?category=mmo",
    "/products/steam-wallet",
    "/cart",
    "/wallet",
    "/orders",
    `/orders/${order.id}`,
    "/account",
    "/support",
    "/promotions",
    "/guide",
  ]) {
    await page.goto(base + route, { waitUntil: "networkidle" });
    if (route === `/orders/${order.id}`) {
      assert.equal(await page.locator(".delivered-key code").count(), 1);
      assert.ok(await page.locator(".warranty-section").isVisible());
    }
    assert.equal(await page.locator(".form-error").count(), 0, route);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        route + " overflows " + width,
      );
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (route === "/cart" || route === "/wallet")
      await page.screenshot({
        path: ".data/qa/" + route.slice(1) + "-desktop.png",
        fullPage: true,
      });
  }
  await page.request.post(base + "/api/auth/login", {
    headers: { Origin: base, "X-App-Request": "keynest" },
    data: { email: "admin@keynest.local", password: "Admin123!" },
  });
  await page.goto(base + "/admin", { waitUntil: "networkidle" });
  assert.ok(await page.locator(".admin-nav").isVisible());
  await page.screenshot({ path: ".data/qa/admin-desktop.png", fullPage: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(csp, []);
  console.log(
    "Built app passed: 11 routes, responsive widths, Node CSP, HttpOnly login, delivered key and warranty, no JS/CSP errors.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  assert.ok(
    resolve(dir).startsWith(resolve(tmpdir()) + sep + "keynest-build-"),
  );
  rmSync(dir, { recursive: true, force: true });
}
