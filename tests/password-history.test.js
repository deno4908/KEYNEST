import test from 'node:test';
import assert from 'node:assert/strict';
import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPasswordHistory, changeDemoPassword } from '../server/password-history.js';
import { hashPassword, verifyPassword } from '../server/security.js';
import { DemoStore } from '../server/demo-store.js';

test('current and historical salted bcrypt hashes are checked before Auth updates', async () => {
  const current = await hash('CurrentPassword123!', 4), previous = await hash('PreviousPassword123!', 4);
  let state = { current_hash: current, history: [previous] }, failure = null, updates = 0, releases = 0;
  const policy = createPasswordHistory({ client: { async rpc(name) {
    if (name === 'finish_password_change') { releases++; return {}; }
    return { data: state, error: failure };
  } } });
  const update = async () => { updates++; return 'updated'; };
  for (const password of ['CurrentPassword123!', 'PreviousPassword123!'])
    await assert.rejects(policy.change('user', password, update), /30 ngày/);
  assert.equal(updates, 0);
  assert.equal(await policy.change('user', 'UnusedPassword123!', update), 'updated');
  assert.equal(updates, 1);
  assert.equal(releases, 3);
  state.history = [];
  await policy.change('user', 'PreviousPassword123!', update);
  state.history = ['unsupported-hash-format'];
  await assert.rejects(policy.change('user', 'UnusedPassword123!', update), e => e.status === 503);
  state = null;
  await assert.rejects(policy.change('user', 'UnusedPassword123!', update), e => e.status === 409);
  failure = { code: 'MISSING_MIGRATION' };
  await assert.rejects(policy.change('user', 'UnusedPassword123!', update), e => e.status === 503);
  assert.equal(updates, 2);
});

test('demo history blocks 30-day reuse and is never included in profiles', () => {
  const now = Date.now(), day = 86400000;
  const user = { id: 'u', password_hash: hashPassword('FirstPassword123!') };
  changeDemoPassword(user, 'SecondPassword123!', now);
  assert.throws(() => changeDemoPassword(user, 'FirstPassword123!', now + 29 * day), /30 ngày/);
  assert.throws(() => changeDemoPassword(user, 'SecondPassword123!', now + 31 * day), /30 ngày/);
  changeDemoPassword(user, 'FirstPassword123!', now + 30 * day);
  assert.equal(verifyPassword('FirstPassword123!', user.password_hash), true);
  const profile = DemoStore.prototype.publicUser(user);
  assert.equal('password_history' in profile, false);
  assert.equal('password_hash' in profile, false);
  assert.equal(JSON.stringify(user).includes('FirstPassword123!'), false);
});

test('SQL records replaced hashes atomically, keeps current regardless of age, restricts access and serializes changes', async () => {
  const db = new PGlite();
  const uid = randomUUID(), first = randomUUID(), second = randomUUID();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key, encrypted_password text);');
    for (const name of ['027_password_recovery_links.sql', '028_password_recovery_delivery.sql', '029_password_history.sql'])
      await db.exec(await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8'));
    await db.query('insert into auth.users values($1,$2)', [uid, 'salted-current']);
    const begin = async id => (await db.query('select begin_password_change($1,$2) as state', [uid,id])).rows[0].state;
    assert.deepEqual(await begin(first), { current_hash: 'salted-current', history: [] });
    assert.equal(await begin(second), null);
    await db.query('select finish_password_change($1,$2)',[uid,second]);
    assert.equal(await begin(second), null);
    await db.query('update auth.users set encrypted_password=$2 where id=$1',[uid,'salted-new']);
    assert.deepEqual((await db.query('select password_hash from password_history')).rows, [{ password_hash: 'salted-current' }]);
    // Updates which fail never enter history.
    await db.exec('begin');
    await db.query('update auth.users set encrypted_password=$2 where id=$1',[uid,'rolled-back']);
    await db.exec('rollback');
    await db.query('select finish_password_change($1,$2)',[uid,first]);
    assert.deepEqual(await begin(second), { current_hash: 'salted-new', history: ['salted-current'] });
    await db.exec("update password_history set retired_at=now()-interval '30 days'; update password_change_locks set expires_at=now()-interval '1 second'");
    assert.deepEqual(await begin(first), { current_hash: 'salted-new', history: [] });
    for (const role of ['anon','authenticated']) {
      assert.equal((await db.query("select has_table_privilege($1,'public.password_history','SELECT') as ok",[role])).rows[0].ok,false);
      for (const fn of ['begin_password_change(uuid,uuid)', 'finish_password_change(uuid,uuid)', 'inspect_password_recovery_reset(text)'])
        assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') as ok',[role,fn])).rows[0].ok,false);
    }
    const emailHash = 'ab'.repeat(32), ticketHash = 'cd'.repeat(32), recoveryId = randomUUID();
    await db.query("insert into password_recovery_links(email_hash,recovery_id,expires_at,consumed_at) values($1,$2,now()+interval '10 minutes',now())", [emailHash,recoveryId]);
    await db.query("insert into password_recovery_tickets(ticket_hash,email_hash,recovery_id,user_id,encrypted_session,expires_at) values($1,$2,$3,$4,'session',now()+interval '10 minutes')", [ticketHash,emailHash,recoveryId,uid]);
    const inspect = () => db.query('select * from inspect_password_recovery_reset($1)',[ticketHash]);
    assert.deepEqual((await inspect()).rows,[{user_id:uid}]);
    assert.deepEqual((await inspect()).rows,[{user_id:uid}]);
    await db.query('select * from claim_password_recovery_reset($1,now())',[ticketHash]);
    assert.deepEqual((await inspect()).rows,[]);
    await db.exec("update password_recovery_tickets set consumed_at=null,expires_at=now()-interval '1 second'");
    assert.deepEqual((await inspect()).rows,[]);
    await db.query('delete from auth.users where id=$1',[uid]);
    assert.equal((await db.query('select * from password_history')).rows.length,0);
  } finally { await db.close(); }
});
