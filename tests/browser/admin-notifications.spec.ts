import { accountLegal, orderLegal } from '../helpers/legal.js';
import { test, expect } from '@playwright/test';

const headers = { Origin: 'http://127.0.0.1:5173', 'X-App-Request': 'keynest' };

test('admin avatar receives support and preorder alerts, links to the right record and clears only on explicit read', async ({ page, browser, request }) => {
  test.setTimeout(90000);
  await expect.poll(async () => {
    try { const r = await request.get('/api/health'); return r.ok() ? (await r.json()).mode : null; }
    catch { return null; }
  }, { timeout: 30000 }).toBe('demo');
  expect((await page.request.post('/api/auth/login', { headers, data: { email: 'admin@keynest.local', password: 'Admin123!' } })).ok()).toBeTruthy();
  expect((await page.request.post('/api/notifications/read', { headers, data: { all: true } })).ok()).toBeTruthy();
  await page.goto('/account');
  const badge = page.locator('.header-chat-badge');
  await expect(badge).toHaveCount(0);
  const buyer = await browser.newContext();
  try {
    const suffix = crypto.randomUUID().slice(0, 8);
    expect((await buyer.request.post('/api/auth/register', { headers, data: { legal: accountLegal, email: `notice-${suffix}@example.test`, name: `Notification Buyer ${suffix}`, password: 'Buyer12345!' } })).ok()).toBeTruthy();
    const subject = `Cần hỗ trợ ${suffix}`;
    const support = await buyer.request.post('/api/tickets', { headers, data: { subject, message: 'Cần hỗ trợ kiểm tra đơn hàng giúp tôi.' } });
    expect(support.ok()).toBeTruthy();
    const ticket = await support.json();
    await expect(badge).toHaveText('1', { timeout: 16000 });
    const supportNotice = page.locator('.inbox-item').filter({ hasText: subject });
    await expect(supportNotice).toBeVisible({ timeout: 16000 });
    await supportNotice.getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/admin\\?tab=tickets&ticket=${ticket.id}`));
    await expect(page.getByRole('dialog').getByRole('heading', { name: subject })).toBeVisible();
    // Opening the linked task must not silently acknowledge the profile notice.
    await expect(badge).toHaveText('1');
    await page.goto('/account');
    await page.locator('.inbox-item').filter({ hasText: subject }).getByRole('button', { name: 'Đánh dấu đã đọc', exact: true }).click();
    await expect(badge).toHaveCount(0);
    await page.reload();
    await expect(badge).toHaveCount(0);

    const productResponse = await page.request.post('/api/admin/products', { headers, data: { slug: `notice-preorder-${suffix}`, name: `Đặt trước ${suffix}`, category: 'game', platform: 'PC', image: '', active: true, featured: false } });
    expect(productResponse.ok()).toBeTruthy();
    const product = await productResponse.json();
    const variantResponse = await page.request.post(`/api/admin/products/${product.id}/variants`, { headers, data: { name: 'Preorder', price: 10000, original_price: 10000, delivery: 'manual', stock: 3, region: 'Global', warranty_days: 30, is_preorder: true, expected_delivery: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) } });
    expect(variantResponse.ok()).toBeTruthy();
    const catalog = await (await buyer.request.get('/api/products')).json();
    const variant = catalog.find((p: { id: string }) => p.id === product.id).variants[0];
    const ordered = await buyer.request.post('/api/orders', { headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() }, data: { legal: orderLegal, items: [{ variant_id: variant.id, quantity: 1 }], method: 'sepay', coupon: '', customer_note: '' } });
    expect(ordered.ok()).toBeTruthy();
    const order = await ordered.json();
    await expect(badge).toHaveText('1', { timeout: 16000 });
    const preorderNotice = page.locator('.inbox-item').filter({ hasText: 'Đơn đặt trước mới' });
    await expect(preorderNotice).toBeVisible({ timeout: 16000 });
    await preorderNotice.getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/admin\\?tab=orders&order=${order.id}`));
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.goto('/account');
    await page.getByRole('button', { name: 'Đánh dấu tất cả đã đọc', exact: true }).click();
    await expect(badge).toHaveCount(0);
    // Bank payment creates a separate event; replay does not duplicate it.
    const payment = (await (await buyer.request.get(`/api/orders/${order.id}`)).json()).payment;
    expect((await buyer.request.post(`/api/demo/pay/${payment.id}`, { headers })).ok()).toBeTruthy();
    await expect(badge).toHaveText('1', { timeout: 16000 });
    await expect(page.locator('.inbox-item').filter({ hasText: 'Đơn đặt trước đã thanh toán' })).toBeVisible({ timeout: 16000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(badge).toBeVisible();
    await page.screenshot({ path: 'output/admin-notifications-mobile.png', fullPage: true });
    expect((await buyer.request.post(`/api/demo/pay/${payment.id}`, { headers })).ok()).toBeTruthy();
    expect((await (await page.request.get('/api/notifications')).json()).unread_count).toBe(1);
  } finally { await buyer.close(); }
});
