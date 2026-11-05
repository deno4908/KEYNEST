import test from "node:test";
import { sendSession } from '../server/bearer.js';
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import { createOAuthRouter } from "../server/oauth.js";
import { decrypt, encrypt, requireOrigin } from "../server/security.js";
import { accountLegal } from './helpers/legal.js';

test("OAuth uses browser-bound PKCE, rejects invalid callbacks and keeps tokens off redirects", async (t) => {
  const config = {
    mode: "supabase",
    production: false,
    origin: "http://127.0.0.1:5173",
    url: "https://test.supabase.co",
    anon: "public-test-key",
    encryption: "ab".repeat(32),
    oauthProviders: { google: true, discord: true },
  };
  const key = createHash("sha256")
    .update(Buffer.from(config.encryption, "hex"))
    .update("keynest/oauth/v1")
    .digest("hex");
  const uid = randomUUID();
  let exchanges = 0;
  let expectedChallenge = "";
  const receipts = [];
  let receiptFailure = false;
  const used = new Set();
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, res, next) => {
    try {
      if (req.method === "POST")
        requireOrigin(
          req.headers.origin,
          config.origin,
          req.headers["x-app-request"],
        );
      next();
    } catch (e) {
      next(e);
    }
  });
  app.use(
    "/api/auth/oauth",
    createOAuthRouter({
      config,
      store: {
        profile: async (id) => (id === uid ? { id, name: "OAuth User" } : null),
        audit: async (...args) => { if (receiptFailure) throw new Error('unavailable'); receipts.push(args); },
      },
      setAuth: (res, session) => {
        sendSession(res, session, { httpOnly: true, path: '/api', sameSite: 'lax' });
      },
      fetcher: async (url, options) => {
        exchanges++;
        assert.equal(
          String(url),
          "https://test.supabase.co/auth/v1/token?grant_type=pkce",
        );
        assert.equal(options.headers.apikey, "public-test-key");
        const body = JSON.parse(options.body);
        const challenge = createHash("sha256")
          .update(body.code_verifier)
          .digest("base64url");
        if (
          challenge !== expectedChallenge ||
          used.has(body.auth_code) ||
          body.auth_code !== "valid-code"
        )
          return new Response("{}", { status: 400 });
        used.add(body.auth_code);
        return Response.json({
          access_token: "private-access-token",
          refresh_token: "private-refresh-token",
          user: { id: uid },
        });
      },
    }),
  );
  app.use((e, req, res, next) =>
    res.status(e.status || 400).json({ error: e.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/auth/oauth`;
  const headers = { Origin: config.origin, "X-App-Request": "keynest" };
  async function start(provider = "google") {
    const res = await fetch(`${base}/${provider}`, { method: "POST", headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ legal: accountLegal }) });
    const body = await res.json();
    return {
      res,
      body,
      cookie: res.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    };
  }
  assert.equal((await fetch(`${base}/google`, { method: "POST" })).status, 403);
  assert.equal((await start("unknown")).res.status, 400);
  for (const legal of [undefined, { ...accountLegal, account_data: false }, { ...accountLegal, version: 'old' }]) {
    const response = await fetch(`${base}/google`, { method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ legal }),
    });
    assert.ok([400, 409].includes(response.status));
    assert.equal(response.headers.getSetCookie().length, 0);
  }
  const flow = await start();
  assert.equal(flow.res.status, 200);
  const url = new URL(flow.body.url);
  assert.equal(url.origin, config.url);
  assert.equal(url.searchParams.get("provider"), "google");
  assert.equal(
    url.searchParams.get("redirect_to"),
    `${config.origin}/api/auth/oauth/callback`,
  );
  assert.equal(url.searchParams.get("code_challenge_method"), "s256");
  expectedChallenge = url.searchParams.get("code_challenge");
  assert.match(flow.res.headers.get("set-cookie"), /HttpOnly/);
  assert.match(flow.res.headers.get("set-cookie"), /SameSite=Lax/);
  assert.match(flow.res.headers.get("set-cookie"), /Path=\/api\/auth\/oauth/);
  const encoded = flow.cookie.slice("kn_oauth=".length);
  const transaction = JSON.parse(decrypt(decodeURIComponent(encoded), key));
  assert.ok(!flow.body.url.includes(transaction.verifier));
  async function callback(query, cookie = "") {
    return fetch(`${base}/callback${query}`, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
  }
  for (const cookie of [
    "",
    "kn_oauth=broken",
    `kn_oauth=${encodeURIComponent(encrypt(JSON.stringify({ ...transaction, expires: 0 }), key))}`,
  ]) {
    const res = await callback("?code=valid-code", cookie);
    assert.equal(res.headers.get("location"), `${config.origin}/auth/error`);
    assert.ok(
      !res.headers.getSetCookie().some((c) => c.startsWith("kn_access=")),
    );
  }
  assert.equal(exchanges, 0);
  const denied = await callback(
    "?error=access_denied&error_description=untrusted",
    flow.cookie,
  );
  assert.equal(denied.headers.get("location"), `${config.origin}/auth/error`);
  assert.equal(exchanges, 0);
  const wrong = await callback("?code=wrong-code", flow.cookie);
  assert.equal(wrong.headers.get("location"), `${config.origin}/auth/error`);
  const good = await callback("?code=valid-code", flow.cookie);
  assert.equal(good.status, 303);
  assert.equal(good.headers.get("location"), `${config.origin}/account?welcome=google`);
  assert.equal(good.headers.get('X-Access-Token'), 'private-access-token');
  assert.doesNotMatch(good.headers.get('set-cookie'), /kn_access=private-access-token/);
  assert.equal(good.headers.get("referrer-policy"), "no-referrer");
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0][0], uid);
  assert.equal(receipts[0][1], 'account_legal_acceptance');
  assert.equal(JSON.parse(receipts[0][2]).version, accountLegal.version);
  assert.equal(
    (await callback("?code=valid-code", flow.cookie)).headers.get("location"),
    `${config.origin}/auth/error`,
  );
  const discord = await start("discord");
  assert.equal(
    new URL(discord.body.url).searchParams.get("scopes"),
    "identify email",
  );
  // A failed durable consent write must not issue an application session.
  used.clear();
  expectedChallenge = new URL(discord.body.url).searchParams.get('code_challenge');
  receiptFailure = true;
  const failedReceipt = await callback('?code=valid-code', discord.cookie);
  assert.equal(failedReceipt.headers.get('location'), `${config.origin}/auth/error`);
  assert.equal(failedReceipt.headers.get('X-Access-Token'), null);
  assert.ok(!failedReceipt.headers.getSetCookie().some(c => c.startsWith('kn_refresh=')));
  config.oauthProviders.discord = false;
  assert.equal((await start("discord")).res.status, 503);
  config.mode = "demo";
  assert.equal((await start()).res.status, 503);
});
