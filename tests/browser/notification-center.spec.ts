import { test, expect } from "@playwright/test";
import { accountLegal } from "../helpers/legal.js";
import { SELLER_TERMS_VERSION } from "../../shared/seller-terms.js";

const headers = { Origin: "http://127.0.0.1:5173", "X-App-Request": "keynest" };
test("customer and seller inboxes expose all events, synchronize receipts across tabs, and remain isolated", async ({
  browser,
  page,
  request,
}) => {
  test.setTimeout(90000);
  const adminLogin = await request.post("/api/auth/login", {
    headers,
    data: { email: "admin@keynest.local", password: "Admin123!" },
  });
  expect(adminLogin.ok()).toBeTruthy();
  for (const role of ["customer", "seller"]) {
    const context = await browser.newContext();
    const actor = await context.newPage();
    const errors: string[] = [];
    actor.on("pageerror", (e) => errors.push(e.message));
    try {
      const suffix = crypto.randomUUID().slice(0, 8);
      const email = `inbox-${role}-${suffix}@example.test`;
      const registered = await context.request.post("/api/auth/register", {
        headers,
        data: {
          legal: accountLegal,
          email,
          name: `Inbox ${role} ${suffix}`,
          password: "InboxActor123!",
        },
      });
      expect(
        registered.status(),
        registered.ok() ? "" : await registered.text(),
      ).toBe(200);
      if (role === "seller") {
        const me = await (await context.request.get("/api/me")).json();
        expect(
          (
            await request.post("/api/admin/sellers/role", {
              headers,
              data: { user_id: me.id, role: "seller" },
            })
          ).ok(),
        ).toBeTruthy();
        const overview = await (
          await context.request.get("/api/seller/overview")
        ).json();
        expect(
          (
            await context.request.post("/api/seller/profile", {
              headers,
              data: {
                name: `Inbox Seller ${suffix}`,
                terms_version: SELLER_TERMS_VERSION,
                accepted: true,
                fee_bps: overview.fee_bps,
              },
            })
          ).ok(),
        ).toBeTruthy();
      }
      const title = `Tin tài khoản ${role} ${suffix}`;
      expect(
        (
          await request.post("/api/admin/notifications", {
            headers,
            data: {
              id: crypto.randomUUID(),
              email,
              title,
              body: "Nội dung thử nghiệm hộp thông báo theo vai trò.",
            },
          })
        ).ok(),
      ).toBeTruthy();
      await actor.goto("/notifications");
      await expect(actor.locator(".notification-trigger")).toHaveAccessibleName(
        "Thông báo, 1 chưa đọc",
      );
      await expect(
        actor.locator(".inbox-item").filter({ hasText: title }),
      ).toBeVisible();
      await actor.getByLabel("Loại thông báo").selectOption("orders");
      await expect(
        actor.getByText("Không tìm thấy thông báo phù hợp", { exact: true }),
      ).toBeVisible();
      await actor.getByLabel("Loại thông báo").selectOption("announcements");
      await actor.getByLabel("Tìm tiêu đề thông báo").fill(suffix);
      await expect(actor.locator(".inbox-item")).toHaveCount(1);
      const otherTab = await context.newPage();
      await otherTab.goto("/notifications");
      await expect(
        otherTab.locator(".notification-trigger"),
      ).toHaveAccessibleName("Thông báo, 1 chưa đọc");
      await actor
        .getByRole("button", { name: "Đánh dấu đã đọc", exact: true })
        .click();
      await expect(actor.locator(".notification-trigger")).toHaveAccessibleName(
        "Thông báo, 0 chưa đọc",
      );
      await expect(
        otherTab.locator(".notification-trigger"),
      ).toHaveAccessibleName("Thông báo, 0 chưa đọc");
      await otherTab.close();
      await actor.getByRole("button", { name: "Đã đọc", exact: true }).click();
      await expect(actor.locator(".inbox-item")).toHaveCount(1);
      await actor
        .getByRole("button", { name: "Đánh dấu chưa đọc", exact: true })
        .click();
      await expect(actor.locator(".notification-trigger")).toHaveAccessibleName(
        "Thông báo, 1 chưa đọc",
      );
      await actor
        .getByRole("button", { name: "Chưa đọc", exact: true })
        .click();
      await actor.setViewportSize({ width: 390, height: 844 });
      await actor.locator(".notification-trigger").click();
      const preview = actor.getByRole("region", { name: "Thông báo gần đây" });
      await expect(preview.getByText(title, { exact: true })).toBeVisible();
      await actor.keyboard.press("Escape");
      await expect(preview).toHaveCount(0);
      await expect(actor.locator(".notification-trigger")).toBeFocused();
      expect(
        await actor.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await actor.screenshot({
        path: `output/admin-inbox-20261106/${role}-inbox-mobile.png`,
        fullPage: true,
      });
      if (role === "seller") {
        await actor.goto("/seller?tab=notifications");
        await expect(
          actor.getByRole("heading", { name: "Hộp thông báo", exact: true }),
        ).toBeVisible();
      }
      await actor.request.post("/api/auth/logout", { headers });
      await actor.reload();
      await expect(actor.locator(".notification-trigger")).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  }
  // Administrative shortcuts open actual filters and fit the mobile viewport.
  expect(
    (
      await page.request.post("/api/auth/login", {
        headers,
        data: { email: "admin@keynest.local", password: "Admin123!" },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Hôm nay cần làm gì?" }),
  ).toBeVisible();
  await page.getByLabel("Khoảng thống kê").selectOption("30");
  await expect(
    page.getByText("Trong 30 ngày, gồm mọi trạng thái"),
  ).toBeVisible();
  await page.getByRole("button", { name: /Sản phẩm sắp hết mã/ }).click();
  await expect(page.getByLabel("Lọc sản phẩm quản trị")).toHaveValue("low");
  await page.goBack();
  await expect(page.locator(".admin-work-grid")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
