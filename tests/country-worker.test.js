import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../deploy/cloudflare-vietnam-worker.js';
import { publicInformation } from '../server/public-information.js';
function request(path = '/', country, method = 'GET') {
  const req = new Request('https://keynest.store' + path, { method, headers: { 'CF-IPCountry': 'VN' } });
  if (country) Object.defineProperty(req, 'cf', { value: { country } });
  return req;
}
test('social previews expose only public metadata and images without credentials', async t => {
  const origin = t.mock.method(globalThis, 'fetch', async req => {
    assert.equal(req.headers.get('Cookie'), null);
    assert.equal(req.headers.get('Authorization'), null);
    assert.equal(new URL(req.url).search, '');
    return new Response(req.url);
  });
  for (const bot of ['Discordbot', 'facebookexternalhit', 'Twitterbot', 'TelegramBot', 'WhatsApp', 'Zalo']) {
    for (const path of ['/', '/products/steam/']) {
      const req = request(path + '?private=value', 'US');
      req.headers.set('User-Agent', bot);
      req.headers.set('Cookie', 'session=secret');
      req.headers.set('Authorization', 'Bearer secret');
      const res = await worker.fetch(req);
      assert.equal(res.status, 200);
      assert.equal(await res.text(), 'https://keynest.store/share-preview' + (path === '/' ? '' : '/products/steam'));
    }
  }
  for (const path of ['/api/media/image.webp', '/images/share/keynest-v2.jpg', '/images/products/game.png']) {
    assert.equal((await worker.fetch(request(path, 'US'))).status, 200);
    assert.equal((await worker.fetch(request(path, 'US', 'POST'))).status, 403);
  }
  assert.equal(origin.mock.callCount(), 15);
  assert.equal((await worker.fetch(request('/products/steam', 'US'))).status, 403);
  assert.equal((await worker.fetch(request('/api/media/private.json', 'US'))).status, 403);
  assert.equal((await worker.fetch(request('/robots.txt', 'US'))).status, 200);
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

test('foreign visitors see the region UI at home; legal pages remain public', async t => {
  const origin = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected origin request'); });
  const home = await worker.fetch(request('/', 'US'));
  assert.equal(home.status, 403);
  assert.match(await home.text(), /Khu vực chưa được hỗ trợ/);
  assert.match(home.headers.get('X-Robots-Tag'), /noindex, nofollow/);
  const head = await worker.fetch(request('/', 'US', 'HEAD'));
  assert.equal(head.status, 403);
  assert.equal(await head.text(), '');
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
  const blocked = ['/api', '/api/config', '/api/products', '/api/categories', '/api/banners', '/api/promotions', '/api/announcements', '/api/me', '/api/auth/refresh', '/api/admin/products', '/api/orders', '/api/wallet', '/account', '/assets/index.js', '/share-preview'];
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
