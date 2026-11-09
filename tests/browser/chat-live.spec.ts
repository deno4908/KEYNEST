import { test, expect } from '@playwright/test';
import type { WebSocketRoute } from '@playwright/test';
import { accountLegal, orderLegal } from '../helpers/legal.js';
import { SELLER_TERMS_VERSION } from '../../shared/seller-terms.js';

const origin = 'http://127.0.0.1:5173';
const headers = { Origin: origin, 'X-App-Request': 'keynest' };

test('buyer and seller chat over the real WebSocket proxy without polling and recover missed messages', async ({ page, browser, request }, info) => {
  test.setTimeout(90000);
  // Never create these test accounts/orders against a hosted project.
  await expect.poll(async () => {
    try { const response = await request.get('/api/health'); return response.ok() ? (await response.json()).mode : null; }
    catch { return null; }
  }, { timeout: 30000 }).toBe('demo');
  const sellerContext = await browser.newContext({ baseURL: origin });
  try {
    const suffix = crypto.randomUUID().slice(0, 8);
    const registered = await sellerContext.request.post('/api/auth/register', { headers, data: {
      legal: accountLegal, email: `live-${suffix}@example.test`, name: `Live Seller ${suffix}`, password: 'LiveSeller123!',
    } });
    expect(registered.ok(), await registered.text()).toBeTruthy();
    const sellerId = (await registered.json()).user.id;
    expect((await request.post('/api/auth/login', { headers, data: { email: 'admin@keynest.local', password: 'Admin123!' } })).ok()).toBeTruthy();
    expect((await request.post('/api/admin/sellers/role', { headers, data: { user_id: sellerId, role: 'seller' } })).ok()).toBeTruthy();
    expect((await sellerContext.request.post('/api/seller/profile', { headers, data: {
      name: `Live Seller ${suffix}`, terms_version: SELLER_TERMS_VERSION, accepted: true, fee_bps: 700,
    } })).ok()).toBeTruthy();
    const productResponse = await sellerContext.request.post('/api/seller/products', { headers, data: {
      name: `WebSocket ${suffix}`, slug: `live-chat-${suffix}`, category: 'game', platform: 'PC', image: '', active: true, featured: false,
    } });
    expect(productResponse.ok(), await productResponse.text()).toBeTruthy();
    const product = await productResponse.json();
    expect((await sellerContext.request.post(`/api/seller/products/${product.id}/variants`, { headers, data: {
      name: 'Manual service', price: 10000, original_price: 10000, stock: 10, delivery: 'manual', warranty_days: 30, region: 'Global',
    } })).ok()).toBeTruthy();
    const overview = await (await sellerContext.request.get('/api/seller/overview')).json();
    const current = overview.products.find((row: { id: string }) => row.id === product.id);
    expect((await request.post(`/api/admin/products/${product.id}/review`, { headers, data: { version: current.review_version, approve: true } })).ok()).toBeTruthy();
    expect((await page.request.post('/api/auth/login', { headers, data: { email: 'student@keynest.local', password: 'Student123!' } })).ok()).toBeTruthy();
    const orderResponse = await page.request.post('/api/orders', { headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() }, data: {
      legal: orderLegal, items: [{ variant_id: current.variants[0].id, quantity: 1 }], method: 'wallet', coupon: '', customer_note: 'Test player UID 12345',
    } });
    expect(orderResponse.ok(), await orderResponse.text()).toBeTruthy();
    const order = await orderResponse.json();
    const sellerPage = await sellerContext.newPage();
    // Keep a handle to the native socket to simulate a dropped connection,
    // rather than replacing either the client protocol or server transport.
    await page.addInitScript(() => {
      const Native = window.WebSocket;
      (window as any).__chatSockets = [];
      window.WebSocket = class extends Native {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          (window as any).__chatSockets.push(this);
        }
      };
    });
    const reads: string[] = [], errors: string[] = [];
    for (const tab of [page, sellerPage]) {
      tab.on('request', req => { if (req.method() === 'GET' && /\/api\/(order-chat\/|seller\/support)/.test(req.url())) reads.push(req.url()); });
      tab.on('pageerror', error => errors.push(error.message));
    }
    await Promise.all([page.goto(`/orders/${order.id}`), sellerPage.goto('/seller?tab=sales')]);
    await page.getByRole('button', { name: 'Chat với người bán', exact: true }).click();
    await sellerPage.getByRole('button', { name: 'Chat', exact: true }).first().click();
    const buyerDialog = page.getByRole('dialog'), sellerDialog = sellerPage.getByRole('dialog');
    await expect(buyerDialog.getByRole('status')).toHaveText('Đã kết nối chat trực tiếp');
    await expect(sellerDialog.getByRole('status')).toHaveText('Đã kết nối chat trực tiếp');
    await buyerDialog.getByRole('textbox', { name: 'Tin nhắn', exact: true }).fill('Buyer live message');
    await buyerDialog.getByRole('button', { name: 'Gửi tin nhắn', exact: true }).click();
    await expect(sellerDialog.getByRole('log')).toContainText('Buyer live message');
    await sellerDialog.getByRole('textbox', { name: 'Tin nhắn', exact: true }).fill('Seller live reply');
    await sellerDialog.getByRole('button', { name: 'Gửi tin nhắn', exact: true }).click();
    await expect(buyerDialog.getByRole('log')).toContainText('Seller live reply');
    await buyerDialog.getByRole('textbox', { name: 'Tin nhắn', exact: true }).fill('Keep my draft after disconnect');
    await page.evaluate(() => {
      for (const socket of (window as any).__chatSockets as WebSocket[]) if (socket.url.endsWith('/api/chat/live')) socket.close();
    });
    await sellerDialog.getByRole('textbox', { name: 'Tin nhắn', exact: true }).fill('Sent during reconnect');
    await sellerDialog.getByRole('button', { name: 'Gửi tin nhắn', exact: true }).click();
    await expect(buyerDialog.getByRole('log')).toContainText('Sent during reconnect');
    await expect(buyerDialog.getByRole('textbox', { name: 'Tin nhắn', exact: true })).toHaveValue('Keep my draft after disconnect');
    // More than the old 5-second polling interval, with a real open conversation.
    await page.waitForTimeout(6200);
    expect(reads).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath('buyer-websocket-chat.png') });
    const detail = await (await page.request.get(`/api/orders/${order.id}`)).json();
    expect((await sellerContext.request.post(`/api/seller/items/${detail.items[0].id}/fulfill`, {
      headers, data: { secrets: ['WebSocket test delivery'] },
    })).ok()).toBeTruthy();
    const delivered = await (await page.request.get(`/api/orders/${order.id}`)).json();
    const warranty = await page.request.post(`/api/orders/${order.id}/warranty`, {
      headers, data: { key_ids: delivered.items[0].key_ids, message: 'Please help with the delivered product' },
    });
    expect(warranty.ok(), await warranty.text()).toBeTruthy();
    await Promise.all([page.goto('/support'), sellerPage.goto('/seller?tab=support')]);
    await page.getByRole('button', { name: /Xem trao đổi & trả lời/ }).first().click();
    await sellerPage.getByRole('button', { name: 'Xem trao đổi', exact: false }).first().click();
    const support = sellerPage.getByRole('dialog');
    await support.getByRole('textbox', { name: 'Phản hồi', exact: true }).fill('Seller support live message');
    await expect(support.getByRole('button', { name: 'Gửi phản hồi', exact: true })).toBeEnabled();
    await support.getByRole('button', { name: 'Gửi phản hồi', exact: true }).click();
    await expect(page.locator('.ticket-thread')).toContainText('Seller support live message');
    await page.getByRole('textbox', { name: 'Trả lời cửa hàng', exact: true }).fill('Buyer support live reply');
    await page.getByRole('button', { name: 'Gửi trả lời', exact: true }).click();
    await expect(support).toContainText('Buyer support live reply');
    const supportReads = reads.length;
    await page.waitForTimeout(6200);
    expect(reads.length).toBe(supportReads);
    expect(errors).toEqual([]);
  } finally { await sellerContext.close(); }
});

