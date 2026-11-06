import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import { createHash } from 'node:crypto';
import { encrypt } from '../server/security.js';
import { createAdminOtp } from "../server/admin-otp.js";

test("admin email OTP binds proof to a session and rejects wrong codes, reuse and other users", async (t) => {
  let time = Date.now(),
    used = false,
    signedOut = false;
  const uid = "11111111-1111-4111-8111-111111111111";
  const service = createAdminOtp({
    // A stale deployment flag must not disable mandatory admin verification.
    config: { mode: "supabase", production: false, adminOtpEnabled: false, encryption: "a".repeat(64) },
    clock: () => time,
    makeAuthClient: () => ({
      auth: {
        signInWithOtp: async (input) => {
          assert.equal(input.email, "admin@example.test");
          assert.equal(input.options.shouldCreateUser, false);
          return { error: null };
        },
        verifyOtp: async (input) => {
          assert.equal(input.email, "admin@example.test");
          if (input.token !== "123456" || used)
            return { error: new Error("invalid"), data: {} };
          used = true;
          return {
            error: null,
            data: { user: { id: uid }, session: { access_token: "temporary" } },
          };
        },
        signOut: async (input) => {
          assert.equal(input.scope, "local");
          signedOut = true;
          return { error: null };
        },
      },
    }),
  });
  const app = express();
  app.use(express.json(), cookieParser());
  function bindIdentity(req) {
    req.user = { id: req.headers['x-user'] || uid, role: req.headers["x-role"] || "admin" };
    req.authUser = { email: req.headers['x-email'] || "admin@example.test" };
    req.authToken = `h.${Buffer.from(JSON.stringify({ sub: req.user.id, session_id: req.headers["x-session"] || "original", iat: time })).toString("base64url")}.s`;
  }
  function auth(req, res, next) {
    bindIdentity(req);
    return service.guard(req, res, next);
  }
  app.use(
    "/api/auth/admin-otp",
    service.router({ auth, limiter: () => (req, res, next) => next() }),
  );
  app.get("/api/private", auth, (req, res) => res.json({ ok: true }));
  // Simulates refresh after the auth provider and operations authorize the session.
  app.post('/api/refresh-proof', (req, res) => {
    bindIdentity(req); res.json({ renewed: service.renew(req, res) });
  });
  app.use((err, req, res, next) =>
    res.status(err.status || 400).json({ error: err.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const req = (path, body, cookie = "", headers = {}) =>
    fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  assert.equal((await req("/private")).status, 403);
  assert.equal((await req('/private', null, '', { 'x-role': 'customer' })).status, 200);
  assert.equal((await (await req('/auth/admin-otp/status')).json()).verified, false);
  assert.equal(
    (await req("/auth/admin-otp/status", null, "", { "x-role": "customer" }))
      .status,
    403,
  );
  assert.equal(
    (await req("/auth/admin-otp/verify", { code: "123456" })).status,
    400,
  );
  const sent = await req("/auth/admin-otp/send", {});
  assert.equal(sent.status, 200);
  const challenge = sent.headers.getSetCookie()[0].split(";")[0];
  assert.match(sent.headers.getSetCookie()[0], /HttpOnly/);
  // An attacker controls request cookies even when browsers mark them HttpOnly.
  // A send receipt must never be accepted as proof that the OTP was verified.
  const renamedChallenge = challenge.replace('kn_admin_challenge=', 'kn_admin_verified=');
  assert.equal((await req('/private', null, renamedChallenge)).status, 403);
  assert.equal((await (await req('/auth/admin-otp/status', null, renamedChallenge)).json()).verified, false);
  const legacyKey = createHash('sha256').update('a'.repeat(64)).update('admin-email-otp-v1').digest('hex');
  const legacyProof = 'kn_admin_verified=' + encrypt(JSON.stringify({
    uid, sid: 'original', email: 'admin@example.test', expires: time + 12 * 3600000,
  }), legacyKey);
  assert.equal((await req('/private', null, legacyProof)).status, 403);
  assert.equal((await req("/auth/admin-otp/send", {}, challenge)).status, 429);
  assert.equal(
    (await req("/auth/admin-otp/verify", { code: "000000" }, challenge)).status,
    400,
  );
  assert.equal(
    (
      await req("/auth/admin-otp/verify", { code: "123456" }, challenge, {
        "x-session": "different",
      })
    ).status,
    400,
  );
  const verified = await req(
    "/auth/admin-otp/verify",
    { code: "123456" },
    challenge,
  );
  assert.equal(verified.status, 200);
  assert.equal(signedOut, true);
  const proof = verified.headers
    .getSetCookie()
    .find((c) => c.startsWith("kn_admin_verified="))
    .split(";")[0];
  assert.equal((await req("/private", null, proof)).status, 200);
  const renamedProof = proof.replace('kn_admin_verified=', 'kn_admin_challenge=');
  assert.equal((await (await req('/auth/admin-otp/status', null, renamedProof)).json()).sent, false);
  assert.equal((await req('/auth/admin-otp/verify', { code: '123456' }, renamedProof)).status, 400);
  assert.equal(
    (await req("/private", null, proof, { "x-session": "different" })).status,
    403,
  );
  assert.equal((await req("/private", null, proof + "x")).status, 403);
  assert.equal(
    (await req("/auth/admin-otp/verify", { code: "123456" }, challenge)).status,
    400,
  );
  time += 13 * 3600000;
  assert.equal((await req("/private", null, proof)).status, 200, 'same session must survive the old 12-hour boundary and JWT rotation');
  for (const [cookie, headers] of [['', {}], [renamedChallenge, {}], [proof, { 'x-session': 'new-login' }],
    [proof, { 'x-email': 'changed@example.test' }], [proof, { 'x-user': 'another-user' }]]) {
    const denied = await req('/refresh-proof', {}, cookie, headers);
    assert.equal((await denied.json()).renewed, false);
    assert.equal(denied.headers.getSetCookie().length, 0);
  }
  time += 5 * 86400000;
  const refreshed = await req('/refresh-proof', {}, proof);
  assert.equal((await refreshed.json()).renewed, true);
  const renewedProof = refreshed.headers.getSetCookie()[0].split(';')[0];
  assert.match(refreshed.headers.getSetCookie()[0], /Max-Age=604800/);
  time += 5 * 86400000;
  assert.equal((await req('/private', null, proof)).status, 403, 'expired original receipt cannot be replayed');
  assert.equal((await req('/private', null, renewedProof)).status, 200, 'active same session keeps its renewed receipt');
  assert.equal((await req('/private', null, renewedProof, { 'x-session': 'new-login' })).status, 403);
  assert.equal((await req('/private')).status, 403);
  assert.equal((await (await req('/refresh-proof', {}, proof)).json()).renewed, false);
  time += 8 * 86400000;
  assert.equal((await req('/private', null, renewedProof)).status, 403);
});
