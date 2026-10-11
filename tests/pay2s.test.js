import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.APP_MODE = "demo";
process.env.BANK_PAYMENT_PROVIDER = "pay2s";
const dir = mkdtempSync(join(tmpdir(), "keynest-pay2s-"));
process.env.DEMO_DATA_PATH = join(dir, "store.json");
const { app, store, bankPayments } = await import("../server/index.js");
const { config } = await import("../server/config.js");
const { DemoStore } = await import("../server/demo-store.js");
const { createBankPayments } = await import("../server/bank-payments.js");
const token = "pay2s-test-secret-not-live";
const account = "00123456789";
const tx = (id, code, amount = 20000) => ({
  id,
  gateway: "MBBank",
  accountNumber: account,
  transactionDate: "2026-10-10 12:00:00",
  transactionNumber: `TX-${id}`,
  content: code,
  transferType: "IN",
  transferAmount: amount,
  checksum: "documented-optional-metadata",
});

test("Pay2S HTTP integration: authentication, batch validation, retry and financial effects", async (t) => {
  const original = { ...config };
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => {
    Object.assign(config, original);
    server.close();
    assert.ok(
      resolve(dir).startsWith(resolve(tmpdir()) + sep + "keynest-pay2s-"),
    );
    rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const send = async (body, authorization = `Bearer ${token}`) => {
    const response = await fetch(base + "/webhooks/pay2s", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  await t.test(
    "admin diagnostics are protected and demo never accepts real webhook",
    async () => {
      assert.equal(
        (await fetch(base + "/admin/bank-payments/status")).status,
        401,
      );
      const login = await fetch(base + "/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: config.origin,
          "X-App-Request": "keynest",
        },
        body: JSON.stringify({
          email: "admin@keynest.local",
          password: "Admin123!",
        }),
      });
      const cookie = login.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; ");
      const status = await (
        await fetch(base + "/admin/bank-payments/status", {
          headers: { Cookie: cookie },
        })
      ).json();
      assert.equal(status.reason, "demo");
      assert.equal(status.webhook_path, "/api/webhooks/pay2s");
      assert.equal(
        (await send({ transactions: [tx(1, "KN0123456789ABCDEF")] })).status,
        503,
      );
    },
  );
  Object.assign(config, {
    mode: "supabase",
    paymentProvider: "pay2s",
    pay2sWebhook: token,
    account,
    accountName: "TEST ACCOUNT",
    bank: "MB",
  });
  const uid = store.db.users.find((u) => u.role === "customer").id;
  const before = store.profile(uid).balance;
  const payment = store.createTopup(uid, 20000);
  await t.test(
    "rejects forged auth, malformed amounts and mixed recipient batches before mutation",
    async () => {
      const good = tx(10, payment.code);
      assert.equal((await send({ transactions: [good] }, "")).status, 401);
      assert.equal(
        (await send({ transactions: [good] }, "Bearer wrong")).status,
        401,
      );
      for (const changes of [
        { transferAmount: -1 },
        { transferAmount: "20000" },
        { transferAmount: 1.5 },
        { transferType: "UNKNOWN" },
        { id: Number.MAX_SAFE_INTEGER + 1 },
      ])
        assert.equal(
          (await send({ transactions: [{ ...good, ...changes }] })).status,
          400,
        );
      assert.equal((await send({ transactions: [] })).status, 400);
      assert.equal(
        (
          await send({
            transactions: [good, { ...good, id: 11, gateway: "ACB" }],
          })
        ).status,
        422,
      );
      assert.equal(
        (
          await send({
            transactions: [good, { ...good, id: 12, accountNumber: "wrong" }],
          })
        ).status,
        422,
      );
      assert.equal(store.db.events.length, 0);
      assert.equal(store.profile(uid).balance, before);
      const sepay = await fetch(base + "/webhooks/sepay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      assert.equal(sepay.status, 503);
    },
  );
  await t.test(
    "credits once under concurrent duplicate callbacks and survives restart",
    async () => {
      const body = {
        transactions: [
          tx(20, payment.code),
          { ...tx(21, payment.code), transferType: "OUT" },
        ],
      };
      const results = await Promise.all(Array.from({ length: 20 }, () => send(body)));
      for (const r of results) {
        assert.equal(r.status, 200);
        assert.deepEqual(r.body, { success: true });
      }
      assert.equal(store.profile(uid).balance, before + 20000);
      assert.ok(bankPayments.status().last_received_at);
      assert.equal(
        JSON.stringify(bankPayments.status()).includes(token),
        false,
      );
      const restored = new DemoStore(store.key, process.env.DEMO_DATA_PATH);
      const replay = createBankPayments({ config, store: restored });
      const result = await replay.accept("pay2s", {
        id: "20",
        account,
        direction: "in",
        currency: "VND",
        amount: 20000,
        content: payment.code,
      });
      assert.equal(result.duplicate, true);
      assert.equal(restored.profile(uid).balance, before + 20000);
      // A different provider ID for an already-paid code must not auto-credit.
      assert.equal((await send({ transactions: [tx(22, payment.code)] })).status, 200);
      assert.equal(store.profile(uid).balance, before + 20000);
      assert.equal(store.db.events.find(e => e.transaction_id.endsWith(':22')).outcome, 'needs_review');
    },
  );
  await t.test(
    "delivers paid key, handles single payload and keeps invalid/late transfers for review",
    async () => {
      const variant = store.products()[0].variants[0];
      const order = store.createOrder(
        uid,
        {
          items: [{ variant_id: variant.id, quantity: 1 }],
          method: "sepay",
          coupon: "",
          customer_note: "",
        },
        randomUUID(),
      );
      const p = store.db.payments.find((p) => p.order_id === order.id);
      assert.equal(
        (await send(tx("single-event", p.code, p.amount))).status,
        200,
      );
      assert.equal(
        store.orders(uid, false, order.id)[0].items[0].keys.length,
        1,
      );
      const late = store.createTopup(uid, 20000);
      late.expires_at = new Date(Date.now() - 1000).toISOString();
      const wrong = store.createTopup(uid, 20000);
      const beforeReview = store.profile(uid).balance;
      assert.equal(
        (
          await send({
            transactions: [
              tx(30, late.code),
              tx(31, wrong.code, 19000),
              tx(32, "unknown order"),
              tx(33, `${wrong.code} ${payment.code}`),
            ],
          })
        ).status,
        200,
      );
      assert.equal(
        store.db.events.filter((e) => e.outcome === "needs_review").length,
        4,
      );
      assert.equal(store.profile(uid).balance, beforeReview);
    },
  );
  await t.test(
    "returns failure on DB error and retries a partially processed batch without double credit",
    async () => {
      const a = store.createTopup(uid, 20000),
        b = store.createTopup(uid, 30000);
      const beforeBatch = store.profile(uid).balance;
      const originalSettle = store.settle;
      store.settle = function (id, code, amount) {
        if (id.endsWith(":41")) throw new Error(`sensitive ${token}`);
        return originalSettle.call(this, id, code, amount);
      };
      const body = { transactions: [tx(40, a.code), tx(41, b.code, 30000)] };
      try {
        const failed = await send(body);
        assert.equal(failed.status, 503);
        assert.equal(JSON.stringify(failed.body).includes(token), false);
        assert.notEqual(failed.body.success, true);
      } finally {
        store.settle = originalSettle;
      }
      assert.equal(store.profile(uid).balance, beforeBatch + 20000);
      assert.equal((await send(body)).status, 200);
      assert.equal(store.profile(uid).balance, beforeBatch + 50000);
    },
  );
});
