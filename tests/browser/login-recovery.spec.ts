import { test, expect } from '@playwright/test';
import { createPasswordTransport } from '../../server/password-transport.js';

for (const mobile of [false, true]) test(`login recovery needs a fresh CAPTCHA with OTP before showing password form (${mobile ? 'mobile' : 'desktop'})`, async ({ page }) => {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    let number = 0;
    (window as unknown as { grecaptcha: unknown }).grecaptcha = {
      ready: (callback: () => void) => callback(),
      render: (element: HTMLElement, options: { callback: (token: string) => void }) => {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Xác nhận CAPTCHA thử nghiệm';
        button.onclick = () => { options.callback(`captcha-${++number}`); button.disabled = true; };
        element.append(button); return number;
      }, reset() {},
    };
  });
  await page.route('https://www.google.com/recaptcha/api.js*', route => route.fulfill({ contentType: 'application/javascript', body: '// CAPTCHA fixture; provider behavior is verified separately.' }));
  const transport = createPasswordTransport('ab'.repeat(32));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/password-key') return route.fulfill({ json: transport.publicKey() });
    if (path === '/api/region') return route.fulfill({ json: { allowed: true } });
    if (path === '/api/auth/refresh' || path === '/api/me') return route.fulfill({ status: 401, json: { error: 'Unauthenticated' } });
    return route.fulfill({ json: [] });
  });
  await page.route('**/api/config', route => route.fulfill({ json: { mode: 'supabase', captcha: { enabled: true, site_key: 'fixture' } } }));
  await page.route('**/api/auth/login', route => route.fulfill({ status: 429, json: { code: 'PASSWORD_RECOVERY_REQUIRED', error: 'Yêu cầu OTP' } }));
  let sent = 0, checked = 0;
  await page.route('**/api/auth/login-recovery/send', route => {
    expect(route.request().headers()['x-captcha-token']).toBeTruthy(); sent++;
    return route.fulfill({ json: { challenge: 'encrypted-challenge', retry_after: 90 } });
  });
  await page.route('**/api/auth/login-recovery/verify', route => {
    expect(route.request().headers()['x-captcha-token']).toBeTruthy();
    expect(route.request().postDataJSON().code).toBe('123456'); checked++;
    return route.fulfill({ json: { ticket: 'single-use-reset-ticket' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#auth-email').fill('user@example.com');
  await dialog.locator('#auth-password').fill('WrongPassword123!');
  await dialog.getByRole('button', { name: 'Xác nhận CAPTCHA thử nghiệm' }).click();
  await dialog.locator('button.auth-submit').click();
  await expect(dialog.getByRole('heading', { name: 'Xác minh để đặt lại mật khẩu' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Gửi mã OTP', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Xác nhận CAPTCHA thử nghiệm' }).click();
  await dialog.getByRole('button', { name: 'Gửi mã OTP', exact: true }).click();
  await dialog.getByLabel('Mã OTP trong email').fill('123456');
  await expect(dialog.getByRole('button', { name: 'Xác minh & đặt mật khẩu mới' })).toBeDisabled();
  expect(sent).toBe(1); expect(checked).toBe(0);
  await dialog.getByRole('button', { name: 'Xác nhận CAPTCHA thử nghiệm' }).click();
  await dialog.getByRole('button', { name: 'Xác minh & đặt mật khẩu mới' }).click();
  await expect(page).toHaveURL(/\/reset-password$/);
  await expect(page.getByLabel('Mật khẩu mới', { exact: true })).toBeVisible();
  expect(checked).toBe(1);
  expect(await page.evaluate(() => sessionStorage.getItem('single-use-reset-ticket'))).toBeNull();
  await page.reload();
  await expect(page.getByLabel('Mật khẩu mới', { exact: true })).toHaveCount(0);
  await page.unroute('**/api/auth/login');
  await page.route('**/api/auth/login', route => route.fulfill({ status: 429, json: { code: 'RECOVERY_OTP_LOCKED', error: 'Luồng OTP đang tạm khóa do quá nhiều lần thử.', retry_after: 1800 } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).first().click();
  await dialog.locator('#auth-email').fill('user@example.com');
  await dialog.locator('#auth-password').fill('CorrectPassword123!');
  await dialog.getByRole('button', { name: 'Xác nhận CAPTCHA thử nghiệm' }).click();
  await dialog.locator('button.auth-submit').click();
  await expect(dialog.getByRole('alert')).toContainText('Có thể thử lại lúc');
  await expect(dialog.locator('#auth-email')).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Xác minh để đặt lại mật khẩu' })).toHaveCount(0);
  expect(sent).toBe(1); expect(checked).toBe(1);
});
