import test from "node:test";
import { sendSession } from '../server/bearer.js';
import assert from "node:assert/strict";
import express from "express";
import { mfaRouter, needsMfa } from "../server/mfa.js";

const verified = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "verified",
  factor_type: "totp",
};
const pending = {
  id: "22222222-2222-4222-8222-222222222222",
  status: "unverified",
  factor_type: "totp",
};
const token = (aal) =>
  `header.${Buffer.from(JSON.stringify({ aal })).toString("base64url")}.signature`;
test("MFA requires an elevated verified token only for opted-in users", () => {
  assert.equal(needsMfa({ factors: [] }, token("aal1")), false);
  assert.equal(needsMfa({ factors: [pending] }, token("aal1")), false);
  assert.equal(needsMfa({ factors: [verified] }, token("aal1")), true);
  assert.equal(needsMfa({ factors: [verified] }, "invalid"), true);
  assert.equal(needsMfa({ factors: [verified] }, token("aal2")), false);
});
test("MFA routes bind factors to user, reject enrollment bypass and verify before removal", async (t) => {
  const calls = [];
  let rejectCode = false;
  const app = express();
  app.use(express.json());
  app.use(
    mfaRouter({
      config: {
        mode: "supabase",
        url: "https://example.supabase.co",
        anon: "test",
      },
      auth(req, res, next) {
        req.authUser = { factors: [verified, pending] };
        req.authToken = token("aal1");
        next();
      },
      limiter: () => (req, res, next) => next(),
      setAuth(res, session) {
        sendSession(res, session, { httpOnly: true, path: '/api' });
      },
      fetcher: async (url, opts) => {
        calls.push({ path: url.pathname, ...opts });
        if (url.pathname.endsWith("/verify"))
          return Response.json(
            rejectCode
              ? {}
              : { access_token: token("aal2"), refresh_token: "refresh" },
            { status: rejectCode ? 400 : 200 },
          );
        return Response.json({ id: "challenge" });
      },
    }),
  );
  app.use((err, req, res, next) =>
    res.status(err.status || 400).json({ error: err.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (path, data) =>
    fetch(url + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  assert.equal((await post("/enroll", {})).status, 403);
  assert.equal(
    (await post("/verify", { factor_id: pending.id, code: "123456" })).status,
    403,
  );
  assert.equal(
    (
      await post("/verify", {
        factor_id: "33333333-3333-4333-8333-333333333333",
        code: "123456",
      })
    ).status,
    403,
  );
  assert.equal(
    (await post("/verify", { factor_id: verified.id, code: "123" })).status,
    400,
  );
  assert.equal(calls.length, 0);
  rejectCode = true;
  const rejected = await post("/verify", {
    factor_id: verified.id,
    code: "123456",
    remove: true,
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.headers.get("set-cookie"), null);
  assert.equal(
    calls.some((c) => c.method === "DELETE"),
    false,
  );
  rejectCode = false;
  const result = await post("/verify", {
    factor_id: verified.id,
    code: "123456",
    remove: true,
  });
  assert.equal(result.status, 200);
  assert.match(result.headers.get("set-cookie"), /HttpOnly/);
  assert.equal(result.headers.get('X-Access-Token'), token('aal2'));
  assert.equal(calls.at(-1).method, "DELETE");
  assert.equal(calls.at(-1).headers.Authorization, `Bearer ${token("aal2")}`);
  assert.deepEqual(await result.json(), { success: true });
});
