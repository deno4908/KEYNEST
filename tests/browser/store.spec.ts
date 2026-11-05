import { test, expect } from "@playwright/test";
test.beforeEach(async ({ request }) => {
  const response = await request.get("/api/health");
  expect(
    (await response.json()).mode,
    "Browser tests may write only to demo mode",
  ).toBe("demo");
});

test("storefront renders all categories on desktop and mobile without overflow", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator(".product-card")).toHaveCount(12);
  await expect(
    page.getByRole("heading", { name: "Sản phẩm nổi bật" }),
  ).toBeVisible();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 950 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
  }
  await page.goto("/catalog?category=mmo");
  await expect(page.locator(".product-card")).toHaveCount(2);
  await page.getByRole("textbox", { name: "Lọc sản phẩm" }).fill("IPv4");
  await expect(page.locator(".product-card")).toHaveCount(1);
  await page.goto("/products/steam-wallet");
  await expect(page.locator(".variants button")).toHaveCount(3);
  await page.locator(".variants button").nth(1).click();
  await expect(page.locator(".detail-price")).toContainText("208.000");
  expect(errors).toEqual([]);
});

test("customer can register, top up, buy a key and submit a support request", async ({
  page,
  request,
}) => {
  const email = `browser-${Date.now()}@example.test`;
  await page.goto("/");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  const dialog = page.locator(".auth-dialog");
  await dialog.getByRole("button", { name: "Đăng ký", exact: true }).click();
  await dialog.getByLabel("Tên của bạn").fill("Browser Customer");
  await dialog.getByRole('checkbox').nth(0).check();
  await dialog.getByRole('checkbox').nth(1).check();
  await dialog.getByLabel("Email", { exact: true }).fill(email);
  await dialog
    .getByLabel("Mật khẩu", { exact: true })
    .fill("BrowserPassword123!");
  await dialog
    .getByLabel("Nhập lại mật khẩu", { exact: true })
    .fill("BrowserPassword123!");
  await dialog
    .getByRole("button", { name: "Tạo tài khoản", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const welcome = page.locator('.oauth-welcome');
  await welcome.getByRole('button', {name:/Tiếp tục vào cửa hàng/}).click();
  await expect(welcome).not.toBeVisible();
  await page.goto("/wallet");
  await page.getByRole("button", { name: "200.000", exact: false }).click();
  await page.getByRole("button", { name: "Tạo mã nạp tiền" }).click();
  await page
    .getByRole("button", { name: "Mô phỏng thanh toán thành công" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Đã nhận thanh toán." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Hoàn tất", exact: true }).click();
  await expect(page.locator(".wallet-card")).toContainText("200.000");
  await page.goto("/products/hollow-knight");
  await page.getByRole("button", { name: "Thêm vào giỏ" }).click();
  await expect(page.getByRole('status').filter({hasText:'Đã thêm vào giỏ hàng.'})).toBeVisible();
  await page.goto("/cart");
  await expect(page.locator(".cart-item")).toHaveCount(1);
  await page.getByRole("textbox", { name: "Mã giảm giá" }).fill("WELCOME10");
  await page.getByRole('checkbox', { name: /Tôi đã kiểm tra sản phẩm/ }).check();
  await page.getByRole("button", { name: "Đặt hàng & thanh toán" }).click();
  await expect(page).toHaveURL(/\/orders$/);
  await expect(page.locator(".purchase-card").first()).toContainText(
    "Hoàn thành",
  );
  await expect(page.locator(".purchase-cover img").first()).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({
    path: ".data/qa/orders-desktop.png",
    fullPage: true,
  });
  await page
    .locator(".purchase-card")
    .first()
    .getByRole("link", { name: "Xem key" })
    .click();
  await expect(page).toHaveURL(/\/orders\/[a-f0-9-]+$/);
  const deliveredOrder = await (
    await page.request.get(`/api${new URL(page.url()).pathname}`)
  ).json();
  expect(deliveredOrder.items[0].product_slug).toBe("hollow-knight");
  expect(deliveredOrder.items[0].keys).toHaveLength(1);
  expect(deliveredOrder.items[0].keys[0].length).toBeGreaterThan(0);
  await expect(page.locator(".delivered-key code")).toHaveText(
    deliveredOrder.items[0].keys,
  );
  await expect(page.locator(".warranty-state")).toContainText(
    "Bảo hành 30 ngày",
  );
  await page.getByRole("button", { name: /Sao chép mã 1/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Đã sao chép mã" }),
  ).toHaveCount(1);
  await page.screenshot({
    path: ".data/qa/order-detail-desktop.png",
    fullPage: true,
  });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    if (width === 390)
      await page.screenshot({
        path: ".data/qa/order-detail-mobile.png",
        fullPage: true,
      });
  }
  await page
    .getByLabel("Mô tả vấn đề")
    .fill("Mã báo đã sử dụng khi kích hoạt trên Steam, nhờ cửa hàng kiểm tra.");
  await page.getByRole("button", { name: "Gửi yêu cầu bảo hành" }).click();
  await expect(page.locator(".warranty-pending")).toBeVisible();
  await expect(page.locator(".warranty-history article")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".warranty-history article")).toHaveCount(1);
  const detail = await (
    await page.request.get(`/api${new URL(page.url()).pathname}`)
  ).json();
  const headers = {
    Origin: "http://127.0.0.1:5173",
    "X-App-Request": "keynest",
  };
  const adminLogin = await request.post("/api/auth/login", {
    headers,
    data: { email: "admin@keynest.local", password: "Admin123!" },
  });
  expect(adminLogin.ok()).toBe(true);
  const reply = await request.post(
    `/api/admin/tickets/${detail.warranty_requests[0].id}/reply`,
    {
      headers,
      data: { reply: "Cửa hàng đã kiểm tra và hướng dẫn kích hoạt lại." },
    },
  );
  expect(reply.ok()).toBe(true);
  await page.reload();
  await expect(page.locator(".warranty-reply")).toContainText(
    "hướng dẫn kích hoạt lại",
  );
  await page.goto("/support");
  await page
    .getByLabel("Tiêu đề", { exact: true })
    .fill("Browser support check");
  await page
    .getByLabel("Nội dung", { exact: true })
    .fill("Kiểm tra gửi yêu cầu hỗ trợ đơn hàng.");
  await page.getByRole("button", { name: "Gửi yêu cầu", exact: true }).click();
  await expect(
    page
      .locator(".support-ticket")
      .filter({ hasText: "Browser support check" }),
  ).toContainText("Browser support check");
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Browser Customer", exact: true }),
  ).toBeVisible();
});

