import test from 'node:test';
import assert from 'node:assert/strict';
import { socialMetadata, injectMetadata } from '../server/social-preview.js';
test('canonical paths and product offers are safe and reflect available variants', async () => {
  const origin = 'https://keynest.store';
  const store = { product: async () => ({ name: '</script><script>bad</script>', slug: 'test', active: true,
    variants: [{ name: 'Shared', price: 50000, stock: 0, unlimited: true }, { name: 'Hidden', price: 1, active: false }] }) };
  assert.equal((await socialMetadata('/catalog/', origin, store)).url, origin + '/catalog');
  assert.equal((await socialMetadata('/orders/123', origin, store)).noindex, true);
  const meta = await socialMetadata('/products/test/', origin, store);
  assert.equal(meta.structuredData.offers.length, 1);
  assert.equal(meta.structuredData.offers[0].availability, 'https://schema.org/InStock');
  assert.equal(meta.structuredData.offers[0].priceCurrency, 'VND');
  assert.doesNotMatch(injectMetadata('<head></head>', meta), /<script>bad/);
});
test('sharing uses absolute homepage and individual public product metadata', async () => {
  const store = { product: async () => ({ name: 'Steam <Gift>', slug: 'steam', active: true, image: '/images/products/steam-wallet.png', description: 'Steam wallet' }) };
  const home = await socialMetadata('/', 'https://keynest.store', store);
  assert.equal(home.image, 'https://keynest.store/images/share/keynest-v2.jpg');
  assert.equal(home.imageWidth, 1200);
  assert.equal(home.imageHeight, 630);
  assert.match(injectMetadata('<head></head>', home), /og:image:width" content="1200"/);
  const meta = await socialMetadata('/products/steam', 'https://keynest.store', store);
  assert.equal(meta.image, 'https://keynest.store/images/products/steam-wallet.png');
  assert.equal(meta.url, 'https://keynest.store/products/steam');
  const html = injectMetadata('<html><head><title>old</title><meta name="description" content="old"></head></html>', meta);
  assert.match(html, /Steam &lt;Gift&gt;/);
  assert.equal((html.match(/<title>/g) || []).length, 1);
  assert.match(html, /og:image/);
  assert.equal(await socialMetadata('/products/hidden', 'https://keynest.store', { product: async () => null }), null);
});
