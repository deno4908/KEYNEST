import { test, expect } from '@playwright/test';

test('recovery redeems once under StrictMode, submits ticket and rejects reload', async ({ page }) => {
  let verifies = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/reset/verify') {
      verifies++;
      expect(route.request().postDataJSON()).toEqual({ token_hash: 'a'.repeat(56), type: 'recovery', recovery_id: '00000000-0000-4000-8000-000000000001' });
      await route.fulfill({ json: { ticket: 't'.repeat(48) } });
    } else if (path === '/api/auth/reset') {
      expect(route.request().postDataJSON()).toEqual({ ticket: 't'.repeat(48), password: 'NewPassword123!' });
      await route.fulfill({ status: 503, json: { error: 'Temporary server error' } });
    } else await route.fulfill({ status: 503, json: { error: 'Store unavailable' } });
  });
  await page.goto('/reset-password?recovery_id=00000000-0000-4000-8000-000000000001#token_hash=' + 'a'.repeat(56) + '&type=recovery');
  await expect(page.getByLabel(/^Mật khẩu mới/)).toBeVisible();
  expect(verifies).toBe(1);
  expect(new URL(page.url()).search).toBe('');
  expect(new URL(page.url()).hash).toBe('');
  await page.getByLabel(/^Mật khẩu mới/).fill('NewPassword123!');
  await page.getByRole('button', { name: 'Lưu mật khẩu' }).click();
  await expect(page.getByText('Temporary server error')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Liên kết thiếu thông tin');
  expect(verifies).toBe(1);
});

test('query links remain supported and provider outages are not shown as expiry', async ({ page }) => {
  await page.route('**/api/**', async route => {
    await route.fulfill({ status: 503, json: { error: 'Không thể xác minh liên kết lúc này. Vui lòng thử lại sau.' } });
  });
  await page.goto('/reset-password?recovery_id=00000000-0000-4000-8000-000000000001&token_hash=' + 'a'.repeat(56) + '&type=recovery');
  await expect(page.getByRole('alert')).toContainText('Không thể xác minh liên kết lúc này');
});