test("admin can edit catalog, import stock and manage discount codes", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Quản trị viên", exact: true })
    .click();
  await dialog
    .locator("form")
    .getByRole("button", { name: "Đăng nhập", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Quản trị cửa hàng." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Sản phẩm & kho", exact: true })
    .click();
  await page
    .locator("tr")
    .filter({ hasText: "Hollow Knight" })
    .getByRole("button", { name: "Quản lý" })
    .click();
  await page.getByRole("button", { name: "Sửa gói" }).click();
  const warrantyField = page.getByLabel("Bảo hành (ngày)");
  const originalWarranty = await warrantyField.inputValue();
  await warrantyField.fill("45");
  await page.getByRole("button", { name: "Lưu gói", exact: true }).click();
  await expect(page.locator(".admin-variant")).toContainText(
    "Bảo hành 45 ngày",
  );
  await page.getByRole("button", { name: "Sửa gói" }).click();
  await expect(warrantyField).toHaveValue("45");
  await warrantyField.fill(originalWarranty);
  await page.getByRole("button", { name: "Lưu gói", exact: true }).click();
  await expect(warrantyField).not.toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Nhập mã" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("textbox")
    .fill(`UI-TEST-KEY-${Date.now()}`);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Xác nhận", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Mã giảm giá", exact: true }).click();
  await page.getByRole("button", { name: "Thêm mã", exact: true }).click();
  await page.getByLabel("Mã", { exact: true }).fill(`BROWSER${Date.now()}`);
  await page.getByLabel("Phần trăm giảm").fill("5");
  await page.getByRole("button", { name: "Lưu mã giảm giá" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator("table")).toContainText("BROWSER");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 950 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
  }
});
