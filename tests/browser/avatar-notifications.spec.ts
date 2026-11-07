import { test, expect } from "@playwright/test";

const snapshot = "2026-11-06T10:00:00.123456+00:00";
const notice = {
  id: "campaign:fixture:user",
  title: "Cập nhật tài khoản",
  body: "Thông tin mới",
  href: "/account",
  category: "announcements",
  created_at: snapshot,
  read_at: null,
};

async function fixture(page: import("@playwright/test").Page, count = 1) {
  const state = {
    count,
    fail: false,
    hold: false,
    calls: 0,
    release: () => {},
    readBody: null as unknown,
    later: false,
  };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.slice(4);
    let body: unknown = [];
    if (p === "/region") body = { allowed: true };
    if (p === "/auth/refresh") body = { success: true };
    if (p === "/me")
      body = {
        id: "fixture-user",
        role: "customer",
        name: "Avatar Preview",
        email: "avatar@example.test",
        balance: 0,
      };
    if (p === "/config")
      body = { mode: "supabase", captcha: { enabled: false } };
    if (p === "/cart") body = { items: [] };
    if (p === "/wallet") body = { balance: 0, ledger: [] };
    if (p === "/notifications/read") {
      state.readBody = route.request().postDataJSON();
      state.count = state.later ? 1 : 0;
      return route.fulfill({ json: { success: true } });
    }
    if (p === "/notifications") {
      const preview = url.searchParams.get("page_size") === "8";
      const prior = state.count;
      if (preview) {
        state.calls++;
        if (state.fail)
          return route.fulfill({
            status: 503,
            json: { error: "Tạm mất kết nối" },
          });
        if (state.hold) {
          state.hold = false;
          await new Promise<void>((resolve) => {
            state.release = resolve;
          });
        }
      }
      const read = url.searchParams.get("read") === "1";
      const count = preview ? prior : state.count;
      body = {
        items:
          count && !read
            ? [
                {
                  ...notice,
                  ...(state.later && count === 1
                    ? { id: "campaign:later:user", title: "Tin vừa đến" }
                    : {}),
                },
              ]
            : [],
        total: read ? 0 : count,
        unread_count: count,
        pages: count ? 1 : 0,
        page: 1,
        snapshot_at: snapshot,
      };
    }
    await route.fulfill({ json: body });
  });
  return state;
}

test("avatar holds capped all-category count, navigates to account and reads only the observed snapshot", async ({
  page,
}) => {
  const state = await fixture(page, 125);
  await page.goto("/notifications");
  const badge = page.locator(".header-avatar-wrap .header-chat-badge");
  await expect(badge).toHaveText("99+");
  await expect(badge).toHaveAccessibleName("125 thông báo chưa đọc");
  await expect(page.locator(".notification-trigger")).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.locator(".account-button").click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(badge).toHaveText("99+");
  state.later = true;
  await page
    .getByRole("button", { name: "Đánh dấu tất cả đã đọc", exact: true })
    .click();
  expect(state.readBody).toEqual({ all: true, before: snapshot });
  await expect(badge).toHaveText("1");
  await expect(page.locator(".notification-preview")).toContainText(
    "Tin vừa đến",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "output/admin-inbox-20261106/avatar-mobile.png",
    fullPage: true,
  });
});

test("read while a poll is pending queues fresh receipts and never restores the stale badge", async ({
  page,
}) => {
  await page.clock.install();
  const state = await fixture(page);
  await page.goto("/notifications");
  await expect(page.locator(".header-chat-badge")).toHaveText("1");
  await expect(page.locator(".inbox-item")).toHaveCount(1);
  state.hold = true;
  const before = state.calls;
  await page.clock.fastForward(10001);
  await expect.poll(() => state.calls).toBeGreaterThan(before);
  await page
    .getByRole("button", { name: "Đánh dấu đã đọc", exact: true })
    .click();
  await expect.poll(() => state.readBody).toEqual({ id: notice.id });
  state.release();
  await expect(page.locator(".header-chat-badge")).toHaveCount(0);
  await expect(page.locator(".inbox-item")).toHaveCount(0);
  await page.clock.fastForward(11000);
  await expect(page.locator(".header-chat-badge")).toHaveCount(0);
});

test("temporary fetch errors preserve the last count and the retry button recovers", async ({
  page,
}) => {
  await page.clock.install();
  const state = await fixture(page);
  await page.goto("/account");
  await expect(page.locator(".header-chat-badge")).toHaveText("1");
  state.fail = true;
  await page.clock.fastForward(10001);
  await expect(
    page.locator(".notification-preview").getByRole("alert"),
  ).toContainText("Tạm mất kết nối");
  await expect(page.locator(".header-chat-badge")).toHaveText("1");
  state.fail = false;
  state.count = 0;
  await page
    .locator(".notification-preview")
    .getByRole("button", { name: "Thử lại", exact: true })
    .click();
  await expect(page.locator(".header-chat-badge")).toHaveCount(0);
  await expect(
    page.locator(".notification-preview").getByRole("alert"),
  ).toHaveCount(0);
});

for (const path of ["/account", "/notifications"]) {
  test(`mark all read at ${path} clears the list and avatar immediately`, async ({ page }) => {
    const state = await fixture(page, 3);
    await page.goto(path);
    await expect(page.locator(".header-chat-badge")).toHaveText("3");
    await expect(page.locator(".inbox-item")).toHaveCount(1);
    await page.getByRole("button", { name: "Đánh dấu tất cả đã đọc", exact: true }).click();
    expect(state.readBody).toEqual({ all: true, before: snapshot });
    await expect(page.locator(".header-chat-badge")).toHaveCount(0);
    await expect(page.locator(".inbox-item")).toHaveCount(0);
    await expect(page.getByText("Bạn đã xem hết thông báo mới", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator(".inbox-item")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Đánh dấu tất cả đã đọc", exact: true })).toBeDisabled();
  });
}
