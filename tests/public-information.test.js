import test from 'node:test';
import assert from 'node:assert/strict';
import { injectPublicInformation, publicInformation } from '../server/public-information.js';
import { privacy } from '../shared/legal-content.js';
import { socialMetadata } from '../server/social-preview.js';

test('public information is available in initial HTML without login or database', async () => {
  const template = '<html><body><div id="root"></div></body></html>';
  assert.match(injectPublicInformation(template, '/'), /KEYNEST là cửa hàng/);
  assert.match(injectPublicInformation(template, '/'), /href="\/privacy"/);
  for (const [heading] of privacy) assert.ok(publicInformation('/privacy').includes(heading));
  assert.match(publicInformation('/privacy/'), /Dữ liệu Google/);
  assert.equal(injectPublicInformation(template, '/account'), template);
  const metadata = await socialMetadata('/privacy', 'https://keynest.store', {});
  assert.equal(metadata.url, 'https://keynest.store/privacy');
  assert.match(metadata.title, /Chính sách bảo mật/);
});
