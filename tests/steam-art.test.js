import test from 'node:test';
import assert from 'node:assert/strict';
import { createSteamArt } from '../server/steam-art.js';

test('Steam art uses live IDs, deduplicates games, caches and coalesces requests', async () => {
  let calls = 0;
  const get = createSteamArt({ fetcher: async () => {
    calls++;
    return { ok: true, json: async () => ({
      top_sellers: { items: [{ id: 999123, type: 0, name: 'New game' }, { id: 33, type: 1, name: 'Bundle' }] },
      specials: { items: [{ id: 999123, type: 0, name: 'New game' }, { id: '../bad', type: 0, name: 'Bad' }] },
    }) };
  } });
  const [a, b] = await Promise.all([get(), get()]);
  assert.deepEqual(a, b);
  assert.equal(a.length, 1);
  assert.match(a[0].src, /\/999123\/library_hero.jpg$/);
  await get();
  assert.equal(calls, 1);
});

test('Steam outage keeps cached art and retries only after backoff', async () => {
  let time = 0, calls = 0;
  const get = createSteamArt({ now: () => time, fetcher: async () => {
    calls++;
    if (calls > 1) throw new Error('offline');
    return { ok: true, json: async () => ({ new_releases: { items: [{ id: 42, type: 0, name: 'Game' }] } }) };
  } });
  const initial = await get();
  time = 7 * 60 * 60 * 1000;
  assert.deepEqual(await get(), initial);
  assert.deepEqual(await get(), initial);
  assert.equal(calls, 2);
});

test('Steam unavailable on first request returns an empty list for local fallback', async () => {
  const get = createSteamArt({ fetcher: async () => ({ ok: false }) });
  assert.deepEqual(await get(), []);
});
