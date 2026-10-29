import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createMediaCache } from '../server/media-cache.js';

test('public image downloads coalesce and survive application restart on VPS disk', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'keynest-media-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let downloads = 0;
  const load = async () => { downloads++; await new Promise(r => setTimeout(r, 10)); return Buffer.from('image'); };
  const first = createMediaCache({ directory, load });
  const file = `${randomUUID()}.webp`;
  const images = await Promise.all(Array.from({ length: 10 }, () => first(file)));
  assert.ok(images.every(b => b.equals(Buffer.from('image'))));
  assert.equal(downloads, 1);
  const restarted = createMediaCache({ directory, load });
  assert.equal((await restarted(file)).toString(), 'image');
  assert.equal(downloads, 1);
  await assert.rejects(first('../secret.webp'));
  assert.equal(downloads, 1);
});

test('media cache evicts to its disk budget and retries failed origin downloads', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'keynest-media-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let fail = true, downloads = 0;
  const get = createMediaCache({ directory, maxBytes: 10, load: async () => {
    downloads++; if (fail) throw new Error('unavailable'); return Buffer.alloc(6);
  } });
  const a = `${randomUUID()}.webp`, b = `${randomUUID()}.webp`;
  await assert.rejects(get(a));
  fail = false;
  await get(a); await get(b);
  assert.deepEqual(await readdir(directory), [b]);
  await get(a);
  assert.equal(downloads, 4);
});

test('unwritable cache serves Storage images and emits only one non-sensitive warning', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'keynest-media-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const directory = join(dir, 'file');
  await writeFile(directory, 'not a directory');
  const warnings = [];
  const get = createMediaCache({ directory, warn: value => warnings.push(value), load: async () => Buffer.from('image') });
  for (let n = 0; n < 2; n++) assert.equal((await get(`${randomUUID()}.webp`)).toString(), 'image');
  assert.equal(warnings.length, 1);
});
