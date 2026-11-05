import { accountLegal } from '../helpers/legal.js';
﻿import { test, expect } from "@playwright/test";

test("account sessions/inbox and admin customer controls work on desktop and mobile", async ({
  page,
}) => {
  expect((await (await page.request.get("/api/health")).json()).mode).toBe(
    "demo",
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const headers = {
    Origin: "http://127.0.0.1:5173",
    "X-App-Request": "keynest",
  };
  const email = `operations-${Date.now()}@example.test`;
  const registered = await page.request.post("/api/auth/register", {
    headers,
    data: { legal: accountLegal, email, password: "OperationsTest123!", name: "Operations Test" },
  });
  expect(registered.ok()).toBe(true);
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Thông báo", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Chưa có thông báo mới.")).toBeVisible();
  await page.goto("/account?section=security");
  await expect(
    page.getByRole("heading", { name: "Phiên đăng nhập", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Phiên hiện tại", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.request.post("/api/auth/logout", { headers });
  expect(
    (
      await page.request.post("/api/auth/login", {
        headers,
        data: { email: "admin@keynest.local", password: "Admin123!" },
      })
    ).ok(),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/admin");
  await page.getByRole("button", { name: "Khách hàng", exact: true }).click();
  await page.getByLabel("Tìm theo email").fill(email);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Khóa tài khoản", exact: true })
    .click();
  await page
    .getByLabel("Lý do", { exact: true })
    .fill("Browser test account access review");
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await expect(page.getByRole("cell", { name: /^Đã khóa/ })).toBeVisible();
  await page.getByRole("button", { name: "Mở tài khoản", exact: true }).click();
  await page
    .getByLabel("Lý do", { exact: true })
    .fill("Browser test review completed");
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await expect(page.getByRole("cell", { name: /^Hoạt động/ })).toBeVisible();
  await page.getByRole("button", { name: "Thanh toán", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Pay2S/ })).toBeVisible();
  expect(errors).toEqual([]);
});
