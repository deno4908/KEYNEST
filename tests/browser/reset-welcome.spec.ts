import { test, expect } from '@playwright/test';
import { createPasswordTransport } from '../../server/password-transport.js';

const resetUrl = '/reset-password?recovery_id=00000000-0000-4000-8000-000000000001#token_hash=' + 'a'.repeat(56) + '&type=recovery';
const user = { id: '00000000-0000-4000-8000-000000000002', name: 'Khách khôi phục', email: 'recovered@example.test', role: 'customer', balance: 0 };

for (const action of ['continue', 'close'] as const) test(`reset success returns home and welcomes the verified account once (${action})`, async ({ page }) => {
  if (action === 'close') await page.setViewportSize({ width: 390, height: 844 });
  const transport = createPasswordTransport('ab'.repeat(32));
  let updated = false, verified = false;
  let finishVerification!: () => void;
  const verification = new Promise<void>(resolve => { finishVerification = resolve; });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/region') return route.fulfill({ json: { allowed: true } });
    if (path === '/api/config') return route.fulfill({ json: { mode: 'supabase', captcha: { enabled: false } } });
    if (path === '/api/auth/password-key') return route.fulfill({ json: transport.publicKey() });
    if (path === '/api/auth/reset/verify') return route.fulfill({ json: { ticket: 't'.repeat(48) } });
    if (path === '/api/auth/reset') { updated = true; return route.fulfill({ json: { message: 'Updated' } }); }
    if (path === '/api/auth/refresh') return route.fulfill({ status: updated ? 200 : 401, json: updated ? { ok: true } : { error: 'Unauthenticated' } });
    if (path === '/api/me') {
      if (!updated) return route.fulfill({ status: 401, json: { error: 'Unauthenticated' } });
      await verification;
      verified = true;
      return route.fulfill({ json: user });
    }
    if (path === '/api/cart') return route.fulfill({ json: { user_id: user.id, items: [] } });
    return route.fulfill({ json: [] });
  });
  await page.goto(resetUrl);
  await page.getByLabel('Mật khẩu mới', { exact: true }).fill('NewPassword123!');
  await page.getByLabel('Nhập lại mật khẩu mới').fill('NewPassword123!');
  await page.getByRole('button', { name: 'Lưu mật khẩu' }).click();
  const complete = page.getByRole('dialog', { name: 'Mật khẩu đã được cập nhật' });
  await expect(complete).toBeVisible();
  await expect(page.locator('.oauth-welcome')).toHaveCount(0);
  if (action === 'continue') await complete.getByRole('button', { name: /Tiếp tục vào cửa hàng/ }).click();
  else await complete.getByRole('button', { name: 'Đóng', exact: true }).click();
  await expect(page).toHaveURL('/');
  expect(verified).toBe(false);
  await expect(page.locator('.oauth-welcome')).toHaveCount(0);
  finishVerification();
  const welcome = page.getByRole('dialog', { name: 'Đăng nhập thành công' });
  await expect(welcome).toBeVisible();
  await expect(welcome).toContainText(user.name);
  await expect(welcome).toContainText(user.email);
  await welcome.getByRole('button', { name: /Tiếp tục vào cửa hàng/ }).click();
  await expect(welcome).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.oauth-welcome')).toHaveCount(0);
});

test('failed reset never queues or displays a successful login greeting', async ({ page }) => {
  const transport = createPasswordTransport('ab'.repeat(32));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/region') return route.fulfill({ json: { allowed: true } });
    if (path === '/api/config') return route.fulfill({ json: { mode: 'supabase', captcha: { enabled: false } } });
    if (path === '/api/auth/password-key') return route.fulfill({ json: transport.publicKey() });
    if (path === '/api/auth/reset/verify') return route.fulfill({ json: { ticket: 't'.repeat(48) } });
    if (path === '/api/auth/reset') return route.fulfill({ status: 503, json: { error: 'Không thể cập nhật lúc này' } });
    if (path === '/api/me' || path === '/api/auth/refresh') return route.fulfill({ status: 401, json: { error: 'Unauthenticated' } });
    return route.fulfill({ json: [] });
  });
  await page.goto(resetUrl);
  await page.getByLabel('Mật khẩu mới', { exact: true }).fill('NewPassword123!');
  await page.getByLabel('Nhập lại mật khẩu mới').fill('NewPassword123!');
  await page.getByRole('button', { name: 'Lưu mật khẩu' }).click();
  await expect(page.getByText('Không thể cập nhật lúc này')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('kn-oauth-welcome'))).toBeNull();
  await page.goto('/');
  await expect(page.locator('.oauth-welcome')).toHaveCount(0);
});
