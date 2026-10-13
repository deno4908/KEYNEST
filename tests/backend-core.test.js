import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { CompactEncrypt, importJWK } from 'jose';
import { accountRouter } from "../server/accounts.js";

process.env.NODE_ENV = "test";
process.env.APP_MODE = "demo";
const dir = mkdtempSync(join(tmpdir(), "keynest-core-"));
process.env.DEMO_DATA_PATH = join(dir, "store.json");
const { app, store } = await import("../server/index.js");

test("non-payment backend: catalog, account, inventory and ownership", async (t) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => {
    server.close();
    assert.ok(
      resolve(dir).startsWith(resolve(tmpdir()) + sep + "keynest-core-"),
    );
    rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(
    path,
    { method = "GET", cookie = "", body, csrf = true } = {},
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        ...(csrf
          ? { Origin: "http://127.0.0.1:5173", "X-App-Request": "keynest" }
          : {}),
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
  const login = async (email, password) =>
    request("/auth/login", { method: "POST", body: { email, password } });
  const customer = await login("student@keynest.local", "Student123!");
  const admin = await login("admin@keynest.local", "Admin123!");
  const product = store.products()[0];

  await t.test('encrypted browser credentials reach the normal login verifier', async () => {
    const key = await request('/auth/password-key');
    assert.equal(key.status, 200);
    const { jwk, kid, timestamp } = key.body;
    assert.equal('d' in jwk, false);
    const encrypted_credentials = await new CompactEncrypt(new TextEncoder().encode(JSON.stringify({
      path: '/auth/login', iat: timestamp, body: { email: 'student@keynest.local', password: 'Student123!' },
    }))).setProtectedHeader({ alg: 'ECDH-ES', enc: 'A256GCM', kid, typ: 'keynest-password+jwe' })
      .encrypt(await importJWK(jwk, 'ECDH-ES'));
    const response = await request('/auth/login', { method: 'POST', body: { encrypted_credentials } });
    assert.equal(response.status, 200);
    assert.equal(response.body.id, customer.body.id);
    assert.equal('password_hash' in response.body, false);
    assert.equal('password_history' in response.body, false);
  });

  await t.test(
    "catalog is bounded, stable and filters all conditions on the same variant",
    async () => {
      const a = await request("/catalog?page_size=3&sort=asc");
      const b = await request("/catalog?page_size=3&sort=asc&page=2");
      assert.equal(a.status, 200);
      assert.equal(a.body.items.length, 3);
      assert.equal(
        new Set([...a.body.items, ...b.body.items].map((p) => p.id)).size,
        6,
      );
      const prices = [...a.body.items, ...b.body.items].map((p) =>
        Math.min(...p.variants.map((v) => v.price)),
      );
      assert.deepEqual(
        prices,
        [...prices].sort((a, b) => a - b),
      );
      assert.equal((await request("/catalog?page_size=1000")).status, 400);
      assert.equal((await request("/catalog?min=100&max=10")).status, 400);
      assert.equal((await request("/catalog?page=-1")).status, 400);
      assert.equal((await request("/catalog?stock=true")).status, 400);
      const custom = {
        ...structuredClone(product),
        id: randomUUID(),
        slug: "qa-tieng-viet",
        name: "Đường truyền đặc biệt",
        featured: false,
        variants: [
          { ...product.variants[0], id: randomUUID(), price: 50000, stock: 0 },
          { ...product.variants[0], id: randomUUID(), price: 500000, stock: 2 },
        ],
      };
      store.db.products.push(custom);
      store.save();
      const found = await request("/catalog?q=duong%20truyen%20dac%20biet");
      assert.equal(found.body.total, 1);
      assert.equal(found.body.items[0].id, custom.id);
      assert.equal(
        (await request("/catalog?q=duong%20truyen&max=100000&stock=1")).body
          .total,
        0,
      );
      assert.equal(
        (await request("/products/qa-tieng-viet")).body.id,
        custom.id,
      );
      assert.equal(
        (await request(`/products/${custom.id}`)).body.id,
        custom.id,
      );
      custom.active = false;
      store.save();
      assert.equal((await request("/catalog?q=duong%20truyen")).body.total, 0);
      assert.equal((await request(`/products/${custom.id}`)).status, 404);
      assert.equal(
        (await request(`/catalog?page=9999&page_size=3`)).body.page,
        (await request(`/catalog?page=9999&page_size=3`)).body.pages,
      );
    },
  );

  await t.test(
    "ticket/order detail rejects cross-account access and inventory never exposes key material",
    async () => {
      const buyer = store.register(
        "owner@example.test",
        "OwnerPassword123!",
        "Owner",
      );
      const ticket = store.createTicket(buyer.id, {
        subject: "Ownership",
        message: "Private support message",
      });
      const own = await login(buyer.email, "OwnerPassword123!");
      assert.equal((await request(`/tickets/${ticket.id}`)).status, 401);
      assert.equal(
        (await request(`/tickets/${ticket.id}`, { cookie: customer.cookie }))
          .status,
        404,
      );
      assert.equal(
        (await request(`/tickets/${ticket.id}`, { cookie: own.cookie })).body
          .message,
        ticket.message,
      );
      assert.equal(
        (
          await request(`/admin/tickets/${ticket.id}`, {
            cookie: customer.cookie,
          })
        ).status,
        403,
      );
      const detail = await request(`/admin/tickets/${ticket.id}`, {
        cookie: admin.cookie,
      });
      assert.equal(detail.body.customer.email, buyer.email);
      assert.equal("password_hash" in detail.body.customer, false);
      const order = store.createOrder(
        customer.body.id,
        {
          items: [{ variant_id: product.variants[0].id, quantity: 1 }],
          method: "wallet",
          coupon: "",
          customer_note: "",
        },
        randomUUID(),
      );
      const orderDetail = await request(`/admin/orders/${order.id}`, {
        cookie: admin.cookie,
      });
      assert.equal(orderDetail.status, 200);
      assert.equal(orderDetail.body.customer.id, customer.body.id);
      assert.equal(orderDetail.body.items[0].name, product.name);
      assert.equal("fingerprint" in orderDetail.body, false);
      assert.equal(
        (await request(`/admin/orders/${order.id}`, { cookie: own.cookie }))
          .status,
        403,
      );
      assert.equal(
        (
          await request(`/admin/orders/${randomUUID()}`, {
            cookie: admin.cookie,
          })
        ).status,
        404,
      );
      const path = `/admin/inventory/${product.variants[0].id}`;
      assert.equal((await request(path)).status, 401);
      assert.equal(
        (await request(path, { cookie: customer.cookie })).status,
        403,
      );
      const inventory = await request(path + "?state=assigned&page_size=1", {
        cookie: admin.cookie,
      });
      assert.equal(inventory.body.items.length, 1);
      assert.equal(inventory.body.items[0].order_id, order.id);
      assert.deepEqual(Object.keys(inventory.body.items[0]).sort(), [
        "id",
        "item_id",
        "order_id",
        "variant_id",
      ]);
      assert.equal(
        (await request(path + "?state=invalid", { cookie: admin.cookie }))
          .status,
        400,
      );
      assert.equal(
        (
          await request(`/admin/inventory/${randomUUID()}`, {
            cookie: admin.cookie,
          })
        ).status,
        404,
      );
    },
  );

  await t.test(
    "password change requires current password and CSRF, rotates demo sessions and persists hash only",
    async () => {
      const payload = {
        current_password: "Student123!",
        password: "NewPassword123!",
        password_confirmation: "NewPassword123!",
      };
      assert.equal(
        (await request("/me/password", { method: "POST", body: payload }))
          .status,
        401,
      );
      assert.equal(
        (
          await request("/me/password", {
            method: "POST",
            cookie: customer.cookie,
            body: payload,
            csrf: false,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/me/password", {
            method: "POST",
            cookie: customer.cookie,
            body: { ...payload, current_password: "WrongPassword123!" },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request("/me/password", {
            method: "POST",
            cookie: customer.cookie,
            body: { ...payload, password_confirmation: "Mismatch123!" },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request("/me/password", {
            method: "POST",
            cookie: customer.cookie,
            body: { ...payload, user_id: admin.body.id },
          })
        ).status,
        400,
      );
      const changed = await request("/me/password", {
        method: "POST",
        cookie: customer.cookie,
        body: payload,
      });
      assert.equal(changed.status, 200);
      assert.equal(
        (await request("/me", { cookie: customer.cookie })).status,
        401,
      );
      assert.equal(
        (await request("/me", { cookie: changed.cookie })).status,
        200,
      );
      assert.equal(
        (await login("student@keynest.local", "Student123!")).status,
        401,
      );
      assert.equal(
        (await login("student@keynest.local", "NewPassword123!")).status,
        200,
      );
      assert.equal(JSON.stringify(store.db).includes("NewPassword123!"), false);
      assert.equal(
        (await request("/me", { cookie: admin.cookie })).status,
        200,
      );
    },
  );
});

test("Supabase password adapter reauthenticates the same user and handles provider failure", async (t) => {
  for (const scenario of [
    "ok",
    "wrong-user",
    "bad-password",
    "update-failed",
    "reused",
  ]) {
    await t.test(scenario, async () => {
      let updated = false,
        sessionSet = false,
        signedOut = false;
      const app = express();
      app.use(express.json());
      app.use(
        accountRouter({
          config: { mode: "supabase" },
          store: {},
          passwordHistory: { async change(id, password, update) {
            assert.equal(id, 'owner');
            assert.equal(password, 'NewPassword123!');
            if (scenario === 'reused') throw new Error('Mật khẩu đã dùng trong 30 ngày qua.');
            return update();
          } },
          auth: (req, res, next) => {
            req.user = { id: "owner", email: "owner@example.test" };
            next();
          },
          limiter: () => (req, res, next) => next(),
          setAuth: () => {
            sessionSet = true;
          },
          makeAuthClient: () => ({
            auth: {
              signInWithPassword: async (input) => {
                assert.equal(input.email, "owner@example.test");
                assert.equal(input.password, "OldPassword123!");
                return {
                  data: {
                    user: { id: scenario === "wrong-user" ? "other" : "owner" },
                    session: {},
                  },
                  error: scenario === "bad-password" ? {} : null,
                };
              },
              updateUser: async () => {
                updated = true;
                return { error: scenario === "update-failed" ? {} : null };
              },
              signOut: async () => {
                signedOut = true;
                return { error: null };
              },
            },
          }),
        }),
      );
      app.use((err, req, res, next) =>
        res.status(err.status || 400).json({ error: err.message }),
      );
      const server = app.listen(0, "127.0.0.1");
      await new Promise((r) => server.once("listening", r));
      t.after(() => server.close());
      const result = await fetch(
        `http://127.0.0.1:${server.address().port}/me/password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            current_password: "OldPassword123!",
            password: "NewPassword123!",
            password_confirmation: "NewPassword123!",
          }),
        },
      );
      assert.equal(result.status, scenario === "ok" ? 200 : 400);
      assert.equal(updated, ["ok", "update-failed"].includes(scenario));
      assert.equal(sessionSet, scenario === "ok");
      assert.equal(signedOut, ["update-failed", "reused"].includes(scenario));
    });
  }
});
