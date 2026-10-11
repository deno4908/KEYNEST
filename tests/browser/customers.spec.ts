import { test, expect } from "@playwright/test";

test("customer role filters and responsive account list", async ({ page }) => {
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
  await page.getByRole("button", { name: "Khách hàng", exact: true }).click();
  await expect(page.locator(".customer-identity").first()).toBeVisible();
  await page.getByRole("button", { name: "Người bán", exact: true }).click();
  await expect(page.getByText("Không có tài khoản phù hợp")).toBeVisible();
  await page.getByRole("button", { name: "Xóa bộ lọc", exact: true }).click();
  await expect(page.locator(".customer-identity").first()).toBeVisible();
  await page.screenshot({
    path: "test-results/customers-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/customers-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
