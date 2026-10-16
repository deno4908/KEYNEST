import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('order summary stays above support while scrolling with short and tall orders', async ({ page }) => {
  const css = ['styles', 'dark', 'member', 'storefront', 'payments', 'feedback', 'product-images', 'orders', 'admin', 'mobile-layout']
    .map(name => readFileSync(`src/${name}.css`, 'utf8')).join('\n');
  for (const width of [1280, 1920]) {
    await page.setViewportSize({ width, height: 800 });
    for (const count of [1, 8]) {
      await page.setContent(`<style>${css}</style><div style="height:200px"></div>
        <div class="container page purchases-page order-detail-page"><div class="order-detail-layout">
        <aside class="order-summary-column"><section class="order-section order-detail-summary">
        ${'<div style="height:110px">Product</div>'.repeat(count)}</section>
        <section class="order-help"><div><h3>Support</h3><a href="/support">Contact support</a></div></section></aside>
        <div class="order-content-column" style="height:2500px"></div></div></div>`);
      await expect(page.locator('.order-detail-summary')).toHaveCSS('position', 'static');
      for (const scroll of [0, 150, 400, 800, 1200]) {
        await page.evaluate(y => window.scrollTo(0, y), scroll);
        const gap = await page.evaluate(() => document.querySelector('.order-help')!.getBoundingClientRect().top
          - document.querySelector('.order-detail-summary')!.getBoundingClientRect().bottom);
        expect(gap).toBeGreaterThanOrEqual(17);
      }
      await page.locator('.order-help a').scrollIntoViewIfNeeded();
      await page.locator('.order-help a').click({ trial: true });
    }
  }
});
