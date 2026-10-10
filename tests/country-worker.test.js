import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../deploy/cloudflare-vietnam-worker.js';
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
