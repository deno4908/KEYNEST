import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
process.env.NODE_ENV = "test";
process.env.APP_MODE = "demo";
process.env.BANK_PAYMENT_PROVIDER = "sepay";
const dir = mkdtempSync(join(tmpdir(), "keynest-test-"));
process.env.DEMO_DATA_PATH = join(dir, "store.json");
const { app, store } = await import("../server/index.js");
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/api`;
async function request(
  path,
  {
    method = "GET",
    body,
    cookie = "",
    key,
    origin = "http://127.0.0.1:5173",
    header = true,
    authorization,
  } = {},
) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(header ? { "X-App-Request": "keynest" } : {}),
      Cookie: cookie,
      ...(key ? { "Idempotency-Key": key } : {}),
      ...(authorization ? { Authorization: authorization } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: res.status,
    body: await res.json(),
    cookie: res.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; "),
  };
}
test("store API: permissions, atomic orders, ownership, money and fulfillment", async (t) => {
  t.after(() => {
    server.close();
    assert.ok(
      resolve(dir).startsWith(resolve(tmpdir()) + sep + "keynest-test-"),
    );
    rmSync(dir, { recursive: true, force: true });
  });
  const login = await request("/auth/login", {
    method: "POST",
    body: { email: "student@keynest.local", password: "Student123!" },
  });
  assert.equal(login.status, 200);
  const customer = login.cookie;
  const adminLogin = await request("/auth/login", {
    method: "POST",
    body: { email: "admin@keynest.local", password: "Admin123!" },
  });
  const admin = adminLogin.cookie;
  await t.test(
    "banner publishing requires admin and rejects unsafe content links",
    async () => {
      const banner = {
        title: "Test campaign",
        eyebrow: "TEST",
        description: "Integration check",
        image:
          "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1245620/library_hero.jpg",
        href: "/catalog?category=game",
        cta: "Browse games",
        active: false,
        sort_order: 9,
      };
      assert.equal((await request("/admin/banners")).status, 401);
      assert.equal(
        (await request("/admin/banners", { cookie: customer })).status,
        403,
      );
      assert.equal(
        (
          await request("/admin/banners", {
            method: "POST",
            cookie: customer,
            body: banner,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/admin/banners", {
            method: "POST",
            cookie: admin,
            origin: "https://evil.test",
            body: banner,
          })
        ).status,
        403,
      );
      for (const href of [
        "javascript:alert(1)",
        "//evil.test",
        "/\\evil.test",
        "https://evil.test",
        "/catalog?x=<script>",
      ]) {
        assert.equal(
          (
            await request("/admin/banners", {
              method: "POST",
              cookie: admin,
              body: { ...banner, href },
            })
          ).status,
          400,
        );
      }
      assert.equal(
        (
          await request("/admin/banners", {
            method: "POST",
            cookie: admin,
            body: { ...banner, image: "https://evil.test/x.png" },
          })
        ).status,
        400,
      );
      const saved = await request("/admin/banners", {
        method: "POST",
        cookie: admin,
        body: banner,
      });
      assert.equal(saved.status, 200);
      assert.ok(
        !(await request("/banners")).body.some((b) => b.id === saved.body.id),
      );
      await request("/admin/banners", {
        method: "POST",
        cookie: admin,
        body: { ...banner, id: saved.body.id, active: true },
      });
      assert.ok(
        (await request("/banners")).body.some((b) => b.id === saved.body.id),
      );
      await request("/admin/banners", {
        method: "POST",
        cookie: admin,
        body: { ...banner, id: saved.body.id, active: false },
      });
      assert.ok(
        !(await request("/banners")).body.some((b) => b.id === saved.body.id),
      );
    },
  );
  await t.test(
    "guest and customer cannot access admin; CSRF cannot create order",
    async () => {
      assert.equal((await request("/admin/overview")).status, 401);
      assert.equal(
        (await request("/admin/overview", { cookie: customer })).status,
        403,
      );
      assert.equal(
        (
          await request("/wallet/topup", {
            method: "POST",
            cookie: customer,
            body: { amount: 100000 },
            origin: "https://evil.test",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/wallet/topup", {
            method: "POST",
            cookie: customer,
            body: { amount: 100000 },
            header: false,
          })
        ).status,
        403,
      );
    },
  );
  const products = (await request("/products")).body;
  const variant = products.find((p) => p.slug === "hollow-knight").variants[0];
  let order;
  await t.test(
    "server rejects forged total, duplicate lines and negative quantity",
    async () => {
      for (const payload of [
        {
          items: [{ variant_id: variant.id, quantity: 1 }],
          method: "wallet",
          total: 1,
        },
        { items: [{ variant_id: variant.id, quantity: -1 }], method: "wallet" },
        {
          items: [
            { variant_id: variant.id, quantity: 1 },
            { variant_id: variant.id, quantity: 1 },
          ],
          method: "wallet",
        },
      ])
        assert.equal(
          (
            await request("/orders", {
              method: "POST",
              cookie: customer,
              key: randomUUID(),
              body: payload,
            })
          ).status,
          400,
        );
    },
  );
  await t.test(
    "concurrent duplicate order request charges once and delivers one encrypted key",
    async () => {
      const key = randomUUID(),
        body = {
          items: [{ variant_id: variant.id, quantity: 1 }],
          method: "wallet",
          coupon: "WELCOME10",
          customer_note: "",
        };
      const responses = await Promise.all([
        request("/orders", { method: "POST", cookie: customer, key, body }),
        request("/orders", { method: "POST", cookie: customer, key, body }),
      ]);
      assert.ok(responses.every((r) => r.status === 201));
      assert.equal(responses[0].body.id, responses[1].body.id);
      order = responses[0].body;
      assert.equal(order.total, 89100);
      assert.equal(order.status, "completed");
      assert.equal(order.items[0].keys.length, 1);
      const stored = store.db.inventory.find((i) => i.order_id === order.id);
      assert.ok(!stored.secret.includes("DEMO"));
      assert.equal(
        (await request("/me", { cookie: customer })).body.balance,
        1500000 - 89100,
      );
      assert.equal(
        (
          await request("/orders", {
            method: "POST",
            cookie: customer,
            key,
            body: { ...body, coupon: "" },
          })
        ).status,
        409,
      );
    },
  );
  await t.test(
    "other account cannot read order or spend another wallet",
    async () => {
      const register = await request("/auth/register", {
        method: "POST",
        body: {
          email: "other@example.com",
          name: "Other User",
          password: "OtherPassword123!",
        },
      });
      const other = register.cookie;
      assert.equal(
        (await request("/orders", { cookie: other })).body.length,
        0,
      );
      assert.equal(
        (
          await request(`/orders/${order.id}/cancel`, {
            method: "POST",
            cookie: other,
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await request("/orders", {
            method: "POST",
            cookie: other,
            key: randomUUID(),
            body: {
              items: [{ variant_id: variant.id, quantity: 1 }],
              method: "wallet",
            },
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request("/me", {
            method: "PATCH",
            cookie: other,
            body: { name: "Other", role: "admin" },
          })
        ).status,
        400,
      );
    },
  );
  await t.test("wallet topup replay credits only once", async () => {
    const p = (
      await request("/wallet/topup", {
        method: "POST",
        cookie: customer,
        body: { amount: 200000 },
      })
    ).body;
    for (let i = 0; i < 2; i++)
      assert.equal(
        (
          await request(`/demo/pay/${p.id}`, {
            method: "POST",
            cookie: customer,
          })
        ).status,
        200,
      );
    assert.equal(
      (await request("/me", { cookie: customer })).body.balance,
      1500000 - 89100 + 200000,
    );
  });
  await t.test(
    "service requires target details, delivers only after admin action",
    async () => {
      const v = products.find((p) => p.slug === "private-proxy").variants[0];
      assert.equal(
        (
          await request("/orders", {
            method: "POST",
            cookie: customer,
            key: randomUUID(),
            body: {
              items: [{ variant_id: v.id, quantity: 1 }],
              method: "wallet",
            },
          })
        ).status,
        400,
      );
      const result = await request("/orders", {
        method: "POST",
        cookie: customer,
        key: randomUUID(),
        body: {
          items: [{ variant_id: v.id, quantity: 1 }],
          method: "wallet",
          customer_note: "SG proxy",
        },
      });
      assert.equal(result.body.status, "processing");
      assert.equal(result.body.items[0].keys.length, 0);
      assert.equal(
        (
          await request(`/admin/orders/${result.body.id}/fulfill`, {
            method: "POST",
            cookie: customer,
            body: { secrets: ["host:123:user:pw"] },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request(`/admin/orders/${result.body.id}/fulfill`, {
            method: "POST",
            cookie: admin,
            body: { secrets: ["host:123:user:pw"] },
          })
        ).status,
        200,
      );
      assert.equal(
        (await request("/orders", { cookie: customer })).body.find(
          (o) => o.id === result.body.id,
        ).items[0].keys[0],
        "host:123:user:pw",
      );
      assert.equal(
        (
          await request(`/admin/orders/${result.body.id}/fulfill`, {
            method: "POST",
            cookie: admin,
            body: { secrets: ["host:123:user:pw"] },
          })
        ).status,
        409,
      );
    },
  );
  await t.test(
    "refund is exactly once; delivered keys do not return to sale inventory",
    async () => {
      const warranty = store.createWarranty(order.user_id, order.id, {
        key_ids: store.orders(order.user_id, false, order.id)[0].items[0]
          .key_ids,
        message: "Please verify and refund this defective code.",
      });
      const refundBody = {
        ticket_id: warranty.id,
        method: "wallet",
        reason: "Defective product confirmed during warranty review",
      };
      const before = (await request("/me", { cookie: customer })).body.balance;
      const stock = store.db.products
        .flatMap((p) => p.variants)
        .find((v) => v.id === variant.id).stock;
      assert.equal(
        (
          await request(`/admin/orders/${order.id}/refund`, {
            method: "POST",
            cookie: admin,
            body: refundBody,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await request(`/admin/orders/${order.id}/refund`, {
            method: "POST",
            cookie: admin,
            body: refundBody,
          })
        ).status,
        409,
      );
      assert.equal(
        (await request("/me", { cookie: customer })).body.balance,
        before + order.total,
      );
      assert.equal(
        store.db.products
          .flatMap((p) => p.variants)
          .find((v) => v.id === variant.id).stock,
        stock,
      );
    },
  );
  await t.test(
    "expired transfer order releases stock and late payment cannot complete it",
    async () => {
      const result = await request("/orders", {
        method: "POST",
        cookie: customer,
        key: randomUUID(),
        body: {
          items: [{ variant_id: variant.id, quantity: 1 }],
          method: "sepay",
        },
      });
      assert.equal(result.body.status, "pending");
      assert.equal(result.body.items[0].keys.length, 0);
      const p = store.db.payments.find((p) => p.order_id === result.body.id);
      p.expires_at = new Date(Date.now() - 1000).toISOString();
      store.expire();
      const settled = await request(`/demo/pay/${p.id}`, {
        method: "POST",
        cookie: customer,
      });
      assert.equal(settled.body.review, true);
      assert.equal(
        (await request("/orders", { cookie: customer })).body.find(
          (o) => o.id === result.body.id,
        ).status,
        "expired",
      );
    },
  );
  await t.test(
    "SePay authenticates webhook, checks receiving account and deduplicates transaction id",
    async () => {
      const { config } = await import("../server/config.js");
      const original = {
        mode: config.mode,
        webhook: config.webhook,
        account: config.account,
      };
      const uid = login.body.id,
        p = store.createTopup(uid, 75000),
        before = store.profile(uid).balance;
      Object.assign(config, {
        mode: "supabase",
        webhook: "webhook-secret-for-tests",
        account: "123456789",
      });
      const body = {
        id: 7654321,
        accountNumber: "123456789",
        transferType: "in",
        transferAmount: 75000,
        content: p.code,
      };
      try {
        assert.equal(
          (await request("/webhooks/sepay", { method: "POST", body })).status,
          401,
        );
        assert.equal(
          (
            await request("/webhooks/sepay", {
              method: "POST",
              body: { ...body, accountNumber: "wrong" },
              authorization: "Apikey webhook-secret-for-tests",
            })
          ).status,
          422,
        );
        assert.equal(
          (
            await request("/webhooks/sepay", {
              method: "POST",
              body: { ...body, transferType: "out" },
              authorization: "Apikey webhook-secret-for-tests",
            })
          ).body.ignored,
          true,
        );
        const valid = await request("/webhooks/sepay", {
          method: "POST",
          body,
          authorization: "Apikey webhook-secret-for-tests",
        });
        assert.equal(valid.status, 200);
        assert.equal(valid.body.success, true);
        assert.equal(valid.body.paid, true);
        assert.equal(
          (
            await request("/webhooks/sepay", {
              method: "POST",
              body,
              authorization: "Apikey webhook-secret-for-tests",
            })
          ).body.duplicate,
          true,
        );
        assert.equal(store.profile(uid).balance, before + 75000);
        const unmatched = await request("/webhooks/sepay", {
          method: "POST",
          body: { ...body, id: 7654322, content: "No order code" },
          authorization: "Apikey webhook-secret-for-tests",
        });
        assert.equal(unmatched.body.review, true);
      } finally {
        Object.assign(config, original);
      }
    },
  );
  await t.test(
    "only admin may reconcile a verified unmatched transfer, exactly once",
    async () => {
      const uid = login.body.id,
        before = store.profile(uid).balance;
      const body = {
        user_id: uid,
        reason: "Bank statement and customer receipt matched",
      };
      assert.equal(
        (
          await request("/admin/reconcile/7654322", {
            method: "POST",
            cookie: customer,
            body,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/admin/reconcile/7654322", {
            method: "POST",
            cookie: admin,
            body,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await request("/admin/reconcile/7654322", {
            method: "POST",
            cookie: admin,
            body,
          })
        ).status,
        409,
      );
      assert.equal(store.profile(uid).balance, before + 75000);
    },
  );
  await t.test("logout invalidates opaque server session", async () => {
    assert.equal(
      (await request("/auth/logout", { method: "POST", cookie: customer }))
        .status,
      200,
    );
    assert.equal((await request("/me", { cookie: customer })).status, 401);
  });
});
