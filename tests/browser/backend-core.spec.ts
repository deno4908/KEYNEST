import { accountLegal } from '../helpers/legal.js';
import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  expect((await (await request.get("/api/health")).json()).mode).toBe("demo");
});

test("catalog uses backend search and recovers from a failed request", async ({
  page,
}) => {
  await page.route(
    "**/api/catalog?**",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Không thể tải danh mục." }),
      }),
    { times: 1 },
  );
  await page.goto("/catalog?category=mmo");
  await expect(page.getByRole("alert")).toContainText(
    "Không thể tải danh mục.",
  );
  await page.getByRole("button", { name: "Thử lại", exact: true }).click();
  await expect(page.locator(".product-card")).toHaveCount(2);
  const response = page.waitForResponse(
    (r) =>
      r.url().includes("/api/catalog?") &&
      r.url().includes("q=IPv4") &&
      r.status() === 200,
  );
  await page.getByRole("textbox", { name: "Lọc sản phẩm" }).fill("IPv4");
  expect((await (await response).json()).total).toBe(1);
  await expect(page.locator(".product-card")).toHaveCount(1);
  await expect(page.locator(".product-card")).toContainText(
    "Private IPv4 Proxy",
  );
});

test("account password form validates confirmation and keeps the updated session usable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const email = `password-${Date.now()}@example.test`;
  const headers = {
    Origin: "http://127.0.0.1:5173",
    "X-App-Request": "keynest",
  };
  const registered = await page.request.post("/api/auth/register", {
    headers,
    data: { legal: accountLegal,
      email,
      password: "OriginalPassword123!",
      name: "Password Test",
    },
  });
  expect(registered.ok()).toBe(true);
  await page.goto("/account?section=security");
  await page
    .getByLabel("Mật khẩu hiện tại", { exact: true })
    .fill("OriginalPassword123!");
  await page
    .getByLabel("Mật khẩu mới", { exact: true })
    .fill("ChangedPassword123!");
  await page
    .getByLabel("Nhập lại mật khẩu mới", { exact: true })
    .fill("MismatchPassword123!");
  await page
    .getByRole("button", { name: "Cập nhật mật khẩu", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Mật khẩu nhập lại chưa khớp.",
  );
  await page
    .getByLabel("Nhập lại mật khẩu mới", { exact: true })
    .fill("ChangedPassword123!");
  await page
    .getByRole("button", { name: "Cập nhật mật khẩu", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Đã cập nhật mật khẩu.");
  expect((await page.request.get("/api/me")).ok()).toBe(true);
  expect(
    (
      await page.request.post("/api/auth/login", {
        headers,
        data: { email, password: "OriginalPassword123!" },
      })
    ).status(),
  ).toBe(401);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
  }
  expect(errors).toEqual([]);
});
