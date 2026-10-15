import { test, expect } from '@playwright/test';

test('email login shows welcome only on success, closes and does not replay', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  const auth = page.locator('.auth-dialog');
  await auth.getByLabel('Email', { exact: true }).fill('student@keynest.local');
  await auth.getByLabel('Mật khẩu', { exact: true }).fill('WrongPassword123!');
  await auth.getByRole('button', { name: 'Đăng nhập', exact: true }).last().click();
  await expect(auth.getByRole('alert')).toBeVisible();
  await expect(page.locator('.oauth-welcome')).toHaveCount(0);
  await auth.getByLabel('Mật khẩu', { exact: true }).fill('Student123!');
  await auth.getByRole('button', { name: 'Đăng nhập', exact: true }).last().click();
  const welcome = page.locator('.oauth-welcome');
  await expect(welcome).toBeVisible();
  await expect(auth).toHaveCount(0);
  await expect(welcome.locator('.oauth-welcome-provider.email')).toBeVisible();
  await expect(welcome.locator('.oauth-welcome-account')).toContainText('student@keynest.local');
  await welcome.getByRole('button', { name: /Tiếp tục vào cửa hàng/ }).click();
  await expect(welcome).toHaveCount(0);
  await page.reload();
  await expect(welcome).toHaveCount(0);
});

test('registration uses the same welcome with member greeting on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  const auth = page.locator('.auth-dialog');
  await auth.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  const unique = Date.now();
  await auth.getByLabel('Tên của bạn').fill(`Welcome ${unique}`);
  await auth.getByLabel('Email', { exact: true }).fill(`welcome-${unique}@example.test`);
  await auth.getByLabel('Mật khẩu', { exact: true }).fill('NewAccount123!');
  await auth.getByLabel('Nhập lại mật khẩu', { exact: true }).fill('NewAccount123!');
  await auth.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  const welcome = page.locator('.oauth-welcome');
  await expect(welcome).toBeVisible();
  await expect(welcome.locator('.oauth-welcome-confirmed')).toHaveText('Đăng ký thành công');
  await expect(welcome.locator('.oauth-welcome-provider.register')).toBeVisible();
  await expect(welcome.locator('.oauth-welcome-copy')).toContainText(`Welcome ${unique}`);
  await expect.poll(() => welcome.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(welcome).toHaveCSS('animation-name', 'none');
  await welcome.getByRole('button', { name: /Tiếp tục vào cửa hàng/ }).click();
  await expect(welcome).toHaveCount(0);
});
