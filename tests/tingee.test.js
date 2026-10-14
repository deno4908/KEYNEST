import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  createTingeeClient,
  tingeeTimestamp,
  tingeeFailureCode,
} from "../server/tingee.js";
import { createBankPayments } from "../server/bank-payments.js";
import { createPaymentRouting } from "../server/payment-routing.js";
const cfg = {
  clientId: "test-client",
  secret: "test-secret",
  bankBin: "970418",
  vaAccount: "TEST-VA",
  accountName: "TEST STORE",
  baseUrl: "https://open-api.tingee.vn",
};
const payment = {
  id: "payment-test",
  code: "KNTEST",
  amount: 10000,
  status: "pending",
  expires_at: new Date(Date.now() + 15 * 60000).toISOString(),
};
const route = {
  payment_id: payment.id,
  provider: "tingee",
  state: "ready",
  bill_id: "bill-test",
  qr_account: "QR-TEST",
  bank_bin: cfg.bankBin,
  va_account: cfg.vaAccount,
  payment,
};
const bill = {
  billId: route.bill_id,
  qrAccount: route.qr_account,
  bankBin: cfg.bankBin,
  vaAccountNumber: cfg.vaAccount,
  qrCodeType: "dynamic-one-time-payment",
  amount: 10000,
  totalAmountPaid: 10000,
  status: "fully-paid",
};
const config = {
  mode: "supabase",
  paymentProvider: "tingee",
  tingee: cfg,
  pay2sWebhook: "test-pay2s",
  bank: "MB",
  account: "BACKUP",
  accountName: "BACKUP NAME",
};
const logger = { error() {} };
test("Tingee signs the exact transmitted body with UTC+7 milliseconds and renders the returned dynamic QR", async () => {
  assert.equal(
    tingeeTimestamp(Date.parse("2026-10-14T17:00:00.123Z")),
    "20261015000000123",
  );
  const client = createTingeeClient(cfg, async (url, options) => {
    assert.equal(url, cfg.baseUrl + "/v1/generate-dynamic-qr");
    assert.equal(
      options.headers["x-signature"],
      createHmac("sha512", cfg.secret)
        .update(options.headers["x-request-timestamp"] + ":" + options.body)
        .digest("hex"),
    );
    assert.equal(options.redirect, "error");
    const body = JSON.parse(options.body);
    assert.equal(body.qrCodeType, "dynamic-one-time-payment");
    assert.equal(body.vaAccountNumber, cfg.vaAccount);
    assert.equal(body.amount, 10000);
    assert.ok(body.expireInMinute >= 13 && body.expireInMinute <= 15);
    return {
      ok: true,
      json: async () => ({
        code: "00",
        data: {
          billId: "bill-test",
          qrAccount: "QR-TEST",
          qrCode: "00020101021238540010A00000072701240006970418",
        },
      }),
    };
  });
  const qr = await client.generate(payment);
  assert.equal(qr.bill_id, "bill-test");
  assert.match(qr.qr_image, /^data:image\/png;base64,/);
  assert.ok(Date.parse(qr.expires_at) <= Date.parse(payment.expires_at));
});
test("Tingee dynamic MBBank QR uses the MB BIN and displays the bank name", async () => {
  const mbConfig = { ...cfg, bankBin: "970422", vaAccount: "MB-LINKED-VA" };
  const client = createTingeeClient(mbConfig, async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.bankBin, "970422");
    assert.equal(body.vaAccountNumber, mbConfig.vaAccount);
    return {
      ok: true,
      json: async () => ({
        code: "00",
        data: {
          billId: "mb-bill-test",
          qrAccount: "MB-QR-ACCOUNT",
          qrCode: "00020101021238540010A00000072701240006970422",
        },
      }),
    };
  });
  const qr = await client.generate(payment);
  assert.equal(qr.bank, "MBBank");
  assert.equal(qr.bank_bin, "970422");
  assert.equal(qr.qr_kind, "dynamic");
  assert.equal(qr.bill_id, "mb-bill-test");
});
test("Tingee rejects bill identity, receiving account, type and amount mismatches", async () => {
  for (const change of [
    { billId: "other" },
    { qrAccount: "other" },
    { bankBin: "970422" },
    { vaAccountNumber: "other" },
    { amount: 9999 },
    { qrCodeType: "dynamic-recurring-payment" },
    { totalAmountPaid: "10000" },
  ]) {
    const client = createTingeeClient(cfg, async () => ({
      ok: true,
      json: async () => ({
        code: "00",
        data: { billInfo: { ...bill, ...change } },
      }),
    }));
    await assert.rejects(client.status(route));
  }
  const client = createTingeeClient(cfg, async () => ({
    ok: true,
    json: async () => ({ code: "97", message: "sensitive provider details" }),
  }));
  await assert.rejects(client.status(route), /tingee_rejected/);
});
test("Tingee refuses to auto-reconcile legacy static routes without their linked VA", async () => {
  let requests = 0;
  const client = createTingeeClient(cfg, async () => {
    requests++;
    throw new Error("must not call provider for an invalid route");
  });
  await assert.rejects(
    client.transactions({
      ...route,
      qr_kind: "static",
      account: "ORIGINAL-VCB-ACCOUNT",
      va_account: null,
    }),
    (error) => {
      assert.equal(tingeeFailureCode(error), "tingee_static_va_required");
      return true;
    },
  );
  assert.equal(requests, 0);
});
test("Tingee static history tolerates incomplete unrelated rows but only returns exact credits", async () => {
  const receivedAt = new Date();
  const staticPayment = {
    ...payment,
    code: "KNF47E142417EC73C6",
    created_at: new Date(receivedAt.getTime() - 60_000).toISOString(),
  };
  const linkedVa = "TGE61014104613VCB";
  const requestedBodies = [];
  const client = createTingeeClient(cfg, async (_url, init) => ({
    ok: true,
    json: async () => {
      requestedBodies.push(JSON.parse(init.body));
      return {
        code: "00",
        data: {
          totalCount: 4,
          items: [
            {
              transactionId: "tx-matching",
              accountNumber: `1072631208VA: ${linkedVa}`,
              bankBin: cfg.bankBin,
              amount: "10000",
              type: "CREDIT",
              transactionTime: receivedAt.toISOString(),
              description: `Thanh toan ${staticPayment.code}`,
            },
            {
              transactionId: "tx-no-memo",
              accountNumber: linkedVa,
              bankBin: cfg.bankBin,
              amount: 10000,
              type: "CREDIT",
              transactionTime: receivedAt.toISOString(),
              description: null,
            },
            {
              transactionId: "tx-substring-only",
              accountNumber: `PREFIX${linkedVa}SUFFIX`,
              bankBin: cfg.bankBin,
              amount: 10000,
              type: "CREDIT",
              transactionTime: receivedAt.toISOString(),
              description: `Thanh toan ${staticPayment.code}`,
            },
            null,
          ],
        },
      };
    },
  }));
  const matches = await client.transactions({
    ...route,
    qr_kind: "static",
    account: linkedVa,
    va_account: linkedVa,
    payment: staticPayment,
  });
  assert.deepEqual(matches.map((row) => row.transactionId), ["tx-matching"]);
  assert.equal(Object.hasOwn(requestedBodies[0], "filter"), false);
  assert.deepEqual(requestedBodies[0].vaAccountNumbers, [linkedVa]);
  assert.equal(requestedBodies[0].bankBin, cfg.bankBin);
});

