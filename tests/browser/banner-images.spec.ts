import { test, expect } from '@playwright/test';
import { defaultBanners } from '../../shared/storefront.js';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/api/region' ? { allowed: true } :
      path === '/api/config' ? { mode: 'supabase', captcha: { enabled: false } } :
      path === '/api/banners' ? defaultBanners.map((banner, i) => ({ ...banner, id: String(i) })) : [];
    await route.fulfill({ status: ['/api/me', '/api/auth/refresh'].includes(path) ? 401 : 200, json: body });
  });
});

test('slow banner uses a game preview, keeps its slide, then reveals the local responsive image', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let steamRequests = 0;
  await page.route('https://shared.fastly.steamstatic.com/**', route => { steamRequests++; return route.abort(); });
  await page.route('**/black-myth-wukong-640.webp*', async route => {
    if (route.request().resourceType() === 'image') await pending;
    await route.continue();
  });
  await page.clock.install();
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const slide = page.locator('.campaign-slide');
    await expect(slide.locator('.campaign-image')).toHaveAttribute('data-loaded', 'true');
    await expect.poll(() => slide.locator('img').evaluate(el => el.currentSrc)).toContain('elden-ring-640');
    await page.getByRole('button', { name: 'Banner tiếp theo', exact: true }).click();
    await expect(slide).toHaveAttribute('aria-label', '2 / 3');
    await expect(slide.locator('.campaign-image-preview')).toBeVisible();
    await expect(slide.locator('.campaign-image-preview')).not.toHaveCSS('background-image', 'none');
    await expect(slide.locator('img')).toHaveAttribute('data-loaded', 'false');
    await expect(slide.getByRole('link')).toHaveAttribute('href', '/products/black-myth-wukong');
    await page.clock.fastForward(10000);
    await expect(slide).toHaveAttribute('aria-label', '2 / 3');
    await page.screenshot({ path: 'test-results/banner-slow-preview.png' });
    release();
    await expect(slide.locator('img')).toHaveAttribute('data-loaded', 'true');
    await expect(slide.locator('img')).toHaveCSS('opacity', '1');
    await expect.poll(() => slide.locator('img').evaluate(el => el.currentSrc)).toContain('black-myth-wukong-640');
    expect(await slide.locator('img').evaluate(el => el.naturalWidth)).toBeGreaterThan(0);
    await page.clock.fastForward(8500);
    await expect(slide).toHaveAttribute('aria-label', '3 / 3');
    expect(steamRequests).toBe(0);
  } finally { release(); }
});

test('failed banner retains its preview and working navigation without a broken image', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/black-myth-wukong-*.webp*', route =>
    route.request().resourceType() === 'image' ? route.abort() : route.continue());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const slide = page.locator('.campaign-slide');
  await page.getByRole('button', { name: 'Banner tiếp theo', exact: true }).click();
  await expect(slide).toHaveAttribute('aria-label', '2 / 3');
  await expect(slide.locator('img')).toHaveCount(0);
  await expect(slide.locator('.campaign-image-preview')).toBeVisible();
  await expect(slide.locator('.campaign-image-preview')).not.toHaveCSS('background-image', 'none');
  await expect(slide.getByRole('link')).toHaveAttribute('href', '/products/black-myth-wukong');
  await page.getByRole('button', { name: 'Banner tiếp theo', exact: true }).click();
  await expect(slide).toHaveAttribute('aria-label', '3 / 3');
  await expect(slide.locator('img')).toHaveAttribute('data-loaded', 'true');
});
