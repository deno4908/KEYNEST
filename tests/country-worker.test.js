import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../deploy/cloudflare-vietnam-worker.js';
test('robots.txt remains available to foreign crawlers before preview lookup', async () => {
  const response = await worker.fetch(new Request('https://keynest.store/robots.txt'));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Allow: \/\n/);
  assert.equal(response.headers.get('X-Keynest-Region-Worker'), 'social-preview-v2');
});
test('foreign social agents get metadata only and never customer APIs', async t => {
  t.mock.method(globalThis, 'fetch', async req => new Response(req.url));
  const req = new Request('https://keynest.store/products/steam', { headers: { 'User-Agent': 'facebookexternalhit/1.1', Cookie: 'private=value' } });
  assert.equal(await (await worker.fetch(req)).text(), 'https://keynest.store/share-preview/products/steam');
  assert.equal((await worker.fetch(new Request('https://keynest.store/api/me', { headers: { 'User-Agent': 'facebookexternalhit/1.1' } }))).status, 403);
});
function request(path = '/', country, method = 'GET') {
  const req = new Request('https://keynest.store' + path, { method, headers: { 'CF-IPCountry': 'VN' } });
  if (country) Object.defineProperty(req, 'cf', { value: { country } });
  return req;
}
test('foreign and unknown countries receive standalone 403; spoofed country header is ignored', async () => {
  for (const country of ['US','SG','XX',undefined]) {
    const res = await worker.fetch(request('/', country));
    assert.equal(res.status, 403);
    assert.match(await res.text(), /KEYNEST hiện chỉ hoạt động tại Việt Nam/);
    assert.match(res.headers.get('Cache-Control'), /no-store/);
  }
  const api = await worker.fetch(request('/api/me', 'US'));
  assert.equal((await api.json()).code, 'REGION_RESTRICTED');
  assert.equal(await (await worker.fetch(request('/', 'US', 'HEAD'))).text(), '');
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
