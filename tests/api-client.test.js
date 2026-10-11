import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function client() {
  const source = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}#${Math.random()}`);
}
const response = (body, status = 200, token) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Access-Token': token } : {}) },
});

test('public storefront loads without waiting for a slow session refresh', async t => {
  let release;
  let privateRequests = 0;
  const gate = new Promise(resolve => { release = resolve; });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === '/api/auth/refresh') { await gate; return response({ ok: true }, 200, 'session'); }
    if (url === '/api/me') {
      privateRequests++;
      assert.equal(options.headers.get('Authorization'), 'Bearer session');
    }
    return response({ ok: true });
  });
  const { api } = await client();
  const me = api('/me');
  try {
    await Promise.all(['/config', '/products', '/categories', '/catalog?q=test'].map(path => api(path)));
    assert.equal(privateRequests, 0);
  } finally { release(); }
  await me;
  assert.equal(privateRequests, 1);
});

test('frontend shares bootstrap refresh and attaches Bearer to parallel API requests', async t => {
  let refreshes = 0, calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === '/api/auth/refresh') {
      refreshes++;
      assert.equal(options.method, 'POST');
      assert.equal(options.credentials, 'same-origin');
      assert.equal(options.headers['X-App-Request'], 'keynest');
      return response({ ok: true }, 200, 'token-one');
    }
    calls++;
    assert.equal(options.headers.get('Authorization'), 'Bearer token-one');
    return response({ ok: true });
  });
  const { api } = await client();
  await Promise.all(Array.from({ length: 10 }, () => api('/me')));
  assert.equal(refreshes, 1);
  assert.equal(calls, 10);
});

test('frontend renews expired access once and preserves request body/idempotency key', async t => {
  let refreshes = 0, writes = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === '/api/auth/refresh') return response({ ok: true }, 200, ++refreshes === 1 ? 'expired' : 'renewed');
    assert.equal(options.body, '{"quantity":1}');
    assert.equal(options.headers.get('Idempotency-Key'), 'same-key');
    writes++;
    if (options.headers.get('Authorization') === 'Bearer expired') return response({ code: 'AUTH_REQUIRED' }, 401);
    assert.equal(options.headers.get('Authorization'), 'Bearer renewed');
    return response({ ok: true });
  });
  const { post } = await client();
  await post('/orders', { quantity: 1 }, { 'Idempotency-Key': 'same-key' });
  assert.equal(writes, 2);
  assert.equal(refreshes, 2);
});

test('frontend accepts elevated token, clears it on logout and does not retry business errors', async t => {
  let refreshes = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === '/api/auth/refresh') { refreshes++; return response({ ok: true }, 200, 'initial'); }
    if (url === '/api/auth/mfa/verify') return response({ success: true }, 200, 'elevated');
    if (url === '/api/me/password') return response({ error: 'Wrong password' }, 401);
    if (url === '/api/auth/logout') {
      assert.equal(options.headers.get('Authorization'), 'Bearer elevated');
      return response({ ok: true });
    }
    assert.equal(options.headers.has('Authorization'), false);
    return response({ ok: true });
  });
  const { api, post } = await client();
  await post('/auth/mfa/verify');
  await assert.rejects(post('/me/password'), /Wrong password/);
  await post('/auth/logout');
  await api('/config');
  assert.equal(refreshes, 1);
});

test('frontend does not loop on rejected access tokens', async t => {
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    attempts++;
    return url === '/api/auth/refresh' ? response({ ok: true }, 200, 'rejected') : response({ error: 'Denied', code: 'AUTH_REQUIRED' }, 401);
  });
  const { api } = await client();
  await assert.rejects(api('/me'), /Denied/);
  assert.equal(attempts, 4);
});
