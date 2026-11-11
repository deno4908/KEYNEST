import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { apiAccessGuard } from '../server/api-access.js';

test('unlisted API routes require authentication and admin routes also require permission', async t => {
  const app = express();
  app.use('/api', apiAccessGuard({
    auth(req, res, next) {
      if (!['customer', 'admin'].includes(req.headers.authorization)) return res.sendStatus(401);
      req.user = { role: req.headers.authorization };
      next();
    },
    admin(req, res, next) { return req.user.role === 'admin' ? next() : res.sendStatus(403); },
  }));
  // A newly introduced handler has no local auth middleware: default guard must protect it.
  app.use('/api', (req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const request = (path, method = 'GET', role = '') => fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
    method, headers: { Authorization: role },
  });
  for (const path of ['/future-resource', '/me', '/orders/one', '/wallet', '/tickets/one/messages', '/seller/products', '/products/one/private']) {
    assert.equal((await request(path)).status, 401, path);
    assert.equal((await request(path, 'GET', 'forged')).status, 401, path);
    assert.equal((await request(path, 'POST')).status, 401, path);
    assert.equal((await request(path, 'GET', 'customer')).status, 200, path);
  }
  for (const path of ['/admin/future-resource', '/ADMIN/future-resource/']) {
    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, 'GET', 'customer')).status, 403);
    assert.equal((await request(path, 'GET', 'admin')).status, 200);
  }
  for (const path of ['/config', '/catalog', '/products/one', '/products/one/reviews', '/categories', '/media/image.webp']) {
    assert.equal((await request(path)).status, 200);
    assert.equal((await request(path, 'HEAD')).status, 200);
    assert.equal((await request(path, 'POST')).status, 401);
  }
  for (const path of ['/auth/login', '/auth/register', '/auth/forgot', '/auth/reset', '/auth/reset/verify', '/auth/login-recovery/send', '/auth/login-recovery/verify', '/webhooks/pay2s']) {
    assert.equal((await request(path, 'POST')).status, 200);
    assert.equal((await request(path, 'DELETE')).status, 401);
  }
});
