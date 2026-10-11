import { test, expect } from '@playwright/test';

test('public products render while the session is pending; private pages wait', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/auth/refresh', route => route.fulfill({ json: { ok: true } }));
  let sessionStarted = false;
  await page.route('**/api/me', async route => {
    sessionStarted = true;
    await pending;
    await route.fulfill({ status: 401, json: { error: 'Sign in required' } });
  });
  try {
    await page.goto('/');
    await expect.poll(() => sessionStarted).toBe(true);
    await expect(page.locator('.product-card').first()).toBeVisible();
    await page.locator('.header-wallet').click();
    await expect(page.locator('.loading')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Chào bạn, đăng nhập nhé.' })).toHaveCount(0);
    release();
    await expect(page.getByRole('heading', { name: 'Chào bạn, đăng nhập nhé.' })).toBeVisible();
  } finally { release(); }
});
