import { accountLegal } from '../helpers/legal.js';
import { test, expect } from "@playwright/test";

const headers = { Origin: "http://127.0.0.1:5173", "X-App-Request": "keynest" };

test.beforeEach(async ({ request }) => {
  await expect.poll(async () => {
    try {
      const response = await request.get("/api/health");
      return response.ok() ? (await response.json()).mode : null;
    } catch { return null; }
  }, { timeout: 30000 }).toBe("demo");
});

test("checkout waits for queued cart saves and consumes the account cart without a second clear request", async ({ page }) => {
  await page.goto("/");
  const registered = await page.request.post("/api/auth/register", {
    headers,
    data: { legal: accountLegal, email: `cart-checkout-${Date.now()}@example.test`, name: `Cart Buyer ${Date.now()}`, password: "CartBuyer123!" },
  });
  expect(registered.ok()).toBeTruthy();
  const { user } = await registered.json();
  const products = await (await page.request.get("/api/products")).json();
  const product = products.find((p: { slug: string }) => p.slug === "hollow-knight");
  const topup = await (await page.request.post("/api/wallet/topup", { headers, data: { amount: 1000000 } })).json();
  expect((await page.request.post(`/api/demo/pay/${topup.id}`, { headers })).ok()).toBeTruthy();
  expect((await page.request.put("/api/cart", {
    headers, data: { user_id: user.id, items: [{ variant_id: product.variants[0].id, quantity: 1 }] },
  })).ok()).toBeTruthy();

  let saved = false;
  let orderBeforeSave = false;
  let clearRequests = 0;
  await page.route("**/api/cart", async route => {
    if (route.request().method() !== "PUT") return route.continue();
    if (!route.request().postDataJSON().items.length) {
      clearRequests++;
      return route.abort();
    }
    await new Promise(resolve => setTimeout(resolve, 600));
    const response = await route.fetch();
    saved = true;
    await route.fulfill({ response });
  });
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/orders") orderBeforeSave = !saved;
  });
  await page.goto("/cart");
  await expect(page.locator(".cart-item")).toHaveCount(1);
  await page.getByRole("button", { name: "Tăng", exact: true }).click();
  await page.getByRole('checkbox', { name: /Tôi đã kiểm tra sản phẩm/ }).check();
  await page.getByRole("button", { name: "Đặt hàng & thanh toán", exact: true }).click();
  await expect(page).toHaveURL(/\/orders$/);
  expect(orderBeforeSave).toBe(false);
  expect(saved).toBe(true);
  expect(clearRequests).toBe(0);
  expect((await (await page.request.get("/api/cart")).json()).items).toEqual([]);
  const orders = await (await page.request.get("/api/orders")).json();
  expect(orders).toHaveLength(1);
  expect(orders[0].items[0].quantity).toBe(2);
  await page.getByRole("link", { name: "Giỏ hàng 0 sản phẩm", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Giỏ hàng còn trống" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Giỏ hàng còn trống" })).toBeVisible();
});

test("failed checkout keeps saved cart items", async ({ page }) => {
  await page.goto("/");
  const registered = await page.request.post("/api/auth/register", {
    headers,
    data: { legal: accountLegal, email: `cart-no-balance-${Date.now()}@example.test`, name: `Cart Empty Wallet ${Date.now()}`, password: "CartBuyer123!" },
  });
  expect(registered.ok()).toBeTruthy();
  const { user } = await registered.json();
  const products = await (await page.request.get("/api/products")).json();
  const product = products.find((p: { slug: string }) => p.slug === "hollow-knight");
  const items = [{ variant_id: product.variants[0].id, quantity: 1 }];
  expect((await page.request.put("/api/cart", { headers, data: { user_id: user.id, items } })).ok()).toBeTruthy();
  await page.goto("/cart");
  await expect(page.locator(".cart-item")).toHaveCount(1);
  const response = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/orders");
  await page.getByRole('checkbox', { name: /Tôi đã kiểm tra sản phẩm/ }).check();
  await page.getByRole("button", { name: "Đặt hàng & thanh toán", exact: true }).click();
  expect((await response).status()).toBe(409);
  await expect(page.locator(".cart-item")).toHaveCount(1);
  expect((await (await page.request.get("/api/cart")).json()).items).toEqual(items);
});
