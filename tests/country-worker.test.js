import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../deploy/cloudflare-vietnam-worker.js';
import { publicInformation } from '../server/public-information.js';
function request(path = '/', country, method = 'GET') {
  const req = new Request('https://keynest.store' + path, { method, headers: { 'CF-IPCountry': 'VN' } });
  if (country) Object.defineProperty(req, 'cf', { value: { country } });
  return req;
}
test('foreign storefront visits show the region screen without reaching origin or offering registration', async t => {
  const origin = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected origin request'); });
  for (const path of ['/', '/catalog', '/products/steam', '/robots.txt', '/sitemap.xml', '/assets/index.js', '/api/products', '/api/products?live=1']) {
    const req = request(path, 'US');
    req.headers.set('Cookie', 'session=secret');
    req.headers.set('Authorization', 'Bearer secret');
    const response = await worker.fetch(req);
    assert.equal(response.status, 403);
    if (!path.startsWith('/api')) assert.match(await response.text(), /KEYNEST hiện chỉ hoạt động tại Việt Nam/);
    assert.equal((await worker.fetch(request(path, 'US', 'POST'))).status, 403);
  }
  assert.equal((await worker.fetch(request('/api/me', 'US'))).status, 403);
  assert.equal(origin.mock.callCount(), 0);
});

test('region status comes from edge country metadata, never spoofed headers, query or cached origin', async t => {
  const origin = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected origin request'); });
  for (const country of ['VN', 'US', 'SG', 'XX', undefined]) {
    const response = await worker.fetch(request('/api/region?country=VN', country));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { allowed: country === 'VN' });
    assert.match(response.headers.get('Cache-Control'), /no-store/);
    assert.equal(response.headers.get('X-Keynest-Region-Worker'), 'vietnam-region-v6');
  }
  assert.equal(await (await worker.fetch(request('/api/region', 'US', 'HEAD'))).text(), '');
  assert.equal((await worker.fetch(request('/api/region', 'US', 'POST'))).status, 403);
  assert.equal(origin.mock.callCount(), 0);
});

test('foreign and unknown countries receive standalone 403; spoofed country header is ignored', async () => {
  for (const country of ['US','SG','XX',undefined]) {
    const res = await worker.fetch(request('/account', country));
    assert.equal(res.status, 403);
    assert.match(await res.text(), /KEYNEST hiện chỉ hoạt động tại Việt Nam/);
    assert.match(res.headers.get('Cache-Control'), /no-store/);
  }
  const api = await worker.fetch(request('/api/me', 'US'));
  assert.equal((await api.json()).code, 'REGION_RESTRICTED');
  assert.equal(await (await worker.fetch(request('/account', 'US', 'HEAD'))).text(), '');
});

test('legal pages remain public while private endpoints stay restricted', async t => {
  const origin = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected origin request'); });
  for (const path of ['/privacy', '/privacy/', '/terms', '/terms/']) {
    const res = await worker.fetch(request(path, 'US'));
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /KEYNEST/);
    assert.ok(html.includes(publicInformation(path)), 'Generated public copy must match current policies');
    assert.doesNotMatch(html, /<script|<link|<img/i);
    assert.equal(await (await worker.fetch(request(path, 'US', 'HEAD'))).text(), '');
    assert.equal((await worker.fetch(request(path, 'US', 'POST'))).status, 403);
  }
  const blocked = ['/api', '/api/me', '/api/auth/refresh', '/api/admin/products', '/api/orders', '/api/wallet', '/account', '/share-preview'];
  for (const path of blocked) {
    for (const method of ['GET', 'HEAD', 'POST', 'OPTIONS']) {
      const req = request(path, 'US', method);
      req.headers.set('User-Agent', 'facebookexternalhit Googlebot');
      assert.equal((await worker.fetch(req)).status, 403, method + ' ' + path);
    }
  }
  assert.equal(origin.mock.callCount(), 0);
});
test('Vietnam requests and exact payment POST webhooks reach origin, no broad path exemption', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('origin'); });
  for (const req of [request('/account','VN'), request('/api/webhooks/pay2s','US','POST'), request('/api/webhooks/sepay','US','POST')])
    assert.equal(await (await worker.fetch(req)).text(), 'origin');
  for (const req of [request('/api/webhooks/pay2s','US'), request('/api/webhooks/pay2s/anything','US','POST'), request('/api/me?country=VN','US')])
    assert.equal((await worker.fetch(req)).status, 403);
  assert.equal(calls,3);
});
