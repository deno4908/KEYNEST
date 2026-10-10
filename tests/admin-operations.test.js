import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
process.env.NODE_ENV = "test";
process.env.APP_MODE = "demo";
const dir = mkdtempSync(join(tmpdir(), "keynest-admin-"));
process.env.DEMO_DATA_PATH = join(dir, "store.json");
const { app, store } = await import("../server/index.js");
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/api`;
async function req(path, body, cookie = "", extra = {}) {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:5173",
      "X-App-Request": "keynest",
      Cookie: cookie,
      "Idempotency-Key": randomUUID(),
      ...extra,
    },
    ...(body
      ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }
      : {}),
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
test("admin operations: uploads, scoped coupons, support history and warranty refunds", async (t) => {
  t.after(() => {
    server.close();
    assert.ok(
      resolve(dir).startsWith(resolve(tmpdir()) + sep + "keynest-admin-"),
    );
    rmSync(dir, { recursive: true, force: true });
  });
  const customer = (
    await req("/auth/login", {
      email: "student@keynest.local",
      password: "Student123!",
    })
  ).cookie;
  const admin = (
    await req("/auth/login", {
      email: "admin@keynest.local",
      password: "Admin123!",
    })
  ).cookie;
  const outsider = (
    await req("/auth/register", {
      email: "admin-ops@example.test",
      password: "Customer123!",
      name: "Other customer",
    })
  ).cookie;
  const uid = store.db.users.find(
    (u) => u.email === "student@keynest.local",
  ).id;
  const product = store.db.products.find((p) => p.slug === "hollow-knight");
  await t.test('admin creates dynamic categories and assigns products; customers cannot edit them', async () => {
    const input = { id: 'phan-mem', name: 'Phần mềm', sort_order: 5 };
    assert.equal((await req('/admin/categories', input, customer)).status, 403);
    assert.equal((await req('/admin/categories', { ...input, id: 'all' }, admin)).status, 400);
    assert.equal((await req('/admin/categories', input, admin)).status, 201);
    assert.equal((await req('/admin/categories', input, admin)).status, 409);
    assert.ok((await req('/categories')).body.some((c) => c.id === input.id));
    const data = { slug: 'new-software', name: 'New Software', category: input.id, platform: 'PC', image: '', featured: false, active: true };
    assert.equal((await req('/admin/products', { ...data, category: 'missing-category' }, admin)).status, 400);
    const created = await req('/admin/products', data, admin);
    assert.equal(created.status, 200);
    const variant = await req(`/admin/products/${created.body.id}/variants`, { name: 'Standard', price: 100000, original_price: 100000, delivery: 'manual', stock: 10, region: 'Global', warranty_days: 30 }, admin);
    assert.equal(variant.status, 200);
    const search = await req('/catalog?category=phan-mem');
    assert.equal(search.status, 200);
    assert.equal(search.body.items[0].id, created.body.id);
    assert.equal(search.body.facets.categories['phan-mem'], 1);
  });
  await t.test(
    "coupon pin is admin-only and promotes valid offers without changing prices",
    async () => {
      const c = store.db.coupons[0];
      const original = c.percent;
      const path = `/admin/coupons/${c.code}/pin`;
      assert.equal((await req(path, { pinned: true }, customer)).status, 403);
      assert.equal((await req(path, { pinned: true }, admin)).status, 200);
      assert.equal((await req("/promotions")).body[0].code, c.code);
      assert.equal(c.percent, original);
      assert.equal((await req(path, { pinned: false }, admin)).status, 200);
      assert.equal(c.pinned, false);
    },
  );
  const lines = [{ variant_id: product.variants[0].id, quantity: 1 }];
  const coupon = {
    code: "ONCE",
    percent: 10,
    max_discount: 100000,
    active: true,
    expires_at: null,
    discount_type: "fixed",
    fixed_amount: 20000,
    min_subtotal: 50000,
    total_limit: 1,
    per_user_limit: 1,
    starts_at: null,
    product_ids: [product.id],
    category: "game",
    first_order_only: false,
  };
  await t.test(
    "customers upload binary avatars with ownership, validation and persistent profile",
    async () => {
      const png = await sharp({
        create: { width: 800, height: 600, channels: 3, background: "#5684aa" },
      })
        .png()
        .toBuffer();
      const headers = { "Content-Type": "image/png" };
      assert.equal((await req("/me/avatar", png, "", headers)).status, 401);
      assert.equal(
        (
          await req("/me/avatar", png, customer, {
            ...headers,
            Origin: "https://wrong.test",
          })
        ).status,
        403,
      );
      assert.equal(
        (await req("/me/avatar", Buffer.from("fake-image"), customer, headers))
          .status,
        400,
      );
      assert.equal(
        (
          await req(
            "/me/avatar",
            { avatar_url: "data:image/png;base64,abc" },
            customer,
          )
        ).status,
        415,
      );
      assert.equal(
        (
          await req(
            "/me/avatar",
            Buffer.alloc(4 * 1024 * 1024 + 1),
            customer,
            headers,
          )
        ).status,
        413,
      );
      const uploaded = await req(
        `/me/avatar?user_id=${store.db.users.find((u) => u.role === "admin").id}`,
        png,
        customer,
        headers,
      );
      assert.equal(uploaded.status, 201);
      assert.equal(uploaded.body.id, uid);
      assert.equal(uploaded.body.avatar_source, "upload");
      assert.match(
        uploaded.body.avatar_url,
        /^\/api\/media\/[a-f0-9-]+\.webp$/,
      );
      assert.equal(uploaded.body.password_hash, undefined);
      assert.equal(
        store.db.users.find((u) => u.role === "admin").avatar_url,
        undefined,
      );
      const fetched = await fetch(
        base.replace(/\/api$/, "") + uploaded.body.avatar_url,
      );
      const meta = await sharp(
        Buffer.from(await fetched.arrayBuffer()),
      ).metadata();
      assert.equal(meta.format, "webp");
      assert.equal(meta.width, 512);
      assert.equal(meta.height, 512);
      assert.equal(
        (await req("/me", undefined, customer)).body.avatar_url,
        uploaded.body.avatar_url,
      );
    },
  );
  await t.test(
    "upload is admin-only, decodes image contents and serves only generated WebP paths",
    async () => {
      const png = await sharp({
        create: { width: 36, height: 24, channels: 3, background: "#28405d" },
      })
        .png()
        .toBuffer();
      const headers = { "Content-Type": "image/png" };
      assert.equal((await req("/admin/media", png, "", headers)).status, 401);
      assert.equal(
        (await req("/admin/media", png, customer, headers)).status,
        403,
      );
      assert.equal(
        (
          await req("/admin/media", png, admin, {
            ...headers,
            Origin: "https://foreign.invalid",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await req(
            "/admin/media",
            Buffer.from('<svg onload="alert(1)"></svg>'),
            admin,
            headers,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await req(
            "/admin/media",
            Buffer.alloc(8 * 1024 * 1024 + 1),
            admin,
            headers,
          )
        ).status,
        413,
      );
      const uploaded = await req("/admin/media", png, admin, headers);
      assert.equal(uploaded.status, 201);
      assert.match(uploaded.body.url, /^\/api\/media\/[a-f0-9-]+\.webp$/);
      const image = await fetch(base.replace(/\/api$/, "") + uploaded.body.url);
      assert.equal(image.status, 200);
      assert.equal(image.headers.get("content-type"), "image/webp");
      assert.equal(image.headers.get("x-content-type-options"), "nosniff");
      assert.equal(
        (await sharp(Buffer.from(await image.arrayBuffer())).metadata()).width,
        36,
      );
      const saved = await req(
        "/admin/products",
        {
          id: product.id,
          slug: product.slug,
          name: product.name,
          category: product.category,
          platform: product.platform,
          subcategory: product.subcategory || "",
          subtitle: product.subtitle,
          description: product.description,
          image: uploaded.body.url,
          featured: product.featured,
          active: true,
        },
        admin,
      );
      assert.equal(saved.status, 200);
      assert.equal(saved.body.image, uploaded.body.url);
      assert.equal((await req("/media/not-a-file.webp")).status, 404);
    },
  );
  await t.test(
    "coupon authorization, validation, authoritative preview and one-use reservation",
    async () => {
      assert.equal((await req("/admin/coupons", coupon, customer)).status, 403);
      assert.equal(
        (await req("/admin/coupons", { ...coupon, total_limit: -1 }, admin))
          .status,
        400,
      );
      assert.equal(
        (
          await req(
            "/admin/coupons",
            {
              ...coupon,
              starts_at: "2030-01-01T00:00:00Z",
              expires_at: "2020-01-01T00:00:00Z",
            },
            admin,
          )
        ).status,
        400,
      );
      assert.equal((await req("/admin/coupons", coupon, admin)).status, 200);
      const quote = await req(
        "/coupons/preview",
        { code: coupon.code, items: lines },
        customer,
      );
      assert.equal(quote.status, 200);
      assert.equal(quote.body.discount, 20000);
      assert.equal(quote.body.total, product.variants[0].price - 20000);
      const headers = { "Idempotency-Key": randomUUID() };
      const orderBody = { items: lines, coupon: coupon.code, method: "sepay" };
      const [a, b] = await Promise.all([
        req("/orders", orderBody, customer, headers),
        req("/orders", orderBody, customer, headers),
      ]);
      assert.equal(a.status, 201);
      assert.equal(b.body.id, a.body.id);
      assert.equal((await req("/orders", orderBody, outsider)).status, 400);
      let saved = (await req("/admin/overview", null, admin)).body.coupons.find(
        (c) => c.code === coupon.code,
      );
      assert.equal(saved.reserved_count, 1);
      assert.equal(saved.used_count, 0);
      assert.equal(
        (await req(`/orders/${a.body.id}/cancel`, {}, customer)).status,
        200,
      );
      const second = await req("/orders", orderBody, customer);
      assert.equal(second.status, 201);
      assert.equal(
        (await req(`/demo/pay/${second.body.payment.id}`, {}, customer)).status,
        200,
      );
      saved = (await req("/admin/overview", null, admin)).body.coupons.find(
        (c) => c.code === coupon.code,
      );
      assert.equal(saved.used_count, 1);
      assert.equal(saved.reserved_count, 0);
      assert.equal(
        (
          await req(
            "/coupons/preview",
            { code: coupon.code, items: lines },
            customer,
          )
        ).status,
        400,
      );
      assert.ok(
        !(await req("/promotions")).body.some((c) => c.code === coupon.code),
      );
    },
  );
  await t.test(
    "coupon scopes, first order, user quota, expiry and fixed discount floor",
    async () => {
      const save = async (extra) => {
        assert.equal(
          (
            await req(
              "/admin/coupons",
              {
                ...coupon,
                code: "RULES",
                total_limit: null,
                per_user_limit: null,
                ...extra,
              },
              admin,
            )
          ).status,
          200,
        );
      };
      const preview = () =>
        req("/coupons/preview", { code: "RULES", items: lines }, customer);
      await save({ category: "mmo" });
      assert.equal((await preview()).status, 400);
      await save({ min_subtotal: 100000000 });
      assert.equal((await preview()).status, 400);
      await save({ first_order_only: true });
      assert.equal((await preview()).status, 400);
      await save({ starts_at: "2099-01-01T00:00:00Z" });
      assert.equal((await preview()).status, 400);
      await save({ expires_at: "2000-01-01T00:00:00Z" });
      assert.equal((await preview()).status, 400);
      await save({
        product_ids: [store.db.products.find((p) => p.id !== product.id).id],
      });
      assert.equal((await preview()).status, 400);
      await save({ fixed_amount: 100000000 });
      assert.equal((await preview()).body.total, 1000);
      await save({ discount_type: "percent", fixed_amount: 0, percent: 10 });
      assert.equal(
        (await preview()).body.discount,
        Math.floor(product.variants[0].price / 10),
      );
      await save({ per_user_limit: 1 });
      const purchased = await req(
        "/orders",
        { items: lines, coupon: "RULES", method: "wallet" },
        customer,
      );
      assert.equal(purchased.status, 201);
      assert.equal((await preview()).status, 400);
      assert.equal(
        (
          await req(
            "/coupons/preview",
            { code: "RULES", items: lines },
            outsider,
          )
        ).status,
        200,
      );
    },
  );
  await t.test(
    "support preserves each reply, customer messages reopen, another customer cannot read or reply",
    async () => {
      const ticket = (
        await req(
          "/tickets",
          {
            subject: "Need activation assistance",
            message: "Activation reports an error when entering the code.",
          },
          customer,
        )
      ).body;
      assert.equal(
        (
          await req(
            `/admin/tickets/${ticket.id}/reply`,
            {
              reply: "Please send the error message.",
              status: "in_progress",
              priority: "high",
            },
            admin,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await req(
            `/tickets/${ticket.id}/messages`,
            { body: "Foreign message" },
            outsider,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await req(
            `/tickets/${ticket.id}/messages`,
            { body: "The message is: already activated." },
            customer,
          )
        ).status,
        201,
      );
      assert.equal(
        (
          await req(
            `/admin/tickets/${ticket.id}/reply`,
            {
              reply: "Checked and sent activation instructions.",
              status: "closed",
              priority: "normal",
            },
            admin,
          )
        ).status,
        200,
      );
      const result = (await req("/tickets", null, customer)).body.find(
        (t) => t.id === ticket.id,
      );
      assert.equal(result.messages.length, 3);
      assert.deepEqual(
        result.messages.map((m) => m.role),
        ["admin", "customer", "admin"],
      );
      assert.equal(result.status, "closed");
      assert.ok(
        !(await req("/tickets", null, outsider)).body.some(
          (t) => t.id === ticket.id,
        ),
      );
    },
  );
  await t.test(
    "refund requires warranty, distinguishes external from wallet and is single-use",
    async () => {
      for (const method of ["wallet", "external"]) {
        const order = (
          await req("/orders", { items: lines, method: "wallet" }, customer)
        ).body;
        const invalidRefund = {
          ticket_id: randomUUID(),
          method,
          reason: "Defective product confirmed by support",
          reference: method === "external" ? "BANK-REF-2026" : "",
        };
        assert.equal(
          (await req(`/admin/orders/${order.id}/refund`, invalidRefund, admin))
            .status,
          400,
        );
        const claim = (
          await req(
            `/orders/${order.id}/warranty`,
            {
              key_ids: order.items[0].key_ids,
              message: "Please check this defective activation code.",
            },
            customer,
          )
        ).body;
        const refund = { ...invalidRefund, ticket_id: claim.id };
        const before = store.profile(uid).balance;
        const url = `/admin/orders/${order.id}/refund`;
        assert.equal((await req(url, refund, customer)).status, 403);
        if (method === "external")
          assert.equal(
            (await req(url, { ...refund, reference: "" }, admin)).status,
            400,
          );
        const responses = await Promise.all([
          req(url, refund, admin),
          req(url, refund, admin),
        ]);
        assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
        assert.equal(
          store.profile(uid).balance,
          before + (method === "wallet" ? order.total : 0),
        );
        const detail = (await req(`/orders/${order.id}`, null, customer)).body;
        assert.equal(detail.status, "refunded");
        assert.equal(detail.refund_method, method);
        assert.equal(detail.warranty_requests[0].status, "closed");
        assert.equal(detail.warranty_requests[0].messages.length, 1);
        assert.deepEqual(detail.items[0].keys, []);
      }
    },
  );
});
