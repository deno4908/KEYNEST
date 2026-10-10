import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  createPaymentIngress,
  paymentHandler,
  infrastructureConfig,
  createInfrastructure,
} from "../server/infrastructure.js";
import { createPay2SRouter } from "../server/pay2s.js";
import { AppError } from "../server/security.js";

const config = {
  mode: "supabase",
  paymentProvider: "pay2s",
  account: "001234",
  bank: "MB",
  pay2sWebhook: "test-webhook-secret",
};
const transaction = {
  id: "123",
  account: config.account,
  direction: "in",
  currency: "VND",
  amount: 200000,
  content: "KN1234567890ABCDEF",
};
const event = (t = transaction) => ({
  version: 1,
  source: "pay2s",
  received_at: new Date().toISOString(),
  transaction: t,
});
const message = (value = event()) => ({
  topic: "payments",
  partition: 2,
  message: {
    offset: "9007199254740993",
    value: Buffer.from(JSON.stringify(value)),
  },
  heartbeat: async () => {},
});

test("Kafka ingress validates entire batch and acknowledges only after broker success", async () => {
  let sends = 0,
    release;
  const ack = new Promise((r) => {
    release = r;
  });
  const ingress = createPaymentIngress({
    config,
    topic: "payments",
    bankPayments: {
      accept() {
        throw new Error("Must not settle in HTTP process");
      },
    },
    producer: {
      async send(data) {
        sends++;
        assert.equal(data.acks, -1);
        assert.equal(data.messages.length, 1);
        assert.equal(JSON.parse(data.messages[0].value).transaction.id, "123");
        assert.ok(!data.messages[0].key.includes(config.account));
        await ack;
      },
    },
  });
  await assert.rejects(
    ingress.acceptBatch("pay2s", [
      transaction,
      { ...transaction, account: "wrong" },
    ]),
    (e) => e.status === 422,
  );
  assert.equal(sends, 0);
  let completed = false;
  const request = ingress
    .acceptBatch("pay2s", [transaction, { ...transaction, direction: "out" }])
    .then(() => {
      completed = true;
    });
  await new Promise((r) => setImmediate(r));
  assert.equal(completed, false);
  release();
  await request;
  assert.equal(completed, true);
});

test("Kafka failure surfaces as 503, never falls back to direct settlement", async () => {
  const ingress = createPaymentIngress({
    config,
    topic: "payments",
    bankPayments: {
      accept() {
        assert.fail("Unsafe fallback");
      },
    },
    producer: {
      async send() {
        throw new Error("sensitive broker details");
      },
    },
  });
  await assert.rejects(
    ingress.accept("pay2s", transaction),
    (e) => e.status === 503 && !e.message.includes("sensitive"),
  );
});

test("worker retries DB failure and commits next offset only after successful settlement", async () => {
  const steps = [];
  let calls = 0;
  const handler = paymentHandler({
    bankPayments: {
      async accept() {
        steps.push("settle");
        if (++calls < 3) throw new Error("DB down");
      },
    },
    consumer: {
      async commitOffsets(value) {
        steps.push("commit");
        assert.equal(value[0].offset, "9007199254740994");
      },
    },
    sleep: async () => {},
  });
  await handler(message());
  assert.deepEqual(steps, ["settle", "settle", "settle", "commit"]);
});

test("persistent failure or invalid events never advance offsets", async () => {
  let commits = 0,
    calls = 0;
  const handler = paymentHandler({
    bankPayments: {
      async accept() {
        calls++;
        throw new Error("DB down");
      },
    },
    consumer: {
      async commitOffsets() {
        commits++;
      },
    },
    sleep: async () => {},
    attempts: 3,
  });
  await assert.rejects(handler(message()));
  assert.equal(calls, 3);
  assert.equal(commits, 0);
  await assert.rejects(handler(message({ ...event(), version: 999 })));
  assert.equal(calls, 3);
  assert.equal(commits, 0);
});

test("crash after database commit replays safely through durable transaction deduplication", async () => {
  const processed = new Set();
  let balance = 0,
    failCommit = true;
  const handler = paymentHandler({
    bankPayments: {
      async accept(source, t) {
        const key = `${source}:${t.id}`;
        if (!processed.has(key)) {
          processed.add(key);
          balance += t.amount;
        }
      },
    },
    consumer: {
      async commitOffsets() {
        if (failCommit) {
          failCommit = false;
          throw new Error("Worker lost connection");
        }
      },
    },
  });
  await assert.rejects(handler(message()));
  await handler(message());
  assert.equal(balance, transaction.amount);
});

test("queued Pay2S HTTP rejects forged callbacks and sends 503 when Kafka rejects", async (t) => {
  let writes = 0,
    fail = true;
  const bankPayments = { received() {} };
  const ingress = createPaymentIngress({
    config,
    bankPayments,
    topic: "payments",
    producer: {
      async send() {
        writes++;
        if (fail) throw new Error("down");
      },
    },
  });
  const app = express();
  app.use(express.json());
  app.use(createPay2SRouter({ config, bankPayments, paymentIngress: ingress }));
  app.use((e, req, res, next) =>
    res
      .status(e instanceof AppError ? e.status : 400)
      .json({ error: "rejected" }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => server.close());
  const send = (token) =>
    fetch(`http://127.0.0.1:${server.address().port}/webhooks/pay2s`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        transactions: [
          {
            id: 123,
            gateway: "MBBank",
            accountNumber: config.account,
            transferType: "IN",
            transferAmount: transaction.amount,
            content: transaction.content,
          },
        ],
      }),
    });
  assert.equal((await send("wrong")).status, 401);
  assert.equal(writes, 0);
  assert.equal((await send(config.pay2sWebhook)).status, 503);
  fail = false;
  const response = await send(config.pay2sWebhook);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
});

test("configuration refuses Kafka workers on demo files and invalid settings", () => {
  assert.throws(() =>
    infrastructureConfig({ APP_MODE: "demo", KAFKA_ENABLED: "true" }),
  );
  assert.throws(() => infrastructureConfig({ KAFKA_WORKER_CONCURRENCY: "-1" }));
  assert.throws(() => infrastructureConfig({ KAFKA_USERNAME: "user" }));
  assert.equal(infrastructureConfig({}).kafka, false);
});

test("Redis outage fails closed and rate-limit scopes are isolated", async () => {
  let ready = true;
  let missingScript = false,
    loads = 0;
  const client = {
    isOpen: true,
    get isReady() {
      return ready;
    },
    on() {},
    async connect() {},
    destroy() {
      this.isOpen = false;
    },
    async sendCommand(args) {
      if (args[0] === "SCRIPT") {
        loads++;
        return "script-sha";
      }
      if (missingScript) {
        missingScript = false;
        throw new Error("NOSCRIPT No matching script");
      }
      return [1, 60000];
    },
  };
  const infra = await createInfrastructure(
    {
      redis: true,
      kafka: false,
      redisUrl: "redis://localhost",
      prefix: "test:",
    },
    { redisFactory: () => client },
  );
  const a = infra.rateStore("login"),
    b = infra.rateStore("checkout");
  assert.notEqual(a.prefix, b.prefix);
  await a.init({ windowMs: 60000 });
  ready = false;
  assert.equal(infra.status().redis_ready, false);
  await assert.rejects(a.increment("client"), (e) => e.status === 503);
  ready = true;
  assert.equal((await a.increment("client")).totalHits, 1);
  const beforeReload = loads;
  missingScript = true;
  assert.equal((await a.increment("client")).totalHits, 1);
  assert.equal(loads, beforeReload + 1);
  await infra.close();
  assert.equal(client.isOpen, false);
});
