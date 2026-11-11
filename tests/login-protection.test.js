import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { databaseStep } from '../scripts/database-sql.js';
import { createLoginProtection } from '../server/login-protection.js';
import { AppError } from '../server/security.js';

const config = { mode: 'demo', encryption: 'ab'.repeat(32) };
const wrong = () => { throw new AppError('Invalid credentials', 401); };
test('five wrong passwords persist the OTP gate across back/reload/new clients and time; other emails and successful logins are isolated', async () => {
  let now = Date.now(), calls = 0;
  const store = { db: {}, save() {} };
  const create = () => createLoginProtection({ config, store, clock: () => now });
  const service = create();
  for (let i = 0; i < 4; i++) await assert.rejects(service.authenticate('User@Example.com', wrong), error => error.status === 401);
  await assert.rejects(service.authenticate('user@example.com', wrong), error => error.code === 'PASSWORD_RECOVERY_REQUIRED');
  now += 400 * 86400000;
  await assert.rejects(create().authenticate(' USER@example.com ', () => { calls++; }), error => error.code === 'PASSWORD_RECOVERY_REQUIRED');
  assert.equal(calls, 0);
  await assert.rejects(create().assertPasswordAllowed('user@example.com'), error => error.code === 'PASSWORD_RECOVERY_REQUIRED');
  await assert.rejects(service.authenticate('other@example.com', wrong));
  assert.equal(await service.authenticate('other@example.com', () => 'ok'), 'ok');
  assert.equal(Object.values(store.db.login_attempts).length, 1);
});

