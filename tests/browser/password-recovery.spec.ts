import { test, expect } from '@playwright/test';

test('confirmation must match and success opens the themed password animation', async ({ page }) => {
  let resets = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/reset/verify') await route.fulfill({ json: { ticket: 't'.repeat(48) } });
    else if (path === '/api/auth/reset') {
      resets++;
      expect(route.request().postDataJSON()).toEqual({ ticket: 't'.repeat(48), password: 'NewPassword123!' });
      await route.fulfill({ json: { message: 'Updated' } });
    } else await route.fulfill({ status: 503, json: { error: 'Store unavailable' } });
  });
  await page.goto('/reset-password?recovery_id=00000000-0000-4000-8000-000000000001#token_hash=' + 'a'.repeat(56) + '&type=recovery');
  await page.getByLabel(/^Mật khẩu mới/).fill('abcdefghij');
  await expect(page.locator('#reset-password-rules .met')).toHaveCount(1);
  await page.getByLabel('Nhập lại mật khẩu mới').fill('abcdefghij');
  await page.getByRole('button', { name: 'Lưu mật khẩu' }).click();
  await expect(page.getByRole('alert')).toContainText('đủ ba điều kiện');
  expect(resets).toBe(0);
  await page.getByLabel(/^Mật khẩu mới/).fill('NewPassword123!');
  await expect(page.locator('#reset-password-rules .met')).toHaveCount(3);
  await page.getByLabel('Nhập lại mật khẩu mới').fill('OtherPassword123!');
  await page.getByRole('button', { name: 'Lưu mật khẩu' }).click();
  await expect(page.getByRole('alert')).toContainText('Hai mật khẩu chưa khớp');
  expect(resets).toBe(0);
  await page.getByLabel('Nhập lại mật khẩu mới').fill('NewPassword123!');
  await page.getByRole('button', { name: 'Lưu mật khẩu' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mật khẩu đã được cập nhật' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Tiếp tục/ })).toBeFocused();
  await expect(page.locator('.reset-password-new')).toHaveCSS('opacity', '1');
  expect(await dialog.textContent()).not.toContain('NewPassword123!');
  expect(resets).toBe(1);
});

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
  await page.getByLabel('Nhập lại mật khẩu mới').fill('NewPassword123!');
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