function memoryStore(
  initial = { payment_id: payment.id, state: "unassigned", attempts: 0 },
) {
  let saved = { ...initial };
  const settlements = [];
  const store = {
    query: async (p) => (await p).data,
    client: {
      async rpc(name, args) {
        if (name === "claim_payment_route") {
          if (saved.state === "unassigned")
            saved = {
              ...saved,
              state: "creating",
              attempts: saved.attempts + 1,
              claim_token: args.p_claim,
            };
          return { data: [{ ...saved }] };
        }
        if (name === "finish_payment_route") {
          if (saved.claim_token !== args.p_claim) return { data: false };
          saved = {
            ...saved,
            ...args.p_data,
            state: args.p_data.provider ? "ready" : "failed",
            claim_token: null,
          };
          return { data: true };
        }
        if (name === "claim_tingee_polls")
          return { data: [{ ...saved, payment: saved.payment || payment }] };
        if (name === "settle_routed_payment") {
          settlements.push(args);
          return { data: { paid: true } };
        }
        throw new Error("Unexpected RPC");
      },
      from(table) {
        assert.equal(table, "payment_routes");
        return {
          update: (data) => ({
            eq: async () => {
              saved = { ...saved, ...data };
              return { data: null };
            },
          }),
        };
      },
    },
  };
  return { store, read: () => saved, settlements };
}
test("one creation claim across concurrent requests; primary is pinned after publication", async () => {
  const db = memoryStore();
  let calls = 0;
  const client = {
    generate: async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return { ...route, qr_image: "data:image/png;base64,test" };
    },
  };
  const router = createPaymentRouting({
    store: db.store,
    config,
    client,
    logger,
  });
  await Promise.all([router.prepare(payment), router.prepare(payment)]);
  assert.equal(calls, 1);
  assert.equal(db.read().provider, "tingee");
  await router.prepare(payment);
  assert.equal(calls, 1);
});
test("generation error automatically selects Pay2S and never retries Tingee for that payment", async () => {
  const db = memoryStore();
  let calls = 0;
  const router = createPaymentRouting({
    store: db.store,
    config,
    logger,
    client: {
      generate: async () => {
        calls++;
        throw new Error("timeout");
      },
    },
  });
  const result = await router.prepare(payment);
  assert.equal(result.provider, "pay2s");
  assert.equal(result.account, "BACKUP");
  await router.prepare(payment);
  assert.equal(calls, 1);
});
test("unknown generation after process crash uses fallback instead of generating a second bill", async () => {
  const db = memoryStore({
    payment_id: payment.id,
    state: "unassigned",
    attempts: 1,
  });
  const router = createPaymentRouting({
    store: db.store,
    config,
    logger,
    client: {
      generate() {
        assert.fail("must not generate again");
      },
    },
  });
  assert.equal((await router.prepare(payment)).provider, "pay2s");
});
test("without configured fallback a failed generation exposes no bank destination", async () => {
  const db = memoryStore();
  const router = createPaymentRouting({
    store: db.store,
    config: { ...config, pay2sWebhook: "" },
    logger,
    client: {
      generate: async () => {
        throw new Error("no QR");
      },
    },
  });
  const result = await router.prepare(payment);
  assert.equal(result.state, "failed");
  assert.equal(result.account, undefined);
});
test("polling credits a fully paid exact bill and status failures never switch the gateway", async () => {
  for (const outcome of ["paid", "pending", "overpaid", "error"]) {
    const db = memoryStore(route);
    const router = createPaymentRouting({
      store: db.store,
      config,
      logger,
      client: {
        generate() {
          assert.fail("no generation while polling");
        },
        status: async () => {
          if (outcome === "error") throw new Error("offline");
          return {
            ...bill,
            status: outcome === "pending" ? "active" : "fully-paid",
            totalAmountPaid:
              outcome === "overpaid"
                ? 11000
                : outcome === "pending"
                  ? 0
                  : 10000,
          };
        },
      },
    });
    await router.tick();
    assert.equal(db.settlements.length, outcome === "paid" ? 1 : 0);
    assert.equal(db.read().provider, "tingee");
    if (outcome === "paid") {
      assert.equal(db.settlements[0].p_bill, "bill-test");
      assert.match(db.settlements[0].p_transaction, /^tingee:[a-f0-9]{64}$/);
    }
  }
});

