import test from 'node:test';
import assert from 'node:assert/strict';
import { socialMetadata, injectMetadata } from '../server/social-preview.js';
test('sharing uses absolute homepage and individual public product metadata', async () => {
  const store = { product: async () => ({ name: 'Steam <Gift>', slug: 'steam', active: true, image: '/images/products/steam-wallet.png', description: 'Steam wallet' }) };
  const home = await socialMetadata('/', 'https://keynest.store', store);
  assert.equal(home.image, 'https://keynest.store/images/share/keynest.jpg');
  const meta = await socialMetadata('/products/steam', 'https://keynest.store', store);
  assert.equal(meta.image, 'https://keynest.store/images/products/steam-wallet.png');
  assert.equal(meta.url, 'https://keynest.store/products/steam');
  const html = injectMetadata('<html><head><title>old</title><meta name="description" content="old"></head></html>', meta);
  assert.match(html, /Steam &lt;Gift&gt;/);
  assert.equal((html.match(/<title>/g) || []).length, 1);
  assert.match(html, /og:image/);
  assert.equal(await socialMetadata('/products/hidden', 'https://keynest.store', { product: async () => null }), null);
});
