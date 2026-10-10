import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  expect((await (await request.get("/api/health")).json()).mode).toBe("demo");
});

test("banners rotate, pause and respect reduced motion; category menu works at all widths", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/");
  const slide = page.locator(".campaign-slide");
  await expect(slide).toBeVisible();
  const initial = await slide.getAttribute("aria-label");
  await page.clock.fastForward(6100);
  await expect(slide).not.toHaveAttribute("aria-label", initial!);
  await page.locator(".campaign-slider").hover();
  const hovered = await slide.getAttribute("aria-label");
  await page.clock.fastForward(13000);
  await expect(slide).toHaveAttribute("aria-label", hovered!);
  await page.getByRole("button", { name: "Tạm dừng chuyển banner" }).click();
  await page.mouse.move(0, 0);
  await page.locator("h1").click();
  await page.clock.fastForward(13000);
  await expect(slide).toHaveAttribute("aria-label", hovered!);
  await page
    .getByRole("button", { name: "Banner tiếp theo", exact: true })
    .click();
  await expect(slide).not.toHaveAttribute("aria-label", hovered!);
  await page.getByRole("button", { name: "Tiếp tục chuyển banner" }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("h1").click();
  await page.mouse.move(0, 0);
  const reduced = await slide.getAttribute("aria-label");
  await page.clock.fastForward(13000);
  await expect(slide).toHaveAttribute("aria-label", reduced!);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page
      .locator(width < 600 ? ".mobile-toggle" : ".department-toggle")
      .click();
    const menu = page.locator("#shop-departments");
    await expect(menu).toBeVisible();
    await expect(
      menu.getByRole("link", { name: /Proxy dân cư/ }),
    ).toBeAttached();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    expect(await menu.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
      true,
    );
    await page.keyboard.press("Escape");
    await expect(menu).not.toBeVisible();
  }
  await page.locator(".mobile-toggle").click();
  await page
    .locator("#shop-departments")
    .getByRole("link", { name: /Proxy IPv4 riêng/ })
    .click();
  await expect(page).toHaveURL(/sub=/);
  await expect(page.locator("#shop-departments")).toHaveCount(0);
  await expect(page.locator(".product-card")).toHaveCount(1);
  await expect(page.locator(".product-card")).toContainText("Private IPv4");
});

test("search suggestions, combined URL filters, recent history and promotions work", async ({
  page,
}) => {
  await page.goto("/");
  const search = page.getByRole("combobox", { name: "Tìm sản phẩm" });
  await search.fill("hollow");
  await expect(
    page.getByRole("option", { name: /Hollow Knight/ }),
  ).toBeVisible();
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(page).toHaveURL(/products\/hollow-knight$/);
  await page.goto("/");
  await expect(page.locator(".recently-viewed .product-card")).toContainText(
    "Hollow Knight",
  );
  await page.goto(
    "/catalog?category=game&sub=Th%E1%BA%BF+gi%E1%BB%9Bi+m%E1%BB%9F",
  );
  await expect(page.locator(".product-card")).toHaveCount(2);
  await page
    .getByRole("combobox", { name: "Nền tảng", exact: true })
    .selectOption("Steam");
  await page
    .getByRole("combobox", { name: "Hình thức giao", exact: true })
    .selectOption("key");
  await page
    .getByRole("combobox", { name: "Khoảng giá", exact: true })
    .selectOption("500000");
  await page
    .getByRole("combobox", { name: "Sắp xếp", exact: true })
    .selectOption("asc");
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Khoảng giá", exact: true }),
  ).toHaveValue("500000");
  await expect(page.locator(".product-card").first()).toContainText(
    "Red Dead Redemption 2",
  );
  await page
    .getByRole("combobox", { name: "Hình thức giao", exact: true })
    .selectOption("manual");
  await expect(
    page.getByRole("heading", { name: "Chưa tìm thấy sản phẩm" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /Bộ lọc sản phẩm/ }).click();
  await expect(
    page.getByRole("combobox", { name: "Hình thức giao", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Xóa tất cả bộ lọc" }).click();
  await expect(page.locator(".product-card")).toHaveCount(12);
  for (const route of ["/promotions", "/guide"]) {
    await page.goto(route);
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
  }
  await page.goto("/promotions");
  await expect(
    page.locator(".coupon-card").filter({ hasText: "WELCOME10" }),
  ).toContainText("Giảm 10%");
  await page.getByRole("link", { name: /Sản phẩm đang giảm giá/ }).click();
  await expect(page).toHaveURL(/sale=1/);
});

test("admin can save a banner draft, publish and unpublish it", async ({
  page,
  request,
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
  await page
    .getByRole("button", { name: "Banner trang chủ", exact: true })
    .click();
  await page.getByRole("button", { name: "Thêm banner", exact: true }).click();
  const title = `UI Banner ${Date.now()}`;
  await dialog.getByLabel("Tiêu đề banner").fill(title);
  await dialog
    .getByLabel("Hoặc dùng đường dẫn ảnh")
    .fill(
      "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1245620/library_hero.jpg",
    );
  await dialog.getByRole("button", { name: "Lưu banner", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const row = page
    .locator(".banner-admin-list article")
    .filter({ hasText: title });
  await expect(row).toContainText("Đang ẩn");
  const draft = (
    await (await page.request.get("/api/admin/banners")).json()
  ).find((b: { title: string }) => b.title === title);
  try {
    expect(
      (await (await request.get("/api/banners")).json()).some(
        (b: { title: string }) => b.title === title,
      ),
    ).toBe(false);
    await row.getByRole("button", { name: "Chỉnh sửa" }).click();
    await dialog.getByLabel("Hiển thị trên trang chủ").check();
    await dialog
      .getByRole("button", { name: "Lưu banner", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(row).toContainText("Đang hiển thị");
    expect(
      (await (await request.get("/api/banners")).json()).some(
        (b: { title: string }) => b.title === title,
      ),
    ).toBe(true);
  } finally {
    const response = await page.request.post("/api/admin/banners", {
      headers: { Origin: "http://127.0.0.1:5173", "X-App-Request": "keynest" },
      data: { ...draft, active: false },
    });
    expect(response.ok()).toBe(true);
  }
});
