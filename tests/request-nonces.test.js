import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseStep } from '../scripts/database-sql.js';
import { PGlite } from '@electric-sql/pglite';
import { createSupabaseNonceStore } from '../server/request-nonces.js';

test('database nonce consumption persists across adapters, rejects replay and expires safely', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(databaseStep('030_password_request_nonces'));
    const client = { async rpc(name, params) {
      assert.equal(name, 'consume_password_request_nonce');
      const result = await db.query('select public.consume_password_request_nonce($1,$2) as used', [params.p_nonce_hash, params.p_expires_at]);
      return { data: result.rows[0].used };
    } };
    const first = createSupabaseNonceStore({ client }), second = createSupabaseNonceStore({ client });
    const deadline = Date.now() + 120000, hash = 'ab'.repeat(32);
    await db.exec('set role service_role');
    const results = await Promise.all([first.consume(hash, deadline), second.consume(hash, deadline)]);
    assert.deepEqual(results.sort(), [false, true]);
    assert.equal(await createSupabaseNonceStore({ client }).consume(hash, deadline), false);
    assert.equal(await first.consume('cd'.repeat(32), Date.now() - 1), false);
    assert.equal(await first.consume('ef'.repeat(32), Date.now() + 300000), false);
    await db.exec('reset role');
    assert.equal((await db.query('select * from public.password_request_nonces')).rows.length, 1);
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.query("select has_table_privilege($1,'public.password_request_nonces','SELECT') as ok", [role])).rows[0].ok, false);
      assert.equal((await db.query("select has_function_privilege($1,'public.consume_password_request_nonce(text,timestamptz)','EXECUTE') as ok", [role])).rows[0].ok, false);
    }
    await db.exec("update public.password_request_nonces set expires_at=now()-interval '1 second'");
    assert.equal(await first.consume('cd'.repeat(32), Date.now() + 120000), true);
    assert.deepEqual((await db.query('select nonce_hash from public.password_request_nonces')).rows, [{ nonce_hash: 'cd'.repeat(32) }]);
  } finally { await db.close(); }
});
