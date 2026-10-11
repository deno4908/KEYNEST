import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
process.env.NODE_ENV = "test";
process.env.APP_MODE = "demo";
const dir = mkdtempSync(join(tmpdir(), "keynest-operations-"));
process.env.DEMO_DATA_PATH = join(dir, "demo.json");
const { app, store } = await import("../server/index.js");

test("operations: scoped administration, revocation, inbox and stock", async (t) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  async function req(path, cookie = "", body, csrf = true) {
    const r = await fetch(
      `http://127.0.0.1:${server.address().port}/api${path}`,
      {
        method: body ? "POST" : "GET",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
          ...(csrf
            ? { Origin: "http://127.0.0.1:5173", "X-App-Request": "keynest" }
            : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    };
  }
  const login = (email = "student@keynest.local", password = "Student123!") =>
    req("/auth/login", "", { email, password });
  const admin = (await login("admin@keynest.local", "Admin123!")).cookie;
  let buyer = (await login()).cookie;
  const uid = (await req("/me", buyer)).data.id;
  await t.test('email registration appears in customer list and role filters apply before pagination', async () => {
    const registration = await req('/auth/register', '', { email: 'listed@example.test', password: 'Registered123!', name: 'Listed Customer' });
    assert.equal(registration.status, 200);
    const listed = await req('/admin/customers?q=listed%40example.test&role=customer', admin);
    assert.equal(listed.data.total, 1);
    assert.equal(listed.data.items[0].email, 'listed@example.test');
    assert.equal((await req('/admin/customers?q=listed%40example.test&role=seller', admin)).data.total, 0);
    assert.equal((await req('/admin/customers?role=admin', admin)).status, 400);
  });
  await t.test("homepage announcements are public only while published and admin-owned", async () => {
    const a = { id: randomUUID(), title: "Lịch bảo trì", body: "Thông tin công khai", active: true };
    assert.equal((await req("/admin/announcements", buyer, a)).status, 403);
    assert.equal((await req("/admin/announcements", admin, a)).status, 200);
    assert.equal((await req("/announcements")).data.some(x => x.id === a.id), true);
    assert.equal((await req("/admin/announcements", admin, { ...a, active: false })).status, 200);
    assert.equal((await req("/announcements")).data.some(x => x.id === a.id), false);
    assert.equal((await req("/admin/announcements", admin)).data.some(x => x.id === a.id), true);
  });
  await t.test(
    "admin notifications enforce permissions and persist one copy on retry",
    async () => {
      const input = {
        id: randomUUID(),
        title: "Thông báo bảo trì",
        body: "Cửa hàng cập nhật hệ thống.",
        email: "student@keynest.local",
      };
      assert.equal(
        (await req("/admin/notifications", buyer, input)).status,
        403,
      );
      assert.equal(
        (await req("/admin/notifications", admin, input, false)).status,
        403,
      );
      const sent = await req("/admin/notifications", admin, input);
      assert.equal(sent.status, 200);
      assert.equal(sent.data.recipients, 1);
      assert.equal(
        (await req("/admin/notifications", admin, input)).status,
        200,
      );
      const inbox = await req("/notifications", buyer);
      assert.equal((await req('/notifications?read=1', buyer)).data.items.length, 0);
      const matches = inbox.data.items.filter((n) => n.title === input.title);
      assert.equal(matches.length, 1);
      assert.equal(matches[0].body, input.body);
      assert.equal(
        (
          await req("/admin/notifications", admin, {
            ...input,
            body: "Nội dung đã thay đổi",
          })
        ).status,
        409,
      );
      assert.equal((await req("/admin/notifications", admin)).data.length, 1);
    },
  );
  await t.test(
    "lists enforce role, paging and never expose credentials or delivery secrets",
    async () => {
      assert.equal((await req("/admin/customers")).status, 401);
      assert.equal((await req("/admin/customers", buyer)).status, 403);
      const list = await req("/admin/customers?page_size=1&q=student", admin);
      assert.equal(list.status, 200);
      assert.equal(list.data.total, 1);
      assert.equal(list.data.items[0].password_hash, undefined);
      assert.equal(
        (await req("/admin/orders?page_size=101", admin)).status,
        400,
      );
      assert.equal(
        (await req("/admin/tickets?status=bogus", admin)).status,
        400,
      );
    },
  );
  await t.test(
    "session revocation is owner-scoped and survives renewed requests",
    async () => {
      const second = (await login()).cookie;
      const current = (await req("/me/sessions", second)).data.find(
        (s) => s.current,
      );
      assert.ok(current.id);
      assert.equal(current.token_hash, undefined);
      assert.equal(
        (await req("/me/sessions/revoke", admin, { id: current.id })).status,
        404,
      );
      assert.equal(
        (await req("/me/sessions/revoke", buyer, { id: current.id }, false))
          .status,
        403,
      );
      assert.equal(
        (await req("/me/sessions/revoke", buyer, { others: true })).status,
        200,
      );
      assert.equal((await req("/me", second)).status, 401);
      assert.equal((await req("/me", buyer)).status, 200);
    },
  );
  await t.test(
    "notifications cover paid orders/support, read state cannot cross owners",
    async () => {
      const product = store
        .products()
        .find((p) => p.variants.some((v) => v.delivery === "key" && v.stock));
      const variant = product.variants.find(
        (v) => v.delivery === "key" && v.stock,
      );
      store.createOrder(
        uid,
        {
          items: [{ variant_id: variant.id, quantity: 1 }],
          method: "wallet",
          coupon: "",
          customer_note: "",
        },
        randomUUID(),
      );
      const ticket = store.createTicket(uid, {
        subject: "Support notification",
        message: "Please check this order",
        kind: "support",
      });
      const aid = (await req("/me", admin)).data.id;
      store.replyTicket(
        ticket.id,
        "We are checking your order",
        aid,
        "in_progress",
        "high",
      );
      const inbox = await req("/notifications", buyer);
      assert.ok(inbox.data.items.some((n) => n.id.startsWith("order:")));
      assert.ok(inbox.data.items.some((n) => n.id.startsWith("reply:")));
      const id = inbox.data.items[0].id;
      assert.equal(
        (await req("/notifications/read", admin, { id })).status,
        404,
      );
      assert.equal(
        (await req("/notifications/read", buyer, { all: true })).status,
        200,
      );
      assert.equal(
        (await req("/notifications?unread=1", buyer)).data.unread_count,
        0,
      );
      const listing = await req("/admin/orders", admin);
      const history = await req('/notifications?read=1&page_size=1', buyer);
      assert.equal(history.data.items.length, 1);
      assert.ok(history.data.items.every(n => n.read_at));
      assert.equal((await req('/notifications?unread=1', buyer)).data.items.length, 0);
      assert.equal(listing.data.items[0].customer.id, uid);
      assert.equal(listing.data.items[0].items[0].keys, undefined);
      assert.equal(
        (await req("/admin/tickets?priority=high", admin)).data.total,
        1,
      );
    },
  );
  await t.test(
    "discard requires unused inventory and adjusts stock exactly once",
    async () => {
      const key = store.db.inventory.find((i) => !i.order_id);
      const variant = store.db.products
        .flatMap((p) => p.variants)
        .find((v) => v.id === key.variant_id);
      const before = variant.stock;
      const input = { reason: "Invalid supplier key found" };
      assert.equal(
        (await req(`/admin/inventory/${key.id}/discard`, buyer, input)).status,
        403,
      );
      assert.equal(
        (await req(`/admin/inventory/${key.id}/discard`, admin, input)).status,
        200,
      );
      assert.equal(variant.stock, before - 1);
      assert.equal(
        (await req(`/admin/inventory/${key.id}/discard`, admin, input)).status,
        404,
      );
      const assigned = store.db.inventory.find((i) => i.order_id);
      assert.equal(
        (await req(`/admin/inventory/${assigned.id}/discard`, admin, input))
          .status,
        409,
      );
    },
  );
  await t.test(
    "suspension blocks new and existing sessions; only customers may be suspended",
    async () => {
      const body = { suspended: true, reason: "Account access under review" };
      assert.equal(
        (await req(`/admin/customers/${uid}/access`, admin, body)).status,
        200,
      );
      assert.equal((await req("/me", buyer)).status, 401);
      assert.equal((await login()).status, 403);
      const aid = (await req("/me", admin)).data.id;
      assert.equal(
        (await req(`/admin/customers/${aid}/access`, admin, body)).status,
        409,
      );
      assert.equal(
        (
          await req(`/admin/customers/${uid}/access`, admin, {
            ...body,
            suspended: false,
          })
        ).status,
        200,
      );
      assert.equal((await req("/me", (await login()).cookie)).status, 200);
    },
  );
});
