import { test, expect } from '@playwright/test';
import { SELLER_TERMS_VERSION } from '../../shared/seller-terms.js';

test('seller revenue excludes refunds per item and respects the selected order period', async ({ page, request }) => {
  await expect.poll(async () => {
    try { return (await (await request.get('/api/health')).json()).mode; }
    catch { return null; }
  }).toBe('demo');
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 40 * 86400000).toISOString();
  const profile = { id: crypto.randomUUID(), name: 'Revenue seller', seller_name: 'Revenue shop',
    email: 'revenue@example.test', role: 'seller', balance: 0, seller_terms_version: SELLER_TERMS_VERSION,
    seller_terms_accepted_at: now };
  const sale = (id: string, gross: number, extra = {}) => ({
    id, name: 'Digital product', product_id: 'product', variant_name: 'Standard', price: gross, quantity: 1,
    delivery: 'key', seller_gross: gross, seller_fee: gross * 0.07, seller_net: gross * 0.93,
    seller_settled_at: now, order: { number: id, status: 'completed', created_at: now, customer_note: '' }, ...extra,
  });
  let sales = [
    sale('refund-100000', 100000, { seller_reversed_at: now, refunded_at: now,
      order: { number: 'refunded-order', status: 'refunded', created_at: now, customer_note: '' } }),
    sale('refund-1000', 1000, { seller_reversed_at: now, refunded_at: now,
      order: { number: 'refunded-order', status: 'refunded', created_at: now, customer_note: '' } }),
  ];
  // The entire financial fixture is read-only; no real orders, refunds or wallet writes.
  await page.route('**/api/me', route => route.fulfill({ json: profile }));
  await page.route('**/api/auth/refresh', route => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/seller/overview', route => route.fulfill({ json: {
    profile, products: [], sales, withdrawals: [], ledger: [], held: 0, fee_bps: 700,
  } }));
  const totals = page.locator('.seller-section').filter({ has: page.getByRole('heading', { name: 'Doanh thu & đối soát' }) }).locator('.seller-stats strong');
  async function check(values: number[]) {
    await expect.poll(() => totals.allTextContents().then(rows => rows.map(row => Number(row.replace(/\D/g, ''))))).toEqual(values);
  }
  await page.goto('/seller?tab=revenue');
  // Exact user report: 101,000 gross was fully refunded, with 93,930 reversed income.
  await check([0, 0, 0, 93930]);
  await expect(page.getByText('Doanh thu sau hoàn tiền', { exact: true })).toBeVisible();
  const partialOrder = { number: 'partially-refunded', status: 'completed', created_at: now, customer_note: '' };
  sales = [...sales,
    sale('active', 200000),
    sale('partial-retained', 50000, { order: partialOrder }),
    sale('partial-refunded', 100000, { order: partialOrder, refunded_at: now, seller_reversed_at: now }),
    sale('unpaid', 500000, { seller_gross: undefined, seller_fee: undefined, seller_net: undefined,
      order: { number: 'unpaid', status: 'pending', created_at: now, customer_note: '' } }),
    sale('refund-timestamp', 10000, { refunded_at: now }),
    sale('refund-order-status', 10000, { order: { number: 'legacy-refund', status: 'refunded', created_at: now, customer_note: '' } }),
  ];
  await page.reload();
  await check([250000, 17500, 232500, 186930]);
  sales = [...sales,
    sale('old-active', 100000, { order: { number: 'old-active', status: 'completed', created_at: old, customer_note: '' } }),
    sale('old-refunded', 300000, { seller_reversed_at: now, refunded_at: now,
      order: { number: 'old-refund', status: 'refunded', created_at: old, customer_note: '' } }),
  ];
  await page.reload();
  await check([350000, 24500, 325500, 465930]);
  await page.getByLabel('Thời gian đặt đơn').selectOption('7');
  await check([250000, 17500, 232500, 186930]);
  await page.getByLabel('Thời gian đặt đơn').selectOption('all');
  await check([350000, 24500, 325500, 465930]);
});
