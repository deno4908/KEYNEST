import { withLegalConsent } from './helpers/legal.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createSellers } from '../server/sellers.js';
import { SELLER_TERMS_VERSION } from '../shared/seller-terms.js';

process.env.APP_MODE = 'demo';
process.env.NODE_ENV = 'test';
const dir = mkdtempSync(join(tmpdir(), 'keynest-admin-notices-'));
process.env.DEMO_DATA_PATH = join(dir, 'store.json');
const { app, store } = await import('../server/index.js');
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;
async function req(path, cookie = '', body) {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173', 'X-App-Request': 'keynest', Cookie: cookie },
    ...(body ? { body: JSON.stringify(withLegalConsent(path, body)) } : {}),
  });
  return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control'),
    cookie: response.headers.getSetCookie().map(v => v.split(';')[0]).join('; ') };
}

test('admin operational inbox persists events, counts all unread and isolates read receipts', async t => {
  t.after(() => {
    server.close();
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep + 'keynest-admin-notices-'));
    rmSync(dir, { recursive: true, force: true });
  });
  const admin = await req('/auth/login', '', { email: 'admin@keynest.local', password: 'Admin123!' });
  const buyer = await req('/auth/login', '', { email: 'student@keynest.local', password: 'Student123!' });
  const adminId = (await req('/me', admin.cookie)).body.id;
  const buyerId = (await req('/me', buyer.cookie)).body.id;
  const second = store.register('second-admin@example.test', 'AdminOther123!', 'Second Admin');
  store.db.users.find(u => u.id === second.id).role = 'admin';
  const secondLogin = await req('/auth/login', '', { email: second.email, password: 'AdminOther123!' });
  const suspended = store.register('suspended-admin@example.test', 'AdminOther123!', 'Suspended Admin');
  store.db.users.find(u => u.id === suspended.id).role = 'admin';
  store.db.account_controls.push({ user_id: suspended.id, suspended: true });
  const ticket = await req('/tickets', buyer.cookie, { subject: 'Purchase support', message: 'Please help with this purchase.' });
  assert.equal(ticket.status, 201);
  const ticketKey = `admin:ticket:${ticket.body.id}:${adminId}`;
  let inbox = await req('/notifications?page_size=100', admin.cookie);
  assert.match(inbox.cache, /no-store/);
  assert.equal(inbox.body.unread_count, 1);
  assert.equal(inbox.body.unread_order_count, 0);
  assert.equal(inbox.body.items[0].id, ticketKey);
  assert.equal(inbox.body.items[0].href, `/admin?tab=tickets&ticket=${ticket.body.id}`);
  assert.equal((await req('/notifications', buyer.cookie)).body.items.some(n => n.id.startsWith('admin:')), false);
  assert.equal((await req('/notifications/read', buyer.cookie, { id: ticketKey })).status, 404);
  assert.equal((await req('/notifications/read', admin.cookie, { id: ticketKey })).status, 200);
  assert.equal((await req('/notifications', admin.cookie)).body.unread_count, 0);
  assert.equal((await req('/notifications', secondLogin.cookie)).body.unread_count, 1);
  assert.equal((await req(`/tickets/${ticket.body.id}/messages`, buyer.cookie, { body: 'More information from buyer' })).status, 201);
  assert.equal((await req('/notifications', admin.cookie)).body.unread_count, 1);

  const product = store.saveProduct({ slug: 'notification-preorder', name: 'Upcoming product', category: 'game', platform: 'PC', active: true });
  store.saveVariant(product.id, { name: 'Preorder', price: 10000, original_price: 10000, delivery: 'manual', stock: 5, is_preorder: true, expected_delivery: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), region: 'Global' });
  const variant = product.variants[0];
  const payload = { items: [{ variant_id: variant.id, quantity: 1 }], method: 'sepay', coupon: '', customer_note: '' };
  const key = randomUUID();
  const order = store.createOrder(buyerId, payload, key);
  store.createOrder(buyerId, payload, key);
  const payment = store.db.payments.find(p => p.order_id === order.id);
  store.settle('notification-order-payment', payment.code, payment.amount);
  const walletOrder = store.createOrder(buyerId, { ...payload, method: 'wallet' }, randomUUID());
  const seller = store.register('notice-seller@example.test', 'Seller123!', 'Notice Seller');
  Object.assign(store.db.users.find(u => u.id === seller.id), { role: 'seller', seller_terms_version: SELLER_TERMS_VERSION, seller_terms_accepted_at: new Date().toISOString(), balance: 100000 });
  store.saveProduct({ slug: 'seller-notice', name: 'Seller awaiting approval', category: 'game', platform: 'PC', seller_id: seller.id, active: true });
  await createSellers(store).command(seller.id, 'withdraw', { amount: 50000, bank: 'LAB', account_number: 'PRIVATE-ACCOUNT', account_name: 'Seller' });
  store.settle('notification-unmatched-payment', 'UNKNOWN', 50000);
  // The refund workflow itself is covered in the database and seller suites;
  // exercise its persisted demo event through the normal save boundary here.
  store.db.seller_disputes ||= [];
  store.db.seller_disputes.push({ item_id: order.items[0].id, status: 'open', created_at: new Date().toISOString() });
  store.save();
  const expected = [
    `preorder:${order.id}`, `order-paid:${order.id}`, `order-paid:${walletOrder.id}`,
    'payment-review:' + createHash('md5').update('notification-unmatched-payment').digest('hex'),
    `dispute:${order.items[0].id}`,
  ];
  inbox = await req('/notifications?page_size=100', admin.cookie);
  for (const key of expected) assert.equal(inbox.body.items.filter(n => n.id === `admin:${key}:${adminId}`).length, 1, key);
  assert.ok(inbox.body.items.some(n => n.id.startsWith('admin:withdrawal:')));
  assert.ok(inbox.body.items.some(n => n.id.startsWith('admin:product-review:')));
  assert.ok(!JSON.stringify(inbox.body).includes('PRIVATE-ACCOUNT'));
  assert.equal(store.db.notifications.filter(n => n.user_id === suspended.id).length, 0);
  assert.equal((await req('/notifications/read', admin.cookie, { all: true })).status, 200);
  assert.equal((await req('/notifications', admin.cookie)).body.unread_count, 0);
  store.save();
  assert.equal((await req('/notifications', admin.cookie)).body.unread_count, 0);
  const persisted = JSON.parse(readFileSync(store.path, 'utf8'));
  assert.ok(persisted.notifications.filter(n => n.user_id === adminId).every(n => n.read_at));
  assert.ok((await req('/notifications', secondLogin.cookie)).body.unread_count > 0);
});
