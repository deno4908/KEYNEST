import { withLegalConsent } from './helpers/legal.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.APP_MODE = 'demo';
const dir = mkdtempSync(join(tmpdir(), 'keynest-authz-'));
process.env.DEMO_DATA_PATH = join(dir, 'store.json');
const { app, store } = await import('../server/index.js');

test('every registered admin endpoint rejects anonymous and customer access', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => {
    server.close();
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep + 'keynest-authz-'));
    rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, method = 'GET', cookie = '', body) {
    return fetch(base + path, {
      method,
      headers: { Origin: 'http://127.0.0.1:5173', 'X-App-Request': 'keynest',
        'Content-Type': 'application/json', Cookie: cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(withLegalConsent(path, body)) }),
    });
  }
  const login = await request('/api/auth/login', 'POST', '', {
    email: 'student@keynest.local', password: 'Student123!',
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map((s) => s.split(';')[0]).join('; ');
  const routes = new Map();
  function collect(stack) {
    for (const layer of stack) {
      if (layer.route) {
        for (let path of [layer.route.path].flat()) {
          if (path.startsWith('/admin/')) path = '/api' + path;
          if (!path.startsWith('/api/admin/')) continue;
          for (const method of Object.keys(layer.route.methods)) {
            routes.set(`${method} ${path}`, { method: method.toUpperCase(), path });
          }
        }
      } else if (layer.handle?.stack) collect(layer.handle.stack);
    }
  }
  collect(app.router.stack);
  assert.ok(routes.size >= 25, `Expected admin route coverage, found ${routes.size}`);
  const before = JSON.stringify(store.db);
  for (const { method, path } of routes.values()) {
    const url = path.replace(/:[a-z_]+/gi, '00000000-0000-4000-8000-000000000001');
    const payload = method === 'GET' ? undefined : {};
    assert.equal((await request(url, method, '', payload)).status, 401, `${method} ${path}: anonymous`);
    assert.equal((await request(url, method, cookie, payload)).status, 403, `${method} ${path}: customer`);
  }
  // Authentication may record session activity; sensitive business data must not change.
  const snapshot = JSON.parse(before);
  for (const key of ['users', 'products', 'orders', 'coupons', 'inventory', 'tickets']) {
    assert.deepEqual(store.db[key], snapshot[key], `Unauthorised requests changed ${key}`);
  }
  t.diagnostic(`Checked ${routes.size} admin method/path combinations with both roles`);
  for (const body of [{ role: 'admin' }, { balance: 999999999 }, { id: 'another-user' }]) {
    assert.equal((await request('/api/me', 'PATCH', cookie, body)).status, 400);
  }
  assert.equal((await request('/api/auth/register', 'POST', '', {
    email: 'forged@example.test', password: 'Customer123!', name: 'Forged', role: 'admin',
  })).status, 400);
  const me = await (await request('/api/me', 'GET', cookie)).json();
  assert.equal(me.role, 'customer');
  const forgedCookie = cookie.replace(/kn_session=[^;]+/, 'kn_session=forged-admin-session');
  assert.equal((await request('/api/admin/overview', 'GET', forgedCookie)).status, 401);
});