test("expired and cancelled QR is disabled and a final read catches money arriving during deletion", async () => {
  for (const amount of [0, 10000]) {
    const db = memoryStore({
      ...route,
      payment: { ...payment, status: "cancelled" },
    });
    let reads = 0,
      deletes = 0;
    const router = createPaymentRouting({
      store: db.store,
      config,
      logger,
      client: {
        status: async () => ({
          ...bill,
          status: "active",
          totalAmountPaid: ++reads === 1 ? 0 : amount,
        }),
        remove: async () => {
          deletes++;
        },
      },
    });
    await router.tick();
    assert.equal(reads, 2);
    assert.equal(deletes, 1);
    assert.equal(db.settlements.length, amount ? 1 : 0);
    assert.equal(db.read().remote_closed, true);
  }
});

test("Pay2S remains authenticated-provider eligible with Tingee primary and uses the source-checked settlement RPC", async () => {
  const calls = [];
  const bank = createBankPayments({
    config,
    store: {
      settleBank: async (...args) => {
        calls.push(args);
        return { paid: true };
      },
    },
  });
  const transaction = {
    id: "backup-1",
    account: "BACKUP",
    direction: "in",
    currency: "VND",
    amount: 10000,
    content: "KN0123456789ABCDEF",
  };
  assert.equal(bank.status().provider, "tingee");
  assert.equal(bank.status().fallback_ready, true);
  assert.equal((await bank.accept("pay2s", transaction)).paid, true);
  assert.equal(calls[0][0], "pay2s");
  assert.match(calls[0][1], /^pay2s:/);
  await assert.rejects(bank.accept("sepay", transaction));
  await assert.rejects(
    bank.accept("pay2s", { ...transaction, account: "OTHER" }),
  );
  assert.equal(calls.length, 1);
});

