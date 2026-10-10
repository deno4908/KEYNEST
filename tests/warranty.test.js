import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { warrantyInfo } from "../server/warranty.js";

process.env.NODE_ENV = "test";
process.env.APP_MODE = "demo";
const dir = mkdtempSync(join(tmpdir(), "keynest-warranty-"));
process.env.DEMO_DATA_PATH = join(dir, "store.json");
const { app, store } = await import("../server/index.js");
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/api`;
async function req(path, body, cookie = "", origin = "http://127.0.0.1:5173") {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "X-App-Request": "keynest",
      Cookie: cookie,
      "Idempotency-Key": randomUUID(),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: response.status,
    body: await response.json(),
    cookie: response.headers
      .getSetCookie()
      .map((s) => s.split(";")[0])
      .join("; "),
  };
}

test("order detail and warranty: ownership, immutable policy, delivery timing, expiry and support reply", async (t) => {
  t.after(() => {
    server.close();
    assert.ok(
      resolve(dir).startsWith(resolve(tmpdir()) + sep + "keynest-warranty-"),
    );
    rmSync(dir, { recursive: true, force: true });
  });
  const buyer = await req("/auth/login", {
    email: "student@keynest.local",
    password: "Student123!",
  });
  const admin = await req("/auth/login", {
    email: "admin@keynest.local",
    password: "Admin123!",
  });
  const uid = store.db.users.find((u) => u.role === "customer").id;
  const product = store.db.products.find((p) => p.slug === "hollow-knight");
  const v = product.variants[0];
  const payload = {
    items: [{ variant_id: v.id, quantity: 1 }],
    method: "wallet",
    coupon: "",
    customer_note: "",
  };
  const purchase = await req("/orders", payload, buyer.cookie);
  assert.equal(purchase.status, 201);
  const oid = purchase.body.id;
  const original = store.db.orders.find((o) => o.id === oid);
  assert.equal(purchase.body.items[0].warranty_days, 30);
  assert.ok(purchase.body.items[0].delivered_at);
  assert.ok(purchase.body.paid_at && purchase.body.completed_at);
  assert.equal(purchase.body.items[0].warranty_status, "active");
  assert.ok(purchase.body.items[0].product_image);
  assert.equal(
    purchase.body.items[0].key_ids.length,
    purchase.body.items[0].keys.length,
  );
  assert.equal((await req(`/orders/${oid}`)).status, 401);
  assert.equal((await req(`/orders/${oid}`, null, admin.cookie)).status, 404);
  assert.equal(
    (await req(`/orders/${randomUUID()}`, null, buyer.cookie)).status,
    404,
  );
  assert.equal(
    (await req(`/orders/${oid}`, null, buyer.cookie)).body.warranty_requests
      .length,
    0,
  );
  store.saveVariant(product.id, { ...v, warranty_days: 7 });
  assert.equal(
    (await req(`/orders/${oid}`, null, buyer.cookie)).body.items[0]
      .warranty_days,
    30,
  );

  const claim = {
    key_ids: purchase.body.items[0].key_ids,
    message: "Mã sản phẩm báo đã sử dụng khi kích hoạt.",
  };
  const url = `/orders/${oid}/warranty`;
  assert.equal(
    (await req(url, claim, buyer.cookie, "https://foreign.invalid")).status,
    403,
  );
  assert.equal(
    (await req(url, { ...claim, key_ids: [] }, buyer.cookie)).status,
    400,
  );
  assert.equal(
    (
      await req(
        url,
        { ...claim, key_ids: [...claim.key_ids, ...claim.key_ids] },
        buyer.cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (await req(url, { ...claim, user_id: uid }, buyer.cookie)).status,
    400,
  );
  assert.equal(
    (await req(url, { ...claim, key_ids: [randomUUID()] }, buyer.cookie))
      .status,
    400,
  );
  assert.equal((await req(url, claim, admin.cookie)).status, 404);
  const submitted = await req(url, claim, buyer.cookie);
  assert.equal(submitted.status, 201);
  assert.equal(submitted.body.kind, "warranty");
  assert.equal(submitted.body.order_id, oid);
  assert.equal(submitted.body.user_id, uid);
  assert.equal((await req(url, claim, buyer.cookie)).status, 409);
  assert.equal(
    (
      await req(
        `/admin/tickets/${submitted.body.id}/reply`,
        { reply: "Đã tiếp nhận và kiểm tra mã sản phẩm." },
        admin.cookie,
      )
    ).status,
    200,
  );
  const details = (await req(`/orders/${oid}`, null, buyer.cookie)).body;
  assert.equal(details.warranty_requests[0].status, "closed");
  assert.match(details.warranty_requests[0].reply, /kiểm tra/);

  const item = original.items[0];
  const expires = Date.parse(item.delivered_at) + 30 * 86400000;
  assert.equal(
    warrantyInfo({ ...item, keys: ["test"] }, "completed", expires - 1)
      .warranty_status,
    "active",
  );
  assert.equal(
    warrantyInfo({ ...item, keys: ["test"] }, "completed", expires)
      .warranty_status,
    "expired",
  );
  item.delivered_at = new Date(Date.now() - 31 * 86400000).toISOString();
  assert.throws(() => store.createWarranty(uid, oid, claim), /hết hạn/);
  item.warranty_days = 0;
  assert.throws(() => store.createWarranty(uid, oid, claim));
  delete item.warranty_days;
  delete item.delivered_at;
  assert.equal(
    warrantyInfo({ ...item, keys: ["test"] }, "completed").warranty_status,
    "verify",
  );
  const legacyTicket = store.createWarranty(uid, oid, claim);
  store.replyTicket(legacyTicket.id, "Cần kiểm tra ngày mua của đơn cũ.");
  store.refund(oid, {
    ticket_id: legacyTicket.id,
    method: "wallet",
    reason: "Warranty verified and approved for refund",
    actor: store.db.users.find((u) => u.role === "admin").id,
  });
  assert.throws(() => store.createWarranty(uid, oid, claim));
  assert.deepEqual(
    (await req(`/orders/${oid}`, null, buyer.cookie)).body.items[0].keys,
    [],
  );

  const manualProduct = store.db.products.find((p) =>
    p.variants.some((v) => v.delivery === "manual"),
  );
  const manual = manualProduct.variants.find((v) => v.delivery === "manual");
  const mixed = store.createOrder(
    uid,
    {
      ...payload,
      items: [
        { variant_id: v.id, quantity: 1 },
        { variant_id: manual.id, quantity: 1 },
      ],
      customer_note: "UID 12345 / test server",
    },
    randomUUID(),
  );
  const mixedItems = store.orders(uid, false, mixed.id)[0].items;
  const autoItem = mixedItems.find((i) => i.delivery === "key");
  const manualItem = mixedItems.find((i) => i.delivery === "manual");
  assert.equal(autoItem.warranty_days, 7);
  assert.ok(autoItem.delivered_at);
  assert.equal(manualItem.delivered_at, undefined);
  assert.deepEqual(manualItem.key_ids, []);
  assert.equal(mixed.paid_at != null, true);
  assert.equal(mixed.completed_at, undefined);
  store.fulfill(mixed.id, ["DEMO-SERVICE-DELIVERY"]);
  const delivered = store.orders(uid, false, mixed.id)[0];
  assert.equal(
    delivered.items.find((i) => i.delivery === "key").delivered_at,
    autoItem.delivered_at,
  );
  assert.ok(delivered.items.find((i) => i.delivery === "manual").delivered_at);
  assert.ok(delivered.completed_at);
  const deliveredManual = delivered.items.find((i) => i.delivery === "manual");
  assert.throws(() => store.createWarranty(uid, mixed.id, claim));
  assert.equal(
    store.createWarranty(uid, mixed.id, {
      ...claim,
      key_ids: deliveredManual.key_ids,
    }).kind,
    "warranty",
  );

  const bank = store.createOrder(
    uid,
    { ...payload, method: "sepay" },
    randomUUID(),
  );
  assert.equal(bank.items[0].delivered_at, undefined);
  const bankPayment = store.db.payments.find((p) => p.order_id === bank.id);
  store.settle("warranty-bank-1", bankPayment.code, bank.total);
  const bankResult = store.orders(uid, false, bank.id)[0];
  assert.ok(bankResult.paid_at && bankResult.items[0].delivered_at);
  const deliveredAt = bankResult.items[0].delivered_at;
  store.settle("warranty-bank-1", bankPayment.code, bank.total);
  assert.equal(
    store.orders(uid, false, bank.id)[0].items[0].delivered_at,
    deliveredAt,
  );
});
