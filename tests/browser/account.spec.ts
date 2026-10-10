import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  expect((await (await request.get("/api/health")).json()).mode).toBe("demo");
});

test("authentication stays usable across modes, failed login, keyboard and small screens", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Đăng nhập", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  const email = dialog.getByLabel("Email", { exact: true });
  await expect(email).toBeFocused();
  await email.fill("missing@example.test");
  await dialog
    .getByLabel("Mật khẩu", { exact: true })
    .fill("WrongPassword123!");
  await dialog
    .getByRole("button", { name: "Hiện mật khẩu", exact: true })
    .click();
  await expect(dialog.getByLabel("Mật khẩu", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await dialog
    .getByRole("button", { name: "Ẩn mật khẩu", exact: true })
    .click();
  await dialog
    .locator("form")
    .getByRole("button", { name: "Đăng nhập", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(email).toHaveValue("missing@example.test");
  await dialog.getByRole("button", { name: "Đăng ký", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByLabel("Tên của bạn")).toBeVisible();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 700 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await dialog
      .getByRole("button", { name: "Tạo tài khoản", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      dialog.getByRole("button", { name: "Tạo tài khoản", exact: true }),
    ).toBeInViewport();
  }
  await dialog.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Quên mật khẩu?", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Gửi hướng dẫn" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Quay lại đăng nhập" }).click();
  const close = dialog.getByRole("button", { name: "Đóng", exact: true });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Quản trị viên", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("account handles empty history, profile edits, load errors and responsive sections", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Đăng ký", exact: true }).click();
  await dialog.getByLabel("Tên của bạn").fill("Account UI Test");
  await dialog
    .getByLabel("Email", { exact: true })
    .fill(`account-ui-${Date.now()}@example.test`);
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
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Đơn hàng đầu tiên đang chờ bạn" }),
  ).toBeVisible();
  await expect(page.locator(".member-balance")).toContainText("0");
  await page
    .getByRole("button", { name: "Thông tin cá nhân", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Lưu thay đổi" }),
  ).toBeDisabled();
  const longName = "Nguyễn Hoàng Anh Minh Trần Account Display Name";
  await page.getByLabel("Họ tên", { exact: true }).fill(longName);
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Đã lưu thay đổi" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Họ tên", { exact: true })).toHaveValue(
    longName,
  );
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (const name of [
      "Tổng quan",
      "Thông tin cá nhân",
      "Đăng nhập & bảo mật",
    ]) {
      await page.getByRole("button", { name, exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      const overflow = await page
        .locator(".member-content")
        .evaluate(
          (root) =>
            [...root.querySelectorAll("input, button, section, form")].filter(
              (el) => el.getBoundingClientRect().right > innerWidth + 1,
            ).length,
        );
      expect(overflow).toBe(0);
    }
  }
  await expect(
    page.getByRole("button", { name: "Gửi email đặt lại mật khẩu" }),
  ).toBeDisabled();
  await page.route("**/api/orders", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Không tải được lịch sử. Vui lòng thử lại.",
      }),
    }),
  );
  await page.goto("/account");
  await expect(page.getByRole("alert")).toContainText("Không tải được lịch sử");
  await page.unroute("**/api/orders");
  await page.getByRole("button", { name: "Thử tải lại" }).click();
  await expect(
    page.getByRole("heading", { name: "Đơn hàng đầu tiên đang chờ bạn" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(errors).toEqual([]);
});
