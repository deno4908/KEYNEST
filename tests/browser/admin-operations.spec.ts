import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("admin uploads images, configures a fixed single-use coupon and resolves warranty through the support inbox", async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(15000);
  expect((await (await request.get("/api/health")).json()).mode).toBe("demo");
  const headers = {
    Origin: "http://127.0.0.1:5173",
    "X-App-Request": "keynest",
  };
  const suffix = Date.now().toString();
  const email = `operations-${suffix}@example.test`;
  expect(
    (
      await request.post("/api/auth/register", {
        headers,
        data: {
          email,
          name: "Khách kiểm tra quản trị",
          password: "CustomerPassword123!",
        },
      })
    ).ok(),
  ).toBe(true);
  const payment = await (
    await request.post("/api/wallet/topup", {
      headers,
      data: { amount: 200000 },
    })
  ).json();
  expect(
    (
      await request.post(`/api/demo/pay/${payment.id}`, { headers, data: {} })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.post("/api/auth/login", {
        headers,
        data: { email: "admin@keynest.local", password: "Admin123!" },
      })
    ).ok(),
  ).toBe(true);
  const productName = `Ảnh thử quản trị ${suffix}`;
  const created = await page.request.post("/api/admin/products", {
    headers,
    data: {
      slug: `qa-upload-${suffix}`,
      name: productName,
      category: "game",
      platform: "Steam",
      subcategory: "",
      subtitle: "",
      description: "",
      image: "",
      featured: false,
      active: false,
    },
  });
  expect(created.ok()).toBe(true);
  await page.goto("/admin");
  await page
    .getByRole("button", { name: "Sản phẩm & kho", exact: true })
    .click();
  await page
    .locator("tr")
    .filter({ hasText: productName })
    .getByRole("button", { name: "Quản lý" })
    .click();
  await page
    .getByLabel("Tải ảnh sản phẩm từ thiết bị")
    .setInputFiles("public/images/products/steam-wallet.png");
  await expect(
    page.getByRole("dialog").locator('input[name="image"]'),
  ).toHaveValue(/^\/api\/media\/[a-f0-9-]+\.webp$/);
  await page
    .getByRole("button", { name: "Lưu sản phẩm", exact: false })
    .click();
  await expect(
    page.getByRole("button", { name: "Lưu sản phẩm", exact: false }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Hoàn tất quản lý" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const data = await (await page.request.get("/api/admin/overview")).json();
  const uploaded = data.products.find(
    (p: { name: string }) => p.name === productName,
  ).image;
  expect((await page.request.get(uploaded)).headers()["content-type"]).toBe(
    "image/webp",
  );
  await page.getByRole("button", { name: "Mã giảm giá", exact: true }).click();
  await page.getByRole("button", { name: "Thêm mã", exact: true }).click();
  const code = `QA${suffix}`;
  await page.getByLabel("Mã", { exact: true }).fill(code);
  await page.getByLabel("Loại giảm giá").selectOption("fixed");
  await page.getByLabel("Số tiền giảm (VND)", { exact: true }).fill("15000");
  await page.getByLabel("Đơn tối thiểu (VND)").fill("50000");
  await page.getByRole("button", { name: "Một lượt duy nhất" }).click();
  await expect(page.getByLabel("Tổng lượt toàn cửa hàng")).toHaveValue("1");
  await expect(page.getByLabel("Lượt tối đa mỗi tài khoản")).toHaveValue("1");
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({
    path: ".data/qa/admin-coupon-editor.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Lưu mã giảm giá" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByLabel("Tìm mã giảm giá").fill(code);
  await expect(page.locator(".admin-coupon-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".admin-coupon-table tbody")).toContainText(
    "15.000",
  );

  const customerContext = await browser.newContext({
    storageState: await request.storageState(),
    viewport: { width: 1440, height: 1000 },
  });
  try {
    const customer = await customerContext.newPage();
    await customer.goto("http://127.0.0.1:5173/products/hollow-knight");
    await customer.getByRole("button", { name: "Thêm vào giỏ" }).click();
    await expect(customer.getByRole('status').filter({hasText:'Đã thêm vào giỏ hàng.'})).toBeVisible();
    await customer.goto("http://127.0.0.1:5173/cart");
    await customer.getByRole("textbox", { name: "Mã giảm giá" }).fill(code);
    await expect(customer.getByRole("status")).toContainText("Đã áp dụng mã");
    await expect(customer.locator(".summary-total")).toContainText("84.000");
    await customer
      .getByRole("button", { name: "Đặt hàng & thanh toán" })
      .click();
    await expect(customer).toHaveURL(/\/orders$/);
    await customer.getByRole("link", { name: "Xem key" }).click();
    await customer
      .getByLabel("Mô tả vấn đề")
      .fill("Mã báo đã sử dụng khi kích hoạt, nhờ cửa hàng kiểm tra giúp.");
    await customer
      .getByRole("button", { name: "Gửi yêu cầu bảo hành" })
      .click();
    await expect(customer.locator(".warranty-pending")).toBeVisible();
    const order = await (
      await customer.request.get(`/api${new URL(customer.url()).pathname}`)
    ).json();
    await page.goto("/admin");
    await page.getByRole("button", { name: /^Đơn hàng/ }).click();
    await page.getByLabel("Tìm đơn quản trị").fill(order.number);
    await page.getByRole("button", { name: "Chi tiết", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(email);
    await expect(dialog).toContainText("Hollow Knight");
    await expect
      .poll(() =>
        dialog
          .locator(".purchase-cover img")
          .evaluateAll((images) =>
            images.every(
              (i) =>
                (i as HTMLImageElement).complete &&
                (i as HTMLImageElement).naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
    await page.screenshot({
      path: ".data/qa/admin-order-detail.png",
      fullPage: true,
    });
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1050 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      await expect
        .poll(() =>
          dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        )
        .toBe(true);
    }
    await dialog
      .getByRole("button", { name: new RegExp(`Bảo hành đơn ${order.number}`) })
      .click();
    await expect(page.locator(".support-dialog")).toBeVisible();
    await expect(page.locator(".support-context")).toContainText(
      "Mã cần kiểm tra: 1",
    );
    await page
      .getByLabel("Nội dung phản hồi", { exact: true })
      .fill("Cửa hàng đã nhận thông tin và đang kiểm tra mã đã giao.");
    await page
      .getByLabel("Trạng thái sau phản hồi")
      .selectOption("in_progress");
    await page.getByLabel("Mức ưu tiên").selectOption("high");
    await page
      .getByRole("button", { name: "Gửi phản hồi", exact: true })
      .click();
    await expect(page.locator(".thread-message")).toHaveCount(2);
    await page.screenshot({
      path: ".data/qa/admin-support-dialog.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 950 });
    await expect
      .poll(() =>
        page
          .getByRole("dialog")
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      )
      .toBe(true);
    await page.screenshot({
      path: ".data/qa/admin-support-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.getByRole("button", { name: "Đóng", exact: true }).click();
    await page
      .getByRole("button", { name: "Hỗ trợ khách hàng", exact: true })
      .click();
    await page.getByLabel("Tìm yêu cầu hỗ trợ").fill(order.number);
    await page.screenshot({
      path: ".data/qa/admin-support-inbox.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Phản hồi", exact: true }).click();
    await page
      .getByRole("button", { name: "Xem đơn & xử lý bảo hành" })
      .click();
    await page
      .getByRole("button", { name: "Xử lý hoàn tiền", exact: true })
      .click();
    await page.getByLabel("Phương thức hoàn").selectOption("external");
    await page
      .getByLabel("Mã giao dịch đã hoàn")
      .fill(`DEMO-REF-${randomUUID()}`);
    await page
      .getByLabel("Lý do hoàn tiền")
      .fill("Đã kiểm tra mã không sử dụng được, xác nhận khoản hoàn mô phỏng.");
    await page
      .getByRole("checkbox", { name: /Tôi xác nhận đã chuyển trả/ })
      .check();
    const before = (await (await customer.request.get("/api/me")).json())
      .balance;
    await page
      .getByRole("button", { name: "Xác nhận đã hoàn bên ngoài", exact: true })
      .click();
    await expect(page.locator(".refund-receipt")).toContainText(
      "bên ngoài hệ thống",
    );
    expect((await (await customer.request.get("/api/me")).json()).balance).toBe(
      before,
    );
    await customer.reload();
    await expect(customer.locator(".order-stopped")).toContainText(
      "hoàn tiền bên ngoài",
    );
    await expect(customer.locator(".delivered-key code")).toHaveCount(0);
  } finally {
    await customerContext.close().catch(() => {});
  }
});
