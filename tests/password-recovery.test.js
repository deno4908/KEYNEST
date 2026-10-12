import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { AppError } from "../server/security.js";
import { createPasswordRecovery } from "../server/password-recovery.js";

const encryption = "ab".repeat(32);
const emailHash = "email-hash";
const user = { id: "user-1", email: "user@example.com" };
const session = { access_token: "access", refresh_token: "refresh" };

test('failed delivery preserves the previous generation', async () => {
  const repository = memoryRepository(Date.now());
  let fail = false;
  const service = createPasswordRecovery({
    config: { origin: 'https://keynest.store', encryption }, repository, store: {},
    logger: { error() {} },
    makeAuthClient: () => ({ auth: { resetPasswordForEmail: async () => ({ error: fail ? { code: 'over_email_send_rate_limit', status: 429 } : null }) } }),
  });
  await service.request(user.email);
  const previous = repository.currentLink.recoveryId;
  fail = true;
  await assert.rejects(service.request(user.email), error => error.status === 502);
  assert.equal(repository.currentLink.recoveryId, previous);
});

test('SQL delivery reservation, failed resend, ticket replay and expiry', async () => {
  const db = new PGlite();
  const hash = 'ab'.repeat(32), ticket = 'cd'.repeat(32);
  const first = randomUUID(), second = randomUUID(), uid = randomUUID();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key);');
    for (const name of ['027_password_recovery_links.sql', '028_password_recovery_delivery.sql'])
      await db.exec(await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8'));
    const reserve = async id => (await db.query('select reserve_password_recovery($1,$2) as ok', [hash,id])).rows[0].ok;
    const finish = (id,sent) => db.query('select finish_password_recovery($1,$2,$3)',[hash,id,sent]);
    assert.equal(await reserve(first),true);
    assert.equal(await reserve(second),false);
    await finish(first,true);
    assert.equal(await reserve(second),false);
    await db.exec("update password_recovery_sends set requested_at = now() - interval '91 seconds'");
    assert.equal(await reserve(second),true);
    await finish(second,false);
    assert.equal((await db.query('select recovery_id from password_recovery_links')).rows[0].recovery_id,first);
    await db.query('insert into auth.users values($1)',[uid]);
    const payload = { ticket_hash: ticket, email_hash: hash, recovery_id: first, user_id: uid, encrypted_session: 'encrypted' };
    const redeem = async value => (await db.query('select redeem_password_recovery($1::jsonb) as ok', [JSON.stringify(value)])).rows[0].ok;
    await assert.rejects(redeem({ ...payload, user_id: randomUUID() }));
    assert.equal((await db.query('select consumed_at from password_recovery_links')).rows[0].consumed_at,null);
    assert.equal(await redeem(payload),true);
    assert.equal(await redeem({ ...payload, ticket_hash: 'ef'.repeat(32) }),false);
    const claim = () => db.query('select * from claim_password_recovery_reset($1,now())',[ticket]);
    assert.equal((await claim()).rows.length,1);
    assert.equal((await claim()).rows.length,0);
    await db.exec("update password_recovery_tickets set consumed_at=null,expires_at=now()-interval '1 second'");
    assert.equal((await claim()).rows.length,0);
    await db.exec("update password_recovery_tickets set expires_at=now()+interval '10 minutes'");
    assert.equal(await reserve(second),true);
    await finish(second,true);
    assert.equal((await claim()).rows.length,0);
    assert.equal((await db.query("select has_function_privilege('anon','reserve_password_recovery(text,uuid)','execute') as ok")).rows[0].ok,false);
  } finally { await db.close(); }
});

function memoryRepository(now) {
  let currentLink = null;
  const tickets = new Map();
  return {
    tickets,
    get currentLink() {
      return currentLink;
    },
    async reserveSend(emailHash, recoveryId) {
      this.pending = { emailHash, recoveryId, expiresAt: new Date(now + 600000).toISOString() };
    },
    async finishSend(hash, id, sent) {
      if (sent) currentLink = { ...this.pending, consumedAt: null };
      this.pending = null;
    },
    async findLink({ recoveryId, now: timestamp }) {
      if (
        !currentLink ||
        currentLink.recoveryId !== recoveryId ||
        currentLink.consumedAt ||
        Date.parse(currentLink.expiresAt) <= Date.parse(timestamp)
      )
        return null;
      return { expires_at: currentLink.expiresAt };
    },
    async createTicket(ticket) {
      if (currentLink.consumedAt || currentLink.recoveryId !== ticket.recovery_id) throw new AppError('Invalid link', 401);
      currentLink.consumedAt = new Date(now).toISOString();
      tickets.set(ticket.ticket_hash, { ...ticket, consumed_at: null });
    },
    async claimTicket(ticketHash, timestamp) {
      const ticket = tickets.get(ticketHash);
      if (
        !ticket ||
        ticket.consumed_at ||
        Date.parse(ticket.expires_at) <= Date.parse(timestamp) ||
        currentLink?.recoveryId !== ticket.recovery_id ||
        !currentLink.consumedAt
      )
        return null;
      ticket.consumed_at = timestamp;
      return {
        user_id: ticket.user_id,
        encrypted_session: ticket.encrypted_session,
      };
    },
  };
}

