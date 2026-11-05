import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApiLimits } from '../server/rate-limits.js';

async function fixture(t) {
  const app = express();
  const limits = createApiLimits();
  let parsed = 0;
  app.use('/api', limits.early);
  app.use(express.json({ limit: '100kb', inflate: false, verify: () => { parsed++; } }));
  // Test auth maps fixed session credentials to identities. User IDs/XFF in
  // arbitrary headers/bodies must never be used by the limiter as identity.
  app.use((req, res, next) => {
    const id = { 'session-a': 'a', 'session-b': 'b' }[req.headers.authorization];
    if (id) req.user = { id };
    next();
  });
  app.use('/api', limits.authenticated);
  app.use('/api', (req, res) => {
    if (req.path.toLowerCase().startsWith('/webhooks/')) return res.sendStatus(401);
    res.json({ ok: true });
  });
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.type }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return {
    parsed: () => parsed,
    request: (path, { method = 'POST', user = 'a', body = '{}', headers = {} } = {}) => fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `session-${user}`, ...headers },
      ...(['GET', 'HEAD'].includes(method) ? {} : { body }),
    }),
  };
}

async function limited(response) {
  assert.equal(response.status, 429);
  const body = await response.json();
  assert.equal(body.code, 'RATE_LIMITED');
  assert.ok(body.retry_after > 0);
  assert.equal(Number(response.headers.get('Retry-After')), body.retry_after);
  assert.ok(response.headers.get('RateLimit'));
}

test('login throttle runs before JSON parsing and cannot be reset with XFF or a forged user ID', async t => {
  const { request, parsed } = await fixture(t);
  for (let i = 0; i < 20; i++) {
    assert.equal((await request('/auth/login', { user: `forged-${i}`,
      headers: { 'X-Forwarded-For': `198.51.100.${i + 1}`, 'X-User-ID': `user-${i}` },
    })).status, 200);
  }
  assert.equal(parsed(), 20);
  await limited(await request('/AUTH/LOGIN/', { body: '{malformed', headers: { 'X-User-ID': 'another-user' } }));
  assert.equal(parsed(), 20);
  assert.equal((await request('/auth/logout')).status, 200);
  assert.equal((await request('/auth/refresh')).status, 200);
  assert.equal((await request('/auth/mfa/status', { method: 'GET' })).status, 200);
});

test('registration and forgot-password have separate tighter budgets', async t => {
  const { request } = await fixture(t);
  for (let i = 0; i < 5; i++) assert.equal((await request('/auth/register')).status, 200);
  await limited(await request('/AUTH/REGISTER/'));
  // Registration exhaustion must not lock out password login or recovery.
  assert.equal((await request('/auth/login')).status, 200);
  for (let i = 0; i < 5; i++) assert.equal((await request('/auth/forgot')).status, 200);
  await limited(await request('/AUTH/FORGOT/'));
});

test('recovery verification and reset share a budget that cannot be reset by switching endpoints', async t => {
  const { request } = await fixture(t);
  for (let i = 0; i < 10; i++) {
    assert.equal((await request(i % 2 ? '/auth/reset' : '/auth/reset/verify')).status, 200);
  }
  await limited(await request('/AUTH/RESET/VERIFY/'));
  assert.equal((await request('/auth/login')).status, 200);
});

test('withdrawal budget spans IDs and casing, isolates verified users behind one IP, ignores forged IDs', async t => {
  const { request } = await fixture(t);
  for (let i = 0; i < 5; i++) assert.equal((await request('/seller/withdrawals')).status, 200);
  await limited(await request('/SELLER/WITHDRAWALS/', { headers: { 'X-User-ID': 'b' }, body: '{"user_id":"b"}' }));
  assert.equal((await request('/seller/withdrawals', { user: 'b' })).status, 200);
  assert.equal((await request('/seller/overview', { method: 'GET' })).status, 200);
});

test('financial admin actions share one budget, while profile and general admin writes remain separate', async t => {
  const { request } = await fixture(t);
  for (let i = 0; i < 10; i++) {
    const paths = [`/admin/orders/${i}/refund`, `/admin/reconcile/${i}`, `/admin/sellers/withdrawals/${i}`];
    assert.equal((await request(paths[i % paths.length])).status, 200);
  }
  await limited(await request('/ADMIN/ORDERS/new-id/REFUND/'));
  assert.equal((await request('/admin/products')).status, 200);
  assert.equal((await request('/me', { method: 'PATCH' })).status, 200);
  assert.equal((await request('/admin/orders/new-id/refund', { user: 'b' })).status, 200);
});

test('payment status allows normal QR polling, shares quota across IDs and counts HEAD', async t => {
  const { request } = await fixture(t);
  for (let i = 0; i < 60; i++) {
    assert.equal((await request(`/payments/${i}`, { method: i % 2 ? 'HEAD' : 'GET' })).status, 200);
  }
  await limited(await request('/PAYMENTS/another-id/', { method: 'GET' }));
  assert.equal((await request('/payments/another-id', { method: 'GET', user: 'b' })).status, 200);
  assert.equal((await request('/auth/logout')).status, 200);
});

test('early IP budget bounds auth work even when the attacker rotates valid accounts', async t => {
  const { request, parsed } = await fixture(t);
  for (let i = 0; i < 30; i++) {
    // General middleware has not authenticated the caller yet.
    await request('/seller/withdrawals', { user: i % 2 ? 'a' : 'b' });
  }
  assert.equal(parsed(), 30);
  await limited(await request('/seller/withdrawals', { user: 'b', body: '{invalid' }));
  assert.equal(parsed(), 30);
});

test('general exhaustion leaves session control and authenticated webhooks in independent buckets', async t => {
  const { request, parsed } = await fixture(t);
  for (let i = 0; i < 240; i++) assert.equal((await request('/unknown', { body: '{invalid' })).status, 400);
  assert.equal(parsed(), 240);
  await limited(await request('/unknown', { body: '{invalid' }));
  assert.equal(parsed(), 240);
  for (const path of ['/auth/logout', '/auth/refresh', '/auth/mfa/verify', '/auth/admin-otp/verify']) {
    assert.equal((await request(path)).status, 200);
  }
  assert.equal((await request('/auth/admin-otp/status', { method: 'GET' })).status, 200);
  // Rate-limit separation must not turn webhook credentials into optional input.
  assert.equal((await request('/webhooks/pay2s')).status, 401);
  assert.equal((await request('/WEBHOOKS/SEPAY/')).status, 401);
  await limited(await request('/webhooks/pay2s', { method: 'GET' }));
});

test('fixed windows expire and storage errors fail closed before business work', async t => {
  const app = express();
  const { limiter } = createApiLimits();
  app.get('/short', limiter(1, 1000, 'short-window'), (req, res) => res.sendStatus(200));
  let business = 0;
  const unavailable = createApiLimits({ rateStore: () => ({
    init() {}, increment: async () => { throw new Error('storage unavailable'); },
    decrement() {}, resetKey() {},
  }) });
  app.use('/api', unavailable.early, (req, res) => { business++; res.sendStatus(200); });
  app.use((err, req, res, next) => res.sendStatus(503));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/short')).status, 200);
  assert.equal((await fetch(base + '/short')).status, 429);
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal((await fetch(base + '/short')).status, 200);
  assert.equal((await fetch(base + '/api/orders')).status, 503);
  assert.equal(business, 0);
});
