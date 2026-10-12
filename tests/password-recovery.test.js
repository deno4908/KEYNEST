import test from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../server/security.js";
import { createPasswordRecovery } from "../server/password-recovery.js";

test("recovery request uses the KEYNEST reset page and reports mail errors", async () => {
  let request;
  const logs = [];
  const service = createPasswordRecovery({
    config: { origin: "https://keynest.store" },
    makeAuthClient: () => ({
      auth: {
        resetPasswordForEmail: async (...args) => {
          request = args;
          return {
            error: {
              code: "smtp_error",
              status: 500,
              message: "Delivery failed for user@example.com",
            },
          };
        },
      },
    }),
    logger: { error: (...args) => logs.push(args) },
  });

  await assert.rejects(
    service.request("user@example.com"),
    (error) => error instanceof AppError && error.status === 502,
  );
  assert.deepEqual(request, [
    "user@example.com",
    { redirectTo: "https://keynest.store/reset-password" },
  ]);
  assert.equal(logs.length, 1);
  assert.doesNotMatch(JSON.stringify(logs), /user@example\.com/);
});

test("recovery verifies the one-time hash only when the new password is submitted", async () => {
  const now = Date.now();
  const calls = [];
  const session = { access_token: "access", refresh_token: "refresh" };
  const service = createPasswordRecovery({
    config: { origin: "https://keynest.store" },
    clock: () => now,
    makeAuthClient: () => ({
      auth: {
        verifyOtp: async (input) => {
          calls.push(["verifyOtp", input]);
          return {
            data: {
              user: { recovery_sent_at: new Date(now - 1000).toISOString() },
              session,
            },
            error: null,
          };
        },
        updateUser: async (input) => {
          calls.push(["updateUser", input]);
          return { error: null };
        },
      },
    }),
  });

  const result = await service.complete({
    token_hash: "a".repeat(64),
    password: "NewPassword123!",
  });
  assert.equal(result, session);
  assert.deepEqual(calls, [
    ["verifyOtp", { token_hash: "a".repeat(64), type: "recovery" }],
    ["updateUser", { password: "NewPassword123!" }],
  ]);
});

test("recovery rejects expired or already-invalid hashes", async () => {
  const now = Date.now();
  const service = createPasswordRecovery({
    config: { origin: "https://keynest.store" },
    clock: () => now,
    makeAuthClient: () => ({
      auth: {
        verifyOtp: async () => ({
          data: {},
          error: new Error("invalid token"),
        }),
      },
    }),
  });

  await assert.rejects(
    service.complete({
      token_hash: "a".repeat(64),
      password: "NewPassword123!",
    }),
    (error) => error instanceof AppError && error.status === 401,
  );
});
