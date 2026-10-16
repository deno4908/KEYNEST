import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('recent order images fit completely inside their thumbnail', async ({ page }) => {
  const css = readFileSync('src/member.css', 'utf8');
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const [w, h] of [[600, 1200], [1200, 600], [800, 800]]) {
      const image = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="blue"/></svg>`)}`;
      await page.setContent(`<style>${css}</style><div class="member-orders"><a class="member-order"><span class="member-order-icon member-order-cover"><img src="${image}" alt="Product"></span><div>Product</div></a></div>`);
      await expect(page.locator('img')).toHaveCSS('object-fit', 'contain');
      await expect.poll(() => page.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
      const bounds = await page.locator('img').evaluate(img => {
        const a = img.getBoundingClientRect(), b = img.parentElement!.getBoundingClientRect();
        return a.top >= b.top && a.bottom <= b.bottom && a.left >= b.left && a.right <= b.right;
      });
      expect(bounds).toBe(true);
    }
  }
});
