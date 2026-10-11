import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createSellers } from "../server/sellers.js";
import { settleSellerRevenue } from "../server/seller-accounting.js";
import { SELLER_TERMS_VERSION } from "../shared/seller-terms.js";
process.env.NODE_ENV = "test";
process.env.APP_MODE = "demo";
const dir = mkdtempSync(join(tmpdir(), "keynest-sellers-"));
process.env.DEMO_DATA_PATH = join(dir, "store.json");
const { app, store } = await import("../server/index.js");
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/api`;
async function req(path, body, cookie = "") {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:5173",
      "X-App-Request": "keynest",
      Cookie: cookie,
      "Idempotency-Key": randomUUID(),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: r.status,
    body: await r.json(),
    cookie: r.headers
      .getSetCookie()
      .map((s) => s.split(";")[0])
      .join("; "),
  };
}
test("seller HTTP ownership, onboarding, payment settlement, withdrawals and refund debt", async (t) => {
  t.after(() => {
    server.close();
    assert.ok(
      resolve(dir).startsWith(resolve(tmpdir()) + sep + "keynest-sellers-"),
    );
    rmSync(dir, { recursive: true, force: true });
  });
  const admin = await req("/auth/login", {
    email: "admin@keynest.local",
    password: "Admin123!",
  });
  const buyer = await req("/auth/login", {
    email: "student@keynest.local",
    password: "Student123!",
  });
  const seller = store.register(
    "seller@example.test",
    "Seller123!",
    "Seller Test",
  );
  const login = await req("/auth/login", {
    email: seller.email,
    password: "Seller123!",
  });
  assert.equal((await req("/seller/overview", null, buyer.cookie)).status, 403);
  assert.equal(
    (
      await req(
        "/admin/sellers/role",
        { user_id: seller.id, role: "seller" },
        buyer.cookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await req(
        "/admin/sellers/role",
        { user_id: seller.id, role: "seller" },
        admin.cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (await req("/seller/withdrawals", { amount: 50000 }, login.cookie)).status,
    403,
  );
  const profile = {
    name: "Seller Test",
    accepted: true,
    terms_version: SELLER_TERMS_VERSION,
    fee_bps: 700,
  };
  assert.equal(
    (
      await req(
        "/seller/profile",
        { ...profile, accepted: false },
        login.cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (await req("/seller/profile", profile, login.cookie)).status,
    200,
  );
  const payload = {
    slug: "seller-test",
    name: "Seller Test Product",
    category: "game",
    platform: "PC",
    subcategory: "",
    subtitle: "",
    description: "",
    image: "",
    featured: true,
    active: true,
  };
  const created = await req("/seller/products", payload, login.cookie);
  assert.equal(created.status, 200);
  const product = store.db.products.find((p) => p.id === created.body.id);
  assert.equal(product.seller_id, seller.id);
  assert.equal(product.featured, false);
  const foreign = store.db.products.find((p) => !p.seller_id);
  assert.equal(
    (
      await req(
        "/seller/products",
        { ...payload, id: foreign.id },
        login.cookie,
      )
    ).status,
    403,
  );
  const variant = {
    name: "Service",
    price: 100000,
    original_price: 100000,
    delivery: "manual",
    stock: 20,
    region: "Global",
    warranty_days: 30,
  };
  assert.equal(
    (
      await req(
        `/seller/products/${product.id}/variants`,
        variant,
        login.cookie,
      )
    ).status,
    200,
  );
  assert.notEqual(
    (
      await req(
        `/seller/products/${product.id}/variants`,
        { ...variant, id: foreign.variants[0].id },
        login.cookie,
      )
    ).status,
    200,
  );
  const orderPayload = {
    items: [{ variant_id: product.variants[0].id, quantity: 1 }],
    method: "wallet",
    coupon: "",
    customer_note: "Player 123",
  };
  assert.equal((await req("/orders", orderPayload, login.cookie)).status, 409);
  const order = await req("/orders", orderPayload, buyer.cookie);
  assert.equal(order.status, 201);
  const owner = store.db.users.find((u) => u.id === seller.id),
    rawOrder = store.db.orders.find((o) => o.id === order.body.id);
  assert.equal(owner.balance, 93000);
  assert.equal(rawOrder.items[0].seller_fee, 7000);
  settleSellerRevenue(store, rawOrder);
  assert.equal(owner.balance, 93000);
  const pending = await req(
    "/orders",
    { ...orderPayload, method: "sepay" },
    buyer.cookie,
  );
  assert.equal(pending.status, 201);
  assert.equal(owner.balance, 93000);
  await req("/admin/sellers/fee", { fee_bps: 1000 }, admin.cookie);
  const pay = store.db.payments.find((p) => p.order_id === pending.body.id);
  store.settle("seller-bank", pay.code, pay.amount);
  store.settle("seller-bank", pay.code, pay.amount);
  assert.equal(owner.balance, 186000);
  const w = {
    amount: 50000,
    bank: "VCB",
    account_number: "123456789",
    account_name: "Seller Test",
    idempotency: randomUUID(),
  };
  const withdrawal = await req("/seller/withdrawals", w, login.cookie);
  assert.equal(withdrawal.status, 201);
  assert.equal(
    (await req("/seller/withdrawals", w, login.cookie)).body.id,
    withdrawal.body.id,
  );
  assert.equal(owner.balance, 136000);
  assert.equal(
    (await req("/seller/withdrawals", { ...w, amount: 60000 }, login.cookie))
      .status,
    409,
  );
  assert.equal(
    (
      await req(
        `/admin/sellers/withdrawals/${withdrawal.body.id}`,
        { status: "paid", reason: "Done", reference: "" },
        admin.cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await req(
        `/admin/sellers/withdrawals/${withdrawal.body.id}`,
        { status: "rejected", reason: "Wrong account" },
        admin.cookie,
      )
    ).status,
    200,
  );
  assert.equal(owner.balance, 186000);
  assert.equal(
    (
      await req(
        `/admin/sellers/withdrawals/${withdrawal.body.id}`,
        { status: "rejected", reason: "Again" },
        admin.cookie,
      )
    ).status,
    409,
  );
  const item = rawOrder.items[0];
  assert.equal(
    (
      await req(
        `/seller/items/${item.id}/fulfill`,
        { secrets: ["Delivered"] },
        login.cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await req(
        `/seller/items/${item.id}/fulfill`,
        { secrets: ["Again"] },
        login.cookie,
      )
    ).status,
    409,
  );
  const held = await req(
    "/seller/withdrawals",
    { ...w, idempotency: randomUUID() },
    login.cookie,
  );
  assert.equal(held.status, 201);
  settleSellerRevenue(store, rawOrder, true);
  assert.equal(owner.balance, 93000);
  assert.equal(
    store.db.seller_withdrawals.find((w) => w.id === held.body.id).status,
    "cancelled",
  );
  settleSellerRevenue(store, rawOrder, true);
  assert.equal(owner.balance, 93000);
  owner.balance = 1000;
  const bankOrder = store.db.orders.find((o) => o.id === pending.body.id);
  settleSellerRevenue(store, bankOrder, true);
  assert.equal(owner.balance, 0);
  assert.equal(owner.seller_debt, 92000);
  assert.equal(
    (
      await req(
        "/seller/withdrawals",
        { ...w, idempotency: randomUUID() },
        login.cookie,
      )
    ).status,
    409,
  );
  const next = await req("/orders", orderPayload, buyer.cookie);
  assert.equal(next.status, 201);
  assert.equal(owner.seller_debt, 2000);
  assert.equal(owner.balance, 0);
  const overview = await req("/seller/overview", null, login.cookie);
  assert.ok(overview.body.products.every((p) => p.seller_id === seller.id));
  assert.ok(!JSON.stringify(overview.body).includes("password_hash"));
  const publicProduct = store.products().find((p) => p.id === product.id);
  assert.equal(publicProduct.seller.name, "Seller Test");
  assert.equal(publicProduct.seller.email, undefined);
  await req(
    "/admin/sellers/role",
    { user_id: seller.id, role: "customer" },
    admin.cookie,
  );
  assert.equal(product.active, false);
  assert.equal((await req("/seller/overview", null, login.cookie)).status, 403);
  await createSellers(store).command(
    store.db.users.find((u) => u.role === "admin").id,
    "fee",
    { fee_bps: 700 },
  );
});
