import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AppError } from "../server/security.js";
import { createPasswordRecovery } from "../server/password-recovery.js";

const encryption = "ab".repeat(32);
const emailHash = "email-hash";
const user = { id: "user-1", email: "user@example.com" };
const session = { access_token: "access", refresh_token: "refresh" };

function memoryRepository(now) {
  let currentLink = null;
  const tickets = new Map();
  return {
    tickets,
    get currentLink() {
      return currentLink;
    },
    async issueLink(link) {
      currentLink = { ...link, consumedAt: null };
    },
    async consumeLink({ recoveryId, now: timestamp }) {
      if (
        !currentLink ||
        currentLink.recoveryId !== recoveryId ||
        currentLink.consumedAt ||
        Date.parse(currentLink.expiresAt) <= Date.parse(timestamp)
      )
        return null;
      currentLink.consumedAt = timestamp;
      return { expires_at: currentLink.expiresAt };
    },
    async createTicket(ticket) {
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
          : { data: {}, error: new Error("invalid token") };
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
