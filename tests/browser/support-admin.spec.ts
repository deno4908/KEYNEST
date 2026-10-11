import { test, expect } from '@playwright/test';

test('mobile admin entry and support count remain accessible', async ({ page }) => {
  expect((await (await page.request.get('/api/health')).json()).mode).toBe('demo');
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: 'http://127.0.0.1:5173', 'X-App-Request': 'keynest' },
    data: { email: 'admin@keynest.local', password: 'Admin123!' },
  });
  expect(login.ok()).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/account');
  const entry = page.locator('.member-admin-link');
  await expect(entry).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await entry.click();
  await expect(page).toHaveURL(/\/admin$/);
  const support = page.getByRole('button', { name: /Hỗ trợ khách hàng/ });
  await expect(support.locator('span')).toHaveText(/^\d+$/);
  await page.goto('/catalog');
  const filter = page.getByRole('textbox', { name: 'Lọc sản phẩm' });
  await filter.focus();
  await expect(filter).toHaveCSS('box-shadow', 'none');
  await expect(filter.locator('..')).not.toHaveCSS('box-shadow', 'none');
});