test("Tingee fallback persists safe HTTP/provider diagnostics without response secrets", async () => {
  for (const [ok, status, body, expected] of [
    [
      true,
      200,
      { code: "97", message: "SECRET-VA-CLIENT" },
      "tingee_rejected_97",
    ],
    [
      false,
      401,
      { code: "12", message: "SECRET-VA-CLIENT" },
      "tingee_http_401_code_12",
    ],
    [
      true,
      200,
      { code: "SECRET-VA-CLIENT", message: "SECRET" },
      "tingee_rejected",
    ],
  ]) {
    const db = memoryStore();
    const logs = [];
    const client = createTingeeClient(cfg, async () => ({
      ok,
      status,
      json: async () => body,
    }));
    const router = createPaymentRouting({
      store: db.store,
      config,
      client,
      logger: { error: (msg) => logs.push(msg) },
    });
    await router.prepare(payment);
    assert.equal(db.read().provider, "pay2s");
    assert.equal(db.read().error, expected);
    assert.ok(logs[0].includes(expected));
    assert.ok(!JSON.stringify(logs).includes("SECRET"));
  }
  assert.equal(
    tingeeFailureCode(new Error("secret credential")),
    "tingee_unexpected_error",
  );
});
test("Tingee distinguishes timeout, network and invalid JSON without recording raw errors", async () => {
  for (const [fetcher, expected] of [
    [
      async () => {
        throw new DOMException("SECRET", "TimeoutError");
      },
      "tingee_timeout",
    ],
    [
      async () => {
        throw new TypeError("SECRET");
      },
      "tingee_network_error",
    ],
    [
      async () => ({
        ok: true,
        json: async () => {
          throw new Error("SECRET");
        },
      }),
      "tingee_invalid_response",
    ],
  ]) {
    try {
      await createTingeeClient(cfg, fetcher).generate(payment);
      assert.fail("must fail");
    } catch (error) {
      assert.equal(tingeeFailureCode(error), expected);
    }
  }
});
