import { test, expect } from "@playwright/test";
test("seller onboarding, product editor, contact and withdrawal screens", async ({
  page,
  playwright,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await expect
    .poll(
      async () => {
        try {
          return (await page.request.get("/api/health")).status();
        } catch {
          return 0;
        }
      },
      { timeout: 20000 },
    )
    .toBe(200);
  const admin = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:5173",
    extraHTTPHeaders: {
      Origin: "http://127.0.0.1:5173",
      "X-App-Request": "keynest",
    },
  });
  const login = await admin.post("/api/auth/login", {
    data: { email: "admin@keynest.local", password: "Admin123!" },
  });
  expect(login.ok()).toBeTruthy();
  const suffix = Date.now(),
    email = `seller-ui-${suffix}@example.test`;
  const register = await page.request.post("/api/auth/register", {
    headers: { Origin: "http://127.0.0.1:5173", "X-App-Request": "keynest" },
    data: { email, password: "Seller123!", name: `Seller UI ${suffix}` },
  });
  expect(register.ok()).toBeTruthy();
  const customers = await (
    await admin.get(`/api/admin/customers?q=${email}`)
  ).json();
  expect(
    (
      await admin.post("/api/admin/sellers/role", {
        data: { user_id: customers.items[0].id, role: "seller" },
      })
    ).ok(),
  ).toBeTruthy();
  await page.context().clearCookies();
  await page.goto("/");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Email", { exact: true }).fill(email);
  await dialog.getByLabel("Mật khẩu", { exact: true }).fill("Seller123!");
  await dialog
    .locator("form")
    .getByRole("button", { name: "Đăng nhập", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Thiết lập gian hàng của bạn" }),
  ).toBeVisible();
  await page
    .getByLabel("Trang mạng xã hội liên hệ")
    .fill("https://facebook.com/seller-ui");
  await page.getByRole("checkbox", { name: /Tôi đã đọc/ }).check();
  await page.getByRole("button", { name: "Đồng ý và lưu hồ sơ" }).click();
  await expect(
    page.getByRole("heading", { name: "Thiết lập gian hàng của bạn" }),
  ).not.toBeVisible();
  await page.goto("/seller");
  await expect(
    page.getByRole("heading", { name: "Gian hàng của bạn." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Thêm sản phẩm", exact: true })
    .click();
  await dialog
    .getByLabel("Tên sản phẩm", { exact: true })
    .fill(`Seller Product ${suffix}`);
  await dialog
    .getByLabel("Slug", { exact: true })
    .fill(`seller-product-${suffix}`);
  await dialog
    .getByRole("button", { name: "Lưu sản phẩm", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Thêm gói", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Thêm gói", exact: true }).click();
  await dialog.locator('.variant-form input[name="name"]').fill("Standard");
  await dialog
    .locator('.variant-form select[name="delivery"]')
    .selectOption("manual");
  await dialog.locator('.variant-form input[name="stock"]').fill("10");
  await dialog
    .locator(
      '.variant-form button[type="submit"], .variant-form button:not([type])',
    )
    .last()
    .click();
  await expect(dialog.locator(".admin-variant")).toContainText("Standard");
  await page.keyboard.press("Escape");
  await expect(page.locator(".seller-product-list")).toContainText(
    `Seller Product ${suffix}`,
  );
  await page.goto(`/products/seller-product-${suffix}`);
  await expect(page.locator(".seller-contact")).toContainText(
    `Seller UI ${suffix}`,
  );
  await expect(page.locator(".seller-notice")).toContainText(
    "Người bán chịu trách nhiệm",
  );
  await page.goto("/seller");
  await page.getByRole("button", { name: "Rút tiền", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Gửi yêu cầu rút" }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/seller-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
  await admin.dispose();
});