test('concurrent authentication is serialized, service failures do not count as bad passwords, and shared store errors fail closed', async () => {
  const store = { db: {}, save() {} }, service = createLoginProtection({ config, store });
  let release;
  const pending = service.authenticate('user@example.com', () => new Promise(resolve => { release = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(service.authenticate('user@example.com', () => 'bypass'), error => error.code === 'LOGIN_BUSY');
  release('ok'); assert.equal(await pending, 'ok');
  for (let i = 0; i < 7; i++) await assert.rejects(service.authenticate('user@example.com', () => { throw new AppError('outage', 503); }), /outage/);
  assert.equal(Object.values(store.db.login_attempts)[0].failures, 0);
  let checked = false;
  const unavailable = createLoginProtection({ config: { ...config, mode: 'supabase' }, store: { client: { rpc: async () => ({ error: new Error('offline') }) } } });
  await assert.rejects(unavailable.authenticate('user@example.com', () => { checked = true; }), error => error.status === 503);
  assert.equal(checked, false);
});

test('Supabase login reads the active OTP ban before checking a correct password, preserves the ban, and fails closed on status errors', async () => {
  const now = Date.now(), until = new Date(now + 31536000000).toISOString();
  let checks = 0, readError = false;
  const client = {
    rpc: async () => ({ data: { otp_required: true } }),
    from(name) {
      assert.equal(name, 'login_attempts');
      return { select(columns) {
        assert.equal(columns, 'otp_blocked_until');
        return { eq(column, value) {
          assert.equal(column, 'email_hash'); assert.match(value, /^[a-f0-9]{64}$/);
          return { maybeSingle: async () => ({ data: { otp_blocked_until: until }, error: readError ? new Error('offline') : null }) };
        } };
      } };
    },
  };
  const service = createLoginProtection({ config: { ...config, mode: 'supabase' }, store: { client }, clock: () => now });
  await assert.rejects(service.authenticate('user@example.com', () => { checks++; return 'correct'; }),
    error => error.code === 'RECOVERY_OTP_LOCKED' && error.retry_after === 31536000);
  await assert.rejects(service.assertPasswordAllowed('user@example.com'), error => error.code === 'RECOVERY_OTP_LOCKED');
  assert.equal(checks, 0);
  readError = true;
  await assert.rejects(service.authenticate('user@example.com', () => { checks++; }), error => error.status === 503);
  assert.equal(checks, 0);
});

test('SQL persists the gate, enforces global OTP budgets, doubles bans up to 365 days, and resets only on password update/admin unlock', async () => {
  const db = new PGlite();
  const hash = 'ab'.repeat(32), uid = randomUUID(), admin = randomUUID(), actor = randomUUID();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key,encrypted_password text);
      create table public.profiles(id uuid primary key,role text);
      create table public.account_controls(user_id uuid,suspended boolean);
      create table public.audit_logs(user_id uuid,action text,target text);`);
    for (const step of ['027_password_recovery_links','028_password_recovery_delivery','058_login_protection']) await db.exec(databaseStep(step));
    const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
    const begin = id => scalar('select begin_login_attempt($1,$2)', [hash,id]);
    const finish = (id, outcome) => scalar('select finish_login_attempt($1,$2,$3)', [hash,id,outcome]);
    const budget = action => scalar('select login_otp_budget($1,$2)', [hash,action]);
    for (let i = 0; i < 5; i++) {
      const id = randomUUID(); assert.equal((await begin(id)).attempt_id, id);
      assert.equal((await begin(randomUUID())).busy, true);
      assert.equal(await finish(randomUUID(), 'success'), null);
      assert.equal((await finish(id, 'failure')).otp_required, i === 4);
    }
    await db.exec("update login_attempts set window_started_at=now()-interval '400 days'");
    assert.equal((await begin(randomUUID())).otp_required, true);
    for (let incident = 1; incident <= 17; incident++) {
      if (incident > 1) await db.exec("update login_attempts set otp_blocked_until=now()-interval '1 second'");
      for (let i = 0; i < 5; i++) {
        assert.equal((await budget('verify')).locked, false);
        const result = await budget('failure');
        assert.equal(result.locked, i === 4);
        if (i === 4) assert.equal(result.retry_after, Math.min(31536000, 1800 * 2 ** (incident - 1)));
      }
      const until = await scalar('select otp_blocked_until::text from login_attempts');
      assert.equal((await budget('send')).locked, true);
      assert.equal(await scalar('select otp_blocked_until::text from login_attempts'), until, 'banned spam must not slide or extend the ban');
    }
    assert.equal((await begin(randomUUID())).otp_required, true);
    // OTP attempts cannot be reset by reopening the same challenge.
    const generation = randomUUID();
    await db.query("insert into password_recovery_links(email_hash,recovery_id,expires_at) values($1,$2,now()+interval '10 minutes')", [hash,generation]);
    for (let i = 0; i < 5; i++) assert.equal(await scalar('select claim_recovery_otp_attempt($1,$2)', [hash,generation]), true);
    assert.equal(await scalar('select claim_recovery_otp_attempt($1,$2)', [hash,generation]), false);
    const next = randomUUID();
    await db.query('update password_recovery_links set recovery_id=$1', [next]);
    assert.equal(await scalar('select claim_recovery_otp_attempt($1,$2)', [hash,next]), true);
    // An actual password change clears the hash associated with the proven user.
    await db.query("insert into auth.users values($1,'old')", [uid]);
    await db.query("insert into password_recovery_tickets(ticket_hash,email_hash,recovery_id,user_id,encrypted_session,expires_at) values($1,$2,$3,$4,'secret',now()+interval '10 minutes')", ['cd'.repeat(32),hash,next,uid]);
    await db.query("update auth.users set encrypted_password='old' where id=$1", [uid]);
    assert.equal((await begin(randomUUID())).otp_required, true);
    await db.query("update auth.users set encrypted_password='new' where id=$1", [uid]);
    assert.equal(Number(await scalar('select count(*) from login_attempts')), 0);
    await db.query("insert into profiles values($1,'admin'),($2,'customer'),($3,'customer')", [admin,uid,actor]);
    await begin(randomUUID());
    await assert.rejects(db.query('select unlock_login_protection($1,$2,$3)', [actor,uid,hash]), /quản trị/);
    assert.equal(Number(await scalar('select count(*) from login_attempts')), 1);
    await db.query('select unlock_login_protection($1,$2,$3)', [admin,uid,hash]);
    assert.equal(Number(await scalar('select count(*) from login_attempts')), 0);
    assert.equal(await scalar('select action from audit_logs'), 'login_protection_unlocked');
    for (let i = 0; i < 5; i++) { const id = randomUUID(); await begin(id); await finish(id, 'failure'); }
    for (let i = 0; i < 4; i++) assert.equal((await budget('send')).locked, false);
    const sendBan = await budget('send');
    assert.equal(sendBan.locked, true); assert.equal(sendBan.retry_after, 1800);
    assert.equal((await budget('verify')).locked, true, 'a sending ban also prevents OTP verification');
    for (const role of ['anon','authenticated']) {
      for (const fn of ['begin_login_attempt(text,uuid)','finish_login_attempt(text,uuid,text)','login_otp_budget(text,text)','claim_recovery_otp_attempt(text,uuid)','unlock_login_protection(uuid,uuid,text)'])
        assert.equal(await scalar('select has_function_privilege($1,$2,$3)', [role,fn,'EXECUTE']), false);
      assert.equal(await scalar("select has_table_privilege($1,'login_attempts','SELECT')", [role]), false);
    }
  } finally { await db.close(); }
});
