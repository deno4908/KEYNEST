import { test, expect } from "@playwright/test";

test("category management creates, filters, edits and opens products on desktop and mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/health");
        return response.ok() ? (await response.json()).mode : "starting";
      },
      { timeout: 20000 },
    )
    .toBe("demo");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Quản trị viên', exact: true }).click();
  await dialog.locator('form').getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.goto("/admin");
  await page.getByRole("button", { name: "Danh mục", exact: true }).click();
  await expect(page.locator(".category-item").first()).toBeVisible();
  const suffix = Date.now();
  const name = `Phần mềm ${suffix}`;
  const id = `phan-mem-${suffix}`;
  await page.getByLabel("Tên hiển thị", { exact: true }).fill(name);
  await expect(page.getByLabel("Mã danh mục", { exact: true })).toHaveValue(id);
  await page.getByLabel("Mã danh mục", { exact: true }).fill(`tools-${suffix}`);
  await page.getByLabel("Tên hiển thị", { exact: true }).fill(`${name} mới`);
  await expect(page.getByLabel("Mã danh mục", { exact: true })).toHaveValue(
    `tools-${suffix}`,
  );
  await page.getByLabel("Mã danh mục", { exact: true }).fill(id);
  await page.getByRole("button", { name: "Tạo danh mục", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Đã lưu danh mục");
  await page
    .getByLabel("Tìm danh mục", { exact: true })
    .fill(`phan mem ${suffix}`);
  await expect(page.locator(".category-item")).toHaveCount(1);
  await expect(page.locator(".category-item")).toContainText("0 sản phẩm");
  await page.getByRole("button", { name: /Có sản phẩm/ }).click();
  await expect(page.getByText("Không có danh mục phù hợp.")).toBeVisible();
  await page.getByRole("button", { name: /Danh mục trống/ }).click();
  await page
    .getByRole("button", { name: `Sửa ${name} mới`, exact: true })
    .click();
  await expect(page.getByLabel("Mã danh mục", { exact: true })).toBeDisabled();
  await page.getByLabel("Tên hiển thị", { exact: true }).fill(`${name} sửa`);
  await page.getByLabel("Thứ tự hiển thị", { exact: true }).fill("12");
  await expect(page.locator(".category-preview .selected")).toHaveText(
    `${name} sửa`,
  );
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await expect(page.locator(".category-item")).toContainText("#12");
  const saved = await (await page.request.get("/api/categories")).json();
  expect(saved.find((row: { id: string }) => row.id === id)).toMatchObject({
    name: `${name} sửa`,
    sort_order: 12,
  });
  await page.getByLabel("Tìm danh mục", { exact: true }).fill("");
  await page.getByRole("button", { name: /Có sản phẩm/ }).click();
  await page.getByLabel("Sắp xếp danh mục").selectOption("count");
  await page
    .locator(".category-item")
    .first()
    .getByRole("button", { name: /sản phẩm/ })
    .click();
  await page.locator(".category-products button").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/categories-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
