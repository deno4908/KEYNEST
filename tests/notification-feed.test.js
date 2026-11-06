import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { createOperations } from "../server/operations.js";
import { enrichNotice, noticeCategory } from "../server/notification-feed.js";
import { SupabaseStore } from "../server/supabase-store.js";

test("Supabase inbox scopes filtered pages, escapes search patterns, and scopes unread updates", async () => {
  const requests = [];
  const client = createClient("https://inbox-test.invalid", "test-key", {
    auth: { persistSession: false },
    global: {
      fetch: async (url, options) => {
        const query = new URL(url).searchParams;
        requests.push({ query, method: options.method, body: options.body });
        const data =
          options.method === "HEAD"
            ? null
            : options.method === "PATCH"
              ? [{ id: "private-receipt" }]
              : [
                  {
                    id: "admin:payment-review:event:actor",
                    title: "Payment",
                    href: "/admin?tab=payments",
                    created_at: new Date().toISOString(),
                    read_at: null,
                  },
                ];
        return new Response(data ? JSON.stringify(data) : null, {
          headers: {
            "Content-Type": "application/json",
            "Content-Range": "0-0/1",
          },
        });
      },
    },
  });
  const store = Object.create(SupabaseStore.prototype);
  store.client = client;
  const ops = createOperations(store);
  const feed = await ops.notifications("actor", {
    page: 2,
    page_size: 12,
    category: "payments",
    q: "100%_value",
    unread: true,
  });
  assert.equal(feed.items[0].category, "payments");
  assert.equal(feed.total, 1);
  const main = requests.find((r) => r.method !== "HEAD");
  assert.match(main.query.get("or"), /admin:payment-review:/);
  assert.equal(main.query.get("title"), "ilike.%100\\%\\_value%");
  assert.equal(main.query.get("offset"), "12");
  assert.ok(requests.every((r) => r.query.get("user_id") === "eq.actor"));
  requests.length = 0;
  await ops.unreadNotification("actor", "private-receipt");
  assert.equal(requests[0].query.get("id"), "eq.private-receipt");
  assert.equal(requests[0].query.get("user_id"), "eq.actor");
  assert.deepEqual(JSON.parse(requests[0].body), { read_at: null });
});

test("event metadata classifies all actor events and rejects unsafe destinations", () => {
  for (const [id, category] of [
    ["order:1:completed", "orders"],
    ["seller-refund:done:1:user", "orders"],
    ["seller-chat:1", "orders"],
    ["seller-reply:1", "support"],
    ["admin:ticket-message:1:user", "support"],
    ["admin:withdrawal:1:user", "payments"],
    ["seller-review:1:2", "catalog"],
    ["campaign:1:user", "announcements"],
    ["future-event", "system"],
  ])
    assert.equal(noticeCategory(id), category);
  for (const href of [
    "https://outside.invalid",
    "//outside.invalid",
    "/\\outside.invalid",
    "/\n/outside.invalid",
    "javascript:alert(1)",
  ])
    assert.equal(
      enrichNotice({ id: "future", title: "Notice", href }).href,
      "/notifications",
    );
  assert.equal(
    enrichNotice({
      id: "order:1:processing",
      title: "Đơn KN123: processing",
      href: "/orders/1",
    }).title,
    "Đơn KN123: Đang xử lý",
  );
});

test("administrative collection reads continue beyond the default database row cap", async () => {
  const store = Object.create(SupabaseStore.prototype);
  const all = Array.from({ length: 1203 }, (_, id) => ({ id }));
  const pages = [];
  store.query = async ({ start, end }) => {
    pages.push([start, end]);
    return all.slice(start, end + 1);
  };
  const q = { range: (start, end) => ({ start, end }) };
  assert.deepEqual(await store.completeQuery(q), all);
  assert.deepEqual(pages, [
    [0, 499],
    [500, 999],
    [1000, 1499],
  ]);
});
