import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('seller product rows contain full images, long names and stock without overflowing on mobile', async ({ page }) => {
  const css = ['styles','dark','member','storefront','payments','feedback','product-images','orders','admin','mobile-layout','seller'].map(name => readFileSync(`src/${name}.css`, 'utf8')).join('\n');
  const src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1200"><rect width="600" height="1200" fill="orange"/></svg>');
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(`<style>${css}</style><div class="container seller-page"><div class="seller-product-list"><article>
      <span class="seller-product-cover"><img src="${src}" alt="Product"></span>
      <div class="seller-product-copy"><div class="seller-product-heading"><strong>${'Long product name '.repeat(5)}</strong></div><p class="seller-product-review-note">Waiting for administrator approval</p></div>
      <div class="seller-product-status"><span class="seller-review-badge">Pending</span></div>
      <div class="seller-product-metrics"><div class="seller-product-stock"><small>Stock</small><strong>1</strong></div><div class="seller-product-price"><small>Price</small><strong>100.000 ₫</strong></div></div>
      <div class="seller-row-actions"><button class="button button-outline">Manage</button><button class="icon-button" disabled>Show</button><button class="icon-button">Delete</button></div>
      <div class="seller-product-variants"><h3>Stock</h3><div class="seller-stock-list"><div><div class="seller-stock-info"><strong>${'variant'.repeat(30)}</strong><span>100.000 ₫</span></div><span class="seller-stock-badge is-low">Stock 1</span><button class="button">Import</button></div></div></div>
      </article></div></div>`);
    await expect(page.locator('img')).toHaveCSS('object-fit', 'contain');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const cover = await page.locator('.seller-product-cover').boundingBox();
    const img = await page.locator('img').boundingBox();
    expect(img!.height).toBeLessThanOrEqual(cover!.height);
    expect(img!.width).toBeLessThanOrEqual(cover!.width);
    await page.getByRole('button', { name: 'Manage' }).click({ trial: true });
    await expect(page.getByRole('button', { name: 'Show', exact: true })).toBeDisabled();
  }
});
