import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { accountLegal, orderLegal } from './helpers/legal.js';
import { LEGAL_VERSION, terms, privacy } from '../shared/legal-content.js';
import { consentProof } from '../server/legal-consent.js';
import { orderContract } from '../server/order-contract.js';

process.env.NODE_ENV = 'test';
process.env.APP_MODE = 'demo';
process.env.KAFKA_ENABLED = 'false';
process.env.REDIS_ENABLED = 'false';
const directory = mkdtempSync(join(tmpdir(), 'keynest-consent-'));
process.env.DEMO_DATA_PATH = join(directory, 'store.json');
const { app, store } = await import('../server/index.js');

test('real registration/checkout reject missing, false or stale consent without creating users or moving funds; accepted proof survives retry and download', async t => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'keynest-consent-'));
    rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const headers = { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173', 'X-App-Request': 'keynest' };
  const request = (path, body, Cookie = '', key = randomUUID()) => fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...headers, Cookie, 'Idempotency-Key': key },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const registration = { email: 'consent@example.test', name: 'Consent Member', password: 'ConsentPass123!' };
  const usersBefore = store.db.users.length;
  for (const legal of [undefined, { ...accountLegal, terms: false }, { ...accountLegal, account_data: false }, { ...accountLegal, version: 'old' }]) {
    const response = await request('/auth/register', { ...registration, legal });
    assert.equal(response.status, legal?.version === 'old' ? 409 : 400);
    assert.equal(response.headers.getSetCookie().length, 0);
    assert.equal(store.db.users.length, usersBefore);
  }
  const registered = await request('/auth/register', { ...registration, legal: accountLegal });
  assert.equal(registered.status, 200);
  const memberCookie = registered.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  const member = store.db.users.find(u => u.email === registration.email);
  assert.equal(member.legal_acceptance.version, LEGAL_VERSION);
  assert.ok(Number.isFinite(Date.parse(member.legal_acceptance.accepted_at)));
  const login = await request('/auth/login', { email: 'student@keynest.local', password: 'Student123!' });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  const buyer = store.db.users.find(u => u.email === 'student@keynest.local');
  buyer.balance = 1000000;
  const variant = store.products().flatMap(p => p.variants).find(v => v.delivery === 'key' && v.stock > 0 && !v.is_preorder);
  const payload = { items: [{ variant_id: variant.id, quantity: 1 }], method: 'wallet', coupon: '', customer_note: '' };
  const snapshot = JSON.stringify({ balance: buyer.balance, orders: store.db.orders, inventory: store.db.inventory });
  for (const legal of [undefined, { ...orderLegal, terms: false }, { ...orderLegal, version: 'old' }, { ...orderLegal, accepted_at: 'forged' }]) {
    const response = await request('/orders', { ...payload, legal }, cookie);
    assert.equal(response.status, legal?.version === 'old' ? 409 : 400);
    assert.equal(JSON.stringify({ balance: buyer.balance, orders: store.db.orders, inventory: store.db.inventory }), snapshot);
  }
  const key = randomUUID();
  const first = await request('/orders', { ...payload, legal: orderLegal }, cookie, key);
  assert.equal(first.status, 201);
  const order = await first.json();
  const balance = buyer.balance;
  const retry = await request('/orders', { ...payload, legal: orderLegal }, cookie, key);
  assert.equal(retry.status, 201);
  assert.equal((await retry.json()).id, order.id);
  assert.equal(buyer.balance, balance);
  const stored = store.db.orders.find(o => o.id === order.id);
  const proof = JSON.parse(stored.fingerprint).legal;
  assert.deepEqual(proof, consentProof(orderLegal, 'order'));
  const download = await request(`/orders/${order.id}/contract`, undefined, cookie);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('Cache-Control'), /no-store/);
  const document = (await download.json()).document;
  assert.ok(document.includes(LEGAL_VERSION));
  assert.ok(document.includes(stored.created_at));
  assert.ok(document.includes(terms[0][1]));
  for (const value of order.items.flatMap(item => item.keys)) assert.ok(!document.includes(value));
  assert.equal((await request(`/orders/${order.id}/contract`, undefined, memberCookie)).status, 404);
  assert.equal((await request(`/orders/${order.id}/contract`)).status, 401);
});

test('published policy archive matches the accepted version and legacy/tampered orders never acquire invented consent', () => {
  const archive = JSON.parse(readFileSync(new URL('../shared/legal-archive/2026-11-06-v1.json', import.meta.url), 'utf8'));
  assert.equal(archive.version, LEGAL_VERSION);
  assert.deepEqual(archive.terms, terms);
  assert.deepEqual(archive.privacy, privacy);
  const order = { id: 'legacy', number: 'old', created_at: '2020-01-01', items: [] };
  assert.equal(orderContract(order, {}).version, null);
  assert.throws(() => orderContract({ ...order, fingerprint: { legal: { ...consentProof(orderLegal, 'order'), terms_sha256: 'forged' } } }, {}));
});
