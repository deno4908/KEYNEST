import { test, expect } from "@playwright/test";

const headers = { Origin: "http://127.0.0.1:5173", "X-App-Request": "keynest" };

test("coupon edits update mounted admin and promotions tabs without navigation or losing drafts", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  expect((await (await page.request.get("/api/health")).json()).mode).toBe(
    "demo",
  );
  expect(
    (
      await page.request.post("/api/auth/login", {
        headers,
        data: { email: "admin@keynest.local", password: "Admin123!" },
      })
    ).ok(),
  ).toBe(true);
  const code = `LIVE${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const promotions = await context.newPage();
  const secondAdmin = await context.newPage();
  await promotions.goto("/promotions");
  await secondAdmin.goto("/admin?tab=coupons");
  await expect(secondAdmin.locator(".admin-coupons")).toBeVisible();
  await page.goto("/admin?tab=coupons");
  await page.getByLabel("Tìm mã giảm giá").fill("NO_MATCH");
  await page.getByRole("button", { name: "Thêm mã", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('[name="code"]').fill(code);
  // Background clicks and drags must never discard a coupon draft.
  await page.locator(".modal-backdrop").click({ position: { x: 2, y: 2 } });
  await expect(dialog.locator('[name="code"]')).toHaveValue(code);
  const bounds = await dialog.boundingBox();
  await page.mouse.move(bounds!.x + 10, bounds!.y + 10);
  await page.mouse.down();
  await page.mouse.move(2, 2);
  await page.mouse.up();
  await expect(dialog.locator('[name="code"]')).toHaveValue(code);
  await dialog
    .getByRole("button", { name: "Lưu mã giảm giá", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const row = page.locator("tbody tr").filter({ hasText: code });
  await expect(row).toBeVisible();
  await expect(page.getByLabel("Tìm mã giảm giá")).toHaveValue("");
  await expect(
    secondAdmin.locator("tbody tr").filter({ hasText: code }),
  ).toBeVisible();
  const card = promotions.locator(".coupon-card").filter({ hasText: code });
  await expect(card).toBeVisible();

  // An update from another browser/device has no local mutation event.
  // Visible public pages still pick it up through their refresh interval.
  const response = await page.request.post("/api/admin/coupons", {
    headers,
    data: {
      code,
      percent: 25,
      max_discount: 100000,
      active: true,
      expires_at: null,
    },
  });
  expect(response.ok()).toBe(true);
  await expect(card.getByRole("heading")).toHaveText("Giảm 25%", {
    timeout: 25000,
  });

  // Background refresh must not overwrite an editor already in progress.
  await row
    .getByRole("button", { name: "Sửa mã giảm giá", exact: true })
    .click();
  await dialog.locator('[name="percent"]').fill("35");
  await secondAdmin
    .locator("tbody tr")
    .filter({ hasText: code })
    .getByRole("button", { name: `Ghim mã ${code}`, exact: true })
    .click();
  await expect(
    row.getByRole("button", { name: `Bỏ ghim mã ${code}`, exact: true }),
  ).toBeVisible();
  await expect(dialog.locator('[name="percent"]')).toHaveValue("35");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  page.once("dialog", (d) => d.accept());
  await row
    .getByRole("button", { name: `Xóa mã ${code}`, exact: true })
    .click();
  await expect(row).toHaveCount(0);
  await expect(card).toHaveCount(0);
  await expect(
    secondAdmin.locator("tbody tr").filter({ hasText: code }),
  ).toHaveCount(0);
  await promotions.close();
  await secondAdmin.close();
});