test('order chat shows ticket history before a slow socket snapshot and keeps the draft during catch-up', async ({ page, request }) => {
  await expect.poll(async () => {
    try { return (await (await request.get('/api/health')).json()).mode; }
    catch { return null; }
  }).toBe('demo');
  const now = new Date().toISOString(), itemId = crypto.randomUUID();
  const profile = { id: crypto.randomUUID(), name: 'Fast chat seller', seller_name: 'Fast chat shop', role: 'seller',
    balance: 0, seller_terms_version: SELLER_TERMS_VERSION, seller_terms_accepted_at: now };
  const initial = { name: 'Chat product', seller_name: profile.seller_name, order_number: 'CHAT-OPEN', order_status: 'processing',
    order_total: 10000, refund_amount: 10000, quantity: 1, variant_name: 'Standard', can_request: false,
    can_message: true, viewer_role: 'seller', dispute: null,
    messages: [{ id: 'first', body: 'History available before socket snapshot', role: 'customer', created_at: now }] };
  await page.route('**/api/me', route => route.fulfill({ json: profile }));
  await page.route('**/api/auth/refresh', route => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/seller/overview', route => route.fulfill({ json: {
    profile, products: [], withdrawals: [], ledger: [], held: 0, fee_bps: 700,
    sales: [{ id: itemId, name: initial.name, variant_name: initial.variant_name, price: 10000, quantity: 1, delivery: 'manual',
      order: { number: initial.order_number, status: 'processing', created_at: now, customer_note: '' } }],
  } }));
  await page.route('**/api/chat/live-ticket', route => {
    expect(route.request().postDataJSON().topic).toBe(`order:${itemId}`);
    return route.fulfill({ json: { ticket: 'preview-ticket', initial } });
  });
  let socket: WebSocketRoute | undefined;
  await page.routeWebSocket('**/api/chat/live', ws => { socket = ws; });
  await page.goto('/seller?tab=sales');
  await page.getByRole('button', { name: 'Chat', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('log')).toContainText(initial.messages[0].body);
  await expect(dialog.getByRole('status')).toHaveText('Đang kết nối lại chat…');
  const draft = dialog.getByRole('textbox', { name: 'Tin nhắn', exact: true });
  await draft.fill('Preserve my draft while connecting');
  await expect(dialog.getByRole('button', { name: 'Gửi tin nhắn', exact: true })).toBeDisabled();
  await expect.poll(() => !!socket).toBe(true);
  socket!.send(JSON.stringify({ type: 'snapshot', data: { ...initial,
    messages: [...initial.messages, { id: 'missed', body: 'Message received during handshake', role: 'customer', created_at: now }] } }));
  await expect(dialog.getByRole('status')).toHaveText('Đã kết nối chat trực tiếp');
  await expect(dialog.getByRole('log')).toContainText('Message received during handshake');
  await expect(draft).toHaveValue('Preserve my draft while connecting');
  await expect(dialog.getByRole('button', { name: 'Gửi tin nhắn', exact: true })).toBeEnabled();
});
