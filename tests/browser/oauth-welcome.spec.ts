import { test, expect } from '@playwright/test';

test('social welcome requires a session, works on mobile and does not replay after refresh', async ({ page }) => {
  await expect.poll(async () => (await page.request.get('/api/health')).status()).toBe(200);
  expect((await (await page.request.get('/api/health')).json()).mode).toBe('demo');
  await page.goto('/account?welcome=google');
  await expect(page.getByRole('heading', { name: 'Chào bạn, đăng nhập nhé.' })).toBeVisible();
  await expect(page.locator('.oauth-welcome')).toHaveCount(0);
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: 'http://127.0.0.1:5173', 'X-App-Request': 'keynest' },
    data: { email: 'student@keynest.local', password: 'Student123!' },
  });
  expect(login.ok()).toBe(true);
  await page.clock.install();
  for (const provider of ['google', 'discord']) {
    await page.setViewportSize({ width: provider === 'google' ? 1440 : 390, height: 900 });
    await page.goto(`/account?welcome=${provider}`);
    const welcome = page.locator('.oauth-welcome');
    await expect(welcome).toBeVisible();
    const gameImage = welcome.locator('.oauth-welcome-game');
    await expect.poll(() => gameImage.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(welcome.locator(`.oauth-welcome-provider.${provider}`)).toBeVisible();
    await expect(welcome.locator('.oauth-welcome-copy')).toContainText('Xin chào,');
    await expect(page).toHaveURL(/\/account$/);
    await expect.poll(() => welcome.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    if (provider === 'google') {
      await welcome.getByRole('button', { name: /Tiếp tục vào cửa hàng/ }).click();
    } else {
      await page.clock.fastForward(5000);
      await expect(welcome).toBeVisible();
      await expect(welcome.locator('.oauth-welcome-countdown')).toHaveText('5s');
      await page.clock.fastForward(5000);
    }
    await expect(welcome).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.member-heading')).toBeVisible();
    await expect(welcome).toHaveCount(0);
  }
});
