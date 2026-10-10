import { test, expect } from "@playwright/test";

test("auth transition, password confirmation and social login feedback", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Đăng nhập bằng Google", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Đăng nhập bằng Discord", exact: true }),
  ).toBeVisible();
  await page.route("**/api/auth/oauth/google", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Google chưa được cấu hình." }),
    }),
  );
  await dialog
    .getByRole("button", { name: "Đăng nhập bằng Google", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Google chưa được cấu hình",
  );
  await expect(
    dialog.getByRole("button", { name: "Đăng nhập bằng Discord", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Đăng ký", exact: true }).click();
  await expect(dialog.locator(".auth-tabs")).toHaveAttribute(
    "data-active",
    "register",
  );
  await expect(dialog.locator(".auth-stage-inner")).toHaveCSS(
    "animation-name",
    "auth-forward",
  );
  await dialog.getByLabel("Tên của bạn").fill("Confirm Test");
  await dialog
    .getByLabel("Email", { exact: true })
    .fill("confirmation@example.test");
  await dialog
    .getByLabel("Mật khẩu", { exact: true })
    .fill("CorrectPassword123!");
  await dialog
    .getByLabel("Nhập lại mật khẩu", { exact: true })
    .fill("DifferentPassword123!");
  let submissions = 0;
  await page.route("**/api/auth/register", (route) => {
    submissions++;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: "Kiểm tra email để xác nhận tài khoản.",
      }),
    });
  });
  await dialog
    .getByRole("button", { name: "Tạo tài khoản", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Mật khẩu nhập lại chưa khớp",
  );
  expect(submissions).toBe(0);
  await dialog
    .getByRole("button", { name: "Hiện mật khẩu nhập lại", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Nhập lại mật khẩu", { exact: true }),
  ).toHaveAttribute("type", "text");
  await dialog
    .getByLabel("Nhập lại mật khẩu", { exact: true })
    .fill("CorrectPassword123!");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await expect
      .poll(() => dialog.evaluate((el) => el.scrollWidth <= el.clientWidth))
      .toBe(true);
    await dialog
      .getByRole("button", { name: "Tạo tài khoản", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      dialog.getByRole("button", { name: "Tạo tài khoản", exact: true }),
    ).toBeInViewport();
  }
  await dialog
    .getByRole("button", { name: "Tạo tài khoản", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("Kiểm tra email");
  expect(submissions).toBe(1);
  await dialog
    .getByRole("button", { name: "Quay lại đăng nhập", exact: true })
    .click();
  await expect(dialog.locator(".auth-stage-inner")).toHaveCSS(
    "animation-name",
    "auth-backward",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await dialog.getByRole("button", { name: "Đăng ký", exact: true }).click();
  await expect(dialog.locator(".auth-stage-inner")).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(dialog.locator(".auth-stage")).toHaveCSS(
    "transition-duration",
    "0s",
  );
});