function authClient({ verified = true, calls = [] } = {}) {
  return {
    auth: {
      resetPasswordForEmail: async (...args) => {
        calls.push(["resetPasswordForEmail", ...args]);
        return { error: null };
      },
      verifyOtp: async (input) => {
        calls.push(["verifyOtp", input]);
        return verified
          ? { data: { user, session }, error: null }
          : { data: {}, error: Object.assign(new Error("invalid token"), { status: 403, code: "otp_expired" }) };
      },
      setSession: async (input) => {
        calls.push(["setSession", input]);
        return { data: { session }, error: null };
      },
      updateUser: async (input) => {
        calls.push(["updateUser", input]);
        return { data: { user }, error: null };
      },
    },
  };
}

test("recovery request makes a fresh, ten-minute generation in the allowed reset URL", async () => {
  const now = Date.parse("2026-10-12T00:00:00Z");
  const repository = memoryRepository(now);
  const calls = [];
  const service = createPasswordRecovery({
    config: { origin: "https://keynest.store", encryption },
    store: {},
    repository,
    clock: () => now,
    makeAuthClient: () => authClient({ calls }),
  });

  await service.request(" User@Example.com ");
  const firstId = repository.currentLink.recoveryId;
  await service.request("user@example.com");
  const secondId = repository.currentLink.recoveryId;
  const sentUrl = new URL(calls.at(-1)[2].redirectTo);

  assert.notEqual(firstId, secondId);
  assert.equal(sentUrl.origin, "https://keynest.store");
  assert.equal(sentUrl.pathname, "/reset-password");
  assert.equal(sentUrl.searchParams.get("recovery_id"), secondId);
  assert.equal(
    Date.parse(repository.currentLink.expiresAt) - now,
    10 * 60 * 1000,
  );
});

test("opening a recovery link consumes it once and returns an in-memory reset ticket", async () => {
  const now = Date.parse("2026-10-12T00:00:00Z");
  const repository = memoryRepository(now);
  const calls = [];
  const service = createPasswordRecovery({
    config: { origin: "https://keynest.store", encryption },
    store: {},
    repository,
    clock: () => now,
    makeAuthClient: () => authClient({ calls }),
  });
  await service.request(user.email);
  const recoveryId = repository.currentLink.recoveryId;
  const input = {
    token_hash: "a".repeat(64),
    type: "recovery",
    recovery_id: recoveryId,
  };

  const { ticket } = await service.redeem(input);
  assert.ok(ticket);
  assert.equal(repository.tickets.size, 1);
  assert.notEqual([...repository.tickets.values()][0].email_hash, user.email);
  await assert.rejects(
    service.redeem(input),
    (error) => error instanceof AppError && error.status === 401,
  );
  assert.equal(calls.filter(([name]) => name === "verifyOtp").length, 2);
});

test("an older email link and its reset ticket stop working after a newer request", async () => {
  const now = Date.parse("2026-10-12T00:00:00Z");
  const repository = memoryRepository(now);
  const service = createPasswordRecovery({
    config: { origin: "https://keynest.store", encryption },
    store: {},
    repository,
    clock: () => now,
    makeAuthClient: () => authClient(),
  });
  await service.request(user.email);
  const oldId = repository.currentLink.recoveryId;
  await service.request(user.email);
  await assert.rejects(
    service.redeem({
      token_hash: "a".repeat(64),
      type: "recovery",
      recovery_id: oldId,
    }),
    (error) => error instanceof AppError && error.status === 401,
  );

  const currentId = repository.currentLink.recoveryId;
  const { ticket } = await service.redeem({
    token_hash: "b".repeat(64),
    type: "recovery",
    recovery_id: currentId,
  });
  await service.request(user.email);
  await assert.rejects(
    service.complete({ ticket, password: "NewPassword123!" }),
    (error) => error instanceof AppError && error.status === 401,
  );
});

test("reset tickets can be claimed once and expire ten minutes after issuance", async () => {
  let now = Date.parse("2026-10-12T00:00:00Z");
  const repository = memoryRepository(now);
  const calls = [];
  const service = createPasswordRecovery({
    config: { origin: "https://keynest.store", encryption },
    store: {},
    repository,
    clock: () => now,
    makeAuthClient: () => authClient({ calls }),
  });
  await service.request(user.email);
  const { ticket } = await service.redeem({
    token_hash: "a".repeat(64),
    type: "recovery",
    recovery_id: repository.currentLink.recoveryId,
  });

  const outcomes = await Promise.allSettled([
    service.complete({ ticket, password: "NewPassword123!" }),
    service.complete({ ticket, password: "NewPassword123!" }),
  ]);
  assert.equal(
    outcomes.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(calls.filter(([name]) => name === "updateUser").length, 1);

  await service.request(user.email);
  const { ticket: expiringTicket } = await service.redeem({
    token_hash: "b".repeat(64),
    type: "recovery",
    recovery_id: repository.currentLink.recoveryId,
  });
  now += 10 * 60 * 1000;
  await assert.rejects(
    service.complete({ ticket: expiringTicket, password: "NewPassword123!" }),
    (error) => error instanceof AppError && error.status === 401,
  );
});

test("unknown provider hashes are rejected without producing reset tickets", async () => {
  const repository = memoryRepository(Date.now());
  const service = createPasswordRecovery({
    config: { origin: "https://keynest.store", encryption },
    store: {},
    repository,
    makeAuthClient: () => authClient({ verified: false }),
  });
  await assert.rejects(
    service.redeem({
      token_hash: "c".repeat(64),
      type: "recovery",
      recovery_id: randomUUID(),
    }),
    (error) => error instanceof AppError && error.status === 401,
  );
  assert.equal(repository.tickets.size, 0);
});
