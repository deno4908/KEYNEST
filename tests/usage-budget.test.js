import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicReadCache, createMaintenanceBudget } from '../server/read-budget.js';
import { createOperations } from '../server/operations.js';

test('store payment polling selects only the requested owner and small status fields; ordinary reads share maintenance', async () => {
  const { SupabaseStore } = await import('../server/supabase-store.js');
  const store = Object.create(SupabaseStore.prototype);
  const calls = [];
  store.query = async query => query;
  store.client = {
    rpc(name) { calls.push(name); return null; },
    from(table) {
      const filters = [];
      const query = {
        select(fields) { calls.push({ table, fields, filters }); return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        maybeSingle() { return { id: 'own-payment', status: 'pending' }; },
      };
      return query;
    },
  };
  await Promise.all(Array.from({ length: 100 }, () => store.expire()));
  for (let n = 0; n < 100; n++) await store.expire();
  assert.deepEqual(calls, ['expire_payments', 'release_seller_funds']);
  await store.paymentStatus('owner', 'own-payment');
  assert.deepEqual(calls.at(-1), {
    table: 'payments', fields: 'id,status,expires_at', filters: [['user_id', 'owner'], ['id', 'own-payment']],
  });
  await store.paymentStatus('owner', 'own-payment', true);
  assert.equal(calls.at(-1).fields, '*,route:payment_routes(*)');
  await store.expire({ force: true });
  assert.deepEqual(calls.slice(-2), ['expire_payments', 'release_seller_funds']);
});

test('public reads share work, expire, bound entries and cannot republish invalidated in-flight data', async () => {
  let now = 0, loads = 0;
  const cache = createPublicReadCache({ ttlMs: 10000, maxEntries: 2, now: () => now });
  const load = async () => ++loads;
  assert.deepEqual(await Promise.all(Array.from({ length: 20 }, () => cache.get('products', load))), Array(20).fill(1));
  now = 9999;
  assert.equal(await cache.get('products', load), 1);
  now = 10000;
  assert.equal(await cache.get('products', load), 2);
  let release;
  const old = cache.get('products-old', () => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  cache.clear();
  assert.equal(await cache.get('products-old', async () => 'fresh'), 'fresh');
  release('obsolete');
  assert.equal(await old, 'obsolete');
  assert.equal(await cache.get('products-old', load), 'fresh');
  await cache.get('other-a', load);
  await cache.get('other-b', load);
  assert.equal(await cache.get('products-old', load), 5, 'oldest entry was evicted');
  await assert.rejects(cache.get('error', async () => { throw new Error('offline'); }));
  assert.equal(await cache.get('error', async () => 'recovered'), 'recovered');
  const tiny = createPublicReadCache({ maxBytes: 5 });
  let largeLoads = 0;
  for (let n = 0; n < 2; n++) await tiny.get('large', async () => { largeLoads++; return 'too big to retain'; });
  assert.equal(largeLoads, 2, 'large responses cannot grow retained payloads past the byte budget');
});

test('maintenance coalesces reads, allows critical stock checks and retries failed work', async () => {
  let now = 0, runs = 0, fail = false;
  const run = createMaintenanceBudget(async () => {
    runs++;
    if (fail) throw new Error('offline');
  }, { now: () => now });
  await Promise.all(Array.from({ length: 100 }, () => run()));
  assert.equal(runs, 1);
  now = 29999;
  await run();
  assert.equal(runs, 1);
  await Promise.all([run({ force: true }), run({ force: true }), run()]);
  assert.equal(runs, 2);
  now += 30000;
  fail = true;
  await assert.rejects(run());
  fail = false;
  await run();
  assert.equal(runs, 4, 'a failed run must not suppress recovery');
});

test('Supabase authorization checks suspension and revocation on every request in one RPC', async () => {
  let state = 'ok', calls = 0;
  const uid = '11111111-1111-4111-8111-111111111111';
  const session = '22222222-2222-4222-8222-222222222222';
  const token = `header.${Buffer.from(JSON.stringify({ session_id: session })).toString('base64url')}.signature`;
  const operations = createOperations({
    query: async query => query,
    client: {
      from() { assert.fail('separate account_controls read is redundant'); },
      rpc(name, args) {
        assert.equal(name, 'authorize_app_session');
        assert.equal(args.p_user, uid);
        assert.equal(args.p_session, session);
        calls++;
        return { status: state, id: session };
      },
    },
  });
  const req = { user: { id: uid }, get: () => 'browser' };
  await operations.authorize(req, token);
  assert.equal(req.sessionId, session);
  state = 'suspended';
  await assert.rejects(operations.authorize(req, token), error => error.status === 403);
  state = 'revoked';
  await assert.rejects(operations.authorize(req, token), error => error.status === 401);
  assert.equal(calls, 3);
});
