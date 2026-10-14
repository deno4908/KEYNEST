import test from "node:test";
import assert from "node:assert/strict";
import {
  createReceiptWorker,
  renderReceipt,
} from "../server/order-receipts.js";

const payload = {
  id: "11111111-1111-4111-8111-111111111111",
  number: "KN-TEST",
  email: "buyer@example.test",
  paid_at: "2026-10-14T10:00:00Z",
  method: "wallet",
  subtotal: 20000,
  discount: 5000,
  total: 15000,
  items: [
    {
      name: "<img src=x onerror=alert(1)>",
      variant_name: "Preorder & deluxe",
      price: 10000,
      quantity: 2,
      is_preorder: true,
      expected_delivery: "2026-11-01",
      keys: ["must-not-leak"],
    },
  ],
};
const config = {
  mode: "supabase",
  origin: "https://keynest.store",
  receipts: {
    enabled: true,
    apiKey: "test-api-key",
    sender: "store@example.test",
  },
};
test("receipt escapes product text and includes exact totals and preorder date without secrets", () => {
  const result = renderReceipt(payload, config.origin);
  assert.ok(result.htmlContent.includes("&lt;img"));
  assert.ok(!result.htmlContent.includes("<img"));
  assert.ok(!JSON.stringify(result).includes("must-not-leak"));
  assert.ok(result.textContent.includes("01/11/2026"));
  assert.ok(result.textContent.includes("15.000"));
  assert.ok(result.textContent.includes("/orders/" + payload.id));
});
for (const outcome of ["success", "failure", "timeout", "duplicate"]) {
  test(`receipt worker handles ${outcome} with a fenced acknowledgement`, async () => {
    let claimed = false,
      ack;
    const job = { id: payload.id, claim_token: "claim", payload };
    const store = {
      query: async (x) => x,
      client: {
        rpc: async (name, args) => {
          if (name === "claim_order_receipt") {
            if (claimed) return [];
            claimed = true;
            return [job];
          }
          ack = args;
          return true;
        },
      },
    };
    const worker = createReceiptWorker({
      store,
      config,
      logger: { error() {} },
      fetcher: async (url, options) => {
        assert.equal(url, "https://api.brevo.com/v3/smtp/email");
        const body = JSON.parse(options.body);
        assert.equal(body.headers.idempotencyKey, job.id);
        assert.deepEqual(body.to, [{ email: "buyer@example.test" }]);
        if (outcome === "timeout")
          throw new Error("Network error with sensitive contents");
        return {
          ok: outcome === "success",
          status: outcome === "failure" ? 503 : 400,
          json: async () =>
            outcome === "duplicate" ? { code: "duplicate_parameter" } : {},
        };
      },
    });
    await worker.tick();
    assert.equal(ack.p_claim, "claim");
    assert.equal(ack.p_sent, ["success", "duplicate"].includes(outcome));
    assert.ok(!ack.p_error.includes("sensitive"));
  });
}
test("disabled receipts never claim or send queued jobs", async () => {
  const worker = createReceiptWorker({
    store: {
      query() {
        assert.fail("must not claim");
      },
    },
    config: { ...config, receipts: { enabled: false } },
  });
  await worker.tick();
});
