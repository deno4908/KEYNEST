import { test, expect } from '@playwright/test';

test('2FA popup focuses the code, handles rejection and logs out on dismissal', async ({ page }) => {
  let loggedOut = false;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let status = 200;
    let body: unknown = [];
    if (path === '/api/config') body = { mode: 'supabase', captcha: { enabled: false } };
    if (path === '/api/auth/refresh' || path === '/api/me') { status = 401; body = { error: 'Unauthenticated' }; }
    if (path === '/api/auth/mfa/status') body = { required: true, factors: [{ id: 'test-factor', name: 'Authenticator' }] };
    if (path === '/api/auth/mfa/verify') {
      expect(route.request().postDataJSON()).toEqual({ factor_id: 'test-factor', code: '123456', remove: false });
      status = 400;
      body = { error: 'Mã không hợp lệ' };
    }
    if (path === '/api/auth/logout') { loggedOut = true; body = { ok: true }; }
    await route.fulfill({ status, json: body });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/two-factor');
  const dialog = page.getByRole('dialog', { name: 'Xác thực hai bước', exact: true });
  await expect(dialog).toBeVisible();
  const code = dialog.getByLabel('Mã xác thực', { exact: true });
  await expect(code).toBeFocused();
  await expect(dialog.locator('.mfa-login-icon svg')).toHaveCount(1);
  await expect.poll(() => dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await code.fill('123456');
  await dialog.getByRole('button', { name: 'Xác minh và tiếp tục' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Mã không hợp lệ');
  await expect(code).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL('/');
  expect(loggedOut).toBe(true);
});
