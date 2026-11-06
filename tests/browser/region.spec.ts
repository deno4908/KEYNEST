import { test, expect } from '@playwright/test';

test('changing VPN while the storefront or signup is open shows the region screen before submitting credentials', async ({ page }) => {
  let allowed = true, registrations = 0;
  await page.route('**/api/region', route => route.fulfill({ json: { allowed } }));
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/auth/register') registrations++; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  const auth = page.locator('.auth-dialog');
  await auth.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  await expect(auth.getByLabel('Tên của bạn')).toBeVisible();
  allowed = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'KEYNEST hiện chỉ hoạt động tại Việt Nam.' })).toBeVisible();
  await expect(auth).toHaveCount(0);
  await expect(page.getByText('Phiên đăng nhập không hợp lệ.', { exact: true })).toHaveCount(0);
  expect(registrations).toBe(0);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: 'test-results/region-vpn-mobile.png', fullPage: true });
  allowed = true;
  await page.getByRole('link', { name: 'Thử truy cập lại' }).click();
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.locator('.auth-dialog')).toBeVisible();
});

test('an edge region rejection during session restoration displays region UI instead of a session error', async ({ page }) => {
  await page.route('**/api/region', route => route.fulfill({ json: { allowed: true } }));
  await page.route('**/api/auth/refresh', route => route.fulfill({ status: 403, json: { code: 'REGION_RESTRICTED', error: 'KEYNEST hiện chỉ hoạt động tại Việt Nam.' } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'KEYNEST hiện chỉ hoạt động tại Việt Nam.' })).toBeVisible();
  await expect(page.locator('.auth-dialog')).toHaveCount(0);
});

test('signup checks the current region again if VPN changes without a focus event', async ({ page }) => {
  let allowed = true, writes = 0;
  await page.route('**/api/region', route => route.fulfill({ json: { allowed } }));
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/auth/register') writes++; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  const dialog = page.locator('.auth-dialog');
  await dialog.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  await dialog.getByLabel('Tên của bạn').fill('Region Check');
  await dialog.getByLabel('Email', { exact: true }).fill('region@example.test');
  await dialog.getByLabel('Mật khẩu', { exact: true }).fill('RegionCheck123!');
  await dialog.getByLabel('Nhập lại mật khẩu', { exact: true }).fill('RegionCheck123!');
  await dialog.getByRole('checkbox').nth(0).check();
  await dialog.getByRole('checkbox').nth(1).check();
  allowed = false;
  await dialog.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'KEYNEST hiện chỉ hoạt động tại Việt Nam.' })).toBeVisible();
  expect(writes).toBe(0);
});
