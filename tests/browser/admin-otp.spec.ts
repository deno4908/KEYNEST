import { test, expect } from '@playwright/test';

for (const mobile of [false, true]) {
  test(`admin OTP requires server confirmation before success (${mobile ? 'mobile' : 'desktop'})`, async ({ page }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 960 });
    if (mobile) await page.emulateMedia({ reducedMotion: 'reduce' });
    let attempts = 0;
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      let status = 200;
      let body: unknown = [];
      if (path === '/api/config') body = { mode: 'supabase', captcha: { enabled: false } };
      if (path === '/api/auth/refresh' || path === '/api/me') { status = 401; body = { error: 'Unauthenticated' }; }
      if (path === '/api/auth/admin-otp/status') body = { verified: false, email: 'a***@example.test', sent: false, retry_after: 0 };
      if (path === '/api/auth/admin-otp/send') body = { sent: true, retry_after: 60 };
      if (path === '/api/auth/admin-otp/verify') {
        expect(route.request().postDataJSON()).toEqual({ code: '123456' });
        attempts++;
        if (attempts === 1) { status = 400; body = { error: 'Mã OTP không đúng hoặc hết hạn.' }; }
        else body = { verified: true };
      }
      await route.fulfill({ status, json: body });
    });
    // Capture the successful navigation without requiring a real admin session.
    await page.route('**/admin', route => route.fulfill({ contentType: 'text/html', body: '<h1>Admin destination</h1>' }));
    await page.goto('/admin-verification');
    const panel = page.locator('.admin-verification-layout');
    await expect(panel).toHaveAttribute('data-stage', 'ready');
    if (!mobile) {
      await expect(panel.locator('.verification-aside')).toBeVisible();
      await expect(panel.locator('.verification-game')).toHaveCSS('background-image', /1245620\/library_hero\.jpg/);
    }
    await page.getByRole('button', { name: 'Gửi mã xác thực', exact: true }).click();
    const input = page.getByLabel('Mã OTP trong email', { exact: true });
    await expect(input).toBeFocused();
    await expect(page.getByRole('button', { name: /Gửi lại sau/ })).toBeDisabled();
    await expect(panel).toHaveAttribute('data-stage', 'sent');
    await input.fill('123456');
    await page.getByRole('button', { name: 'Xác minh và tiếp tục' }).click();
    await expect(page.getByRole('alert')).toHaveText('Mã OTP không đúng hoặc hết hạn.');
    await expect(panel).toHaveAttribute('data-stage', 'sent');
    await expect(input).toBeFocused();
    await expect(page).toHaveURL('/admin-verification');
    await expect.poll(() => panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    if (mobile) await expect(panel).toHaveCSS('animation-name', 'none');
    await page.screenshot({ path: `test-results/admin-otp-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Xác minh và tiếp tục' }).click();
    if (!mobile) await expect(page.getByRole('heading', { name: 'Đã xác minh email' })).toBeVisible();
    await expect(page).toHaveURL('/admin');
    expect(attempts).toBe(2);
  });
}

test('an already verified admin returns to admin without sending another email', async ({ page }) => {
  let sends = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/admin-otp/send') sends++;
    const body = path === '/api/config' ? { mode: 'supabase', captcha: { enabled: false } } :
      path === '/api/region' ? { allowed: true } :
      path === '/api/auth/admin-otp/status' ? { verified: true, email: 'a***@example.test', sent: false, retry_after: 0 } : [];
    await route.fulfill({ status: ['/api/me', '/api/auth/refresh'].includes(path) ? 401 : 200, json: body });
  });
  await page.route('**/admin', route => route.fulfill({ contentType: 'text/html', body: '<h1>Admin destination</h1>' }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/admin-verification');
  await expect(page).toHaveURL('/admin');
  expect(sends).toBe(0);
});
