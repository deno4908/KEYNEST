import { test, expect } from "@playwright/test";

test("admin creates a preorder without keys and buyer pays with a visible delivery estimate", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  expect((await (await page.request.get("/api/health")).json()).mode).toBe(
    "demo",
  );
  const headers = {
    Origin: "http://127.0.0.1:5173",
    "X-App-Request": "keynest",
  };
  const suffix = Date.now();
  const slug = `preorder-${suffix}`;
  const name = `Game đặt trước ${suffix}`;
  const expected = new Date(Date.now() + 7 * 86400000)
    .toISOString()
    .slice(0, 10);
  expect(
    (
      await page.request.post("/api/auth/login", {
        headers,
        data: { email: "admin@keynest.local", password: "Admin123!" },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.post("/api/admin/products", {
        headers,
        data: {
          slug,
          name,
          category: "game",
          platform: "Steam",
          image: "",
          active: true,
          featured: false,
        },
      })
    ).ok(),
  ).toBe(true);
  await page.goto("/admin");
  await page
    .getByRole("button", { name: "Sản phẩm & kho", exact: true })
    .click();
  await page
    .locator("tr")
    .filter({ hasText: name })
    .getByRole("button", { name: "Quản lý" })
    .click();
  await page.getByRole("button", { name: "Thêm gói", exact: true }).click();
  await page.getByLabel("Tên gói", { exact: true }).fill("Đặt trước Standard");
  await page.getByLabel("Giá bán (VND)", { exact: true }).fill("10000");
  await page.getByLabel("Giá gốc (VND)", { exact: true }).fill("10000");
  await page.getByRole("combobox", { name: /^Cách giao/ }).selectOption("preorder");
  await page.getByLabel("Ngày giao dự kiến", { exact: false }).fill(expected);
  await page
    .getByLabel("Số lượt đặt trước còn nhận", { exact: false })
    .fill("2");
  await page.getByRole("button", { name: "Lưu gói", exact: true }).click();
  await expect(page.locator(".admin-variant")).toContainText(
    "Đặt trước · Còn lượt đặt 2",
  );
  await page.getByRole("button", { name: "Hoàn tất quản lý" }).click();

  const context = await browser.newContext();
  try {
    const buyer = await context.newPage();
    const base = "http://127.0.0.1:5173";
    expect(
      (
        await context.request.post(`${base}/api/auth/login`, {
          headers,
          data: { email: "student@keynest.local", password: "Student123!" },
        })
      ).ok(),
    ).toBe(true);
    await buyer.goto(`${base}/products/${slug}`);
    await expect(
      buyer.getByRole("button", { name: "Đặt trước ngay", exact: true }),
    ).toBeVisible();
    await expect(
      buyer.getByText(
        `Đặt trước · Dự kiến giao ${expected.split("-").reverse().join("/")}`,
        { exact: false },
      ),
    ).toBeVisible();
    await buyer.setViewportSize({ width: 390, height: 844 });
    expect(
      await buyer.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await buyer
      .getByRole("button", { name: "Thêm vào giỏ", exact: true })
      .click();
    await expect(buyer.getByRole('status').filter({hasText:'Đã thêm vào giỏ hàng.'})).toBeVisible();
    await buyer.goto(`${base}/cart`);
    await expect(buyer.locator(".cart-item")).toContainText(
      "Đặt trước · Dự kiến giao",
    );
    await buyer.getByRole('checkbox', { name: /Tôi đã kiểm tra sản phẩm/ }).check();
    await buyer
      .getByRole("button", { name: "Đặt hàng & thanh toán", exact: true })
      .click();
    await expect(buyer).toHaveURL(/\/orders$/);
    const order = (
      await (await context.request.get(`${base}/api/orders`)).json()
    ).find((o: { items: { product_slug: string }[] }) =>
      o.items.some((i) => i.product_slug === slug),
    );
    expect(order.status).toBe("processing");
    expect(order.items[0].keys).toHaveLength(0);
    await buyer.goto(`${base}/orders/${order.id}`);
    await expect(
      buyer.getByText("Đã thanh toán · Chờ giao hàng đặt trước", {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await buyer.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await buyer.screenshot({
      path: ".data/qa/preorder-mobile.png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
