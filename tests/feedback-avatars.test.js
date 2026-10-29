import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { SupabaseStore } from "../server/supabase-store.js";

test("Supabase feedback uses current author avatars without exposing private profile data", async () => {
  const photo = { id: "author-photo", name: "Buyer", avatar_url: "/api/media/avatar.webp", email: "private@example.test", balance: 100000 };
  const plain = { id: "author-plain", name: "Reader", avatar_url: null };
  const rows = [photo, plain, { id: "deleted-author" }].map((author, index) => ({
    id: `feedback-${index}`, user_id: author.id, name: author.name || "Former user",
    product_id: "product", body: "Question", rating: 5, comment: "Review",
  }));
  const profileRequests = [];
  const store = Object.create(SupabaseStore.prototype);
  store.client = createClient("https://feedback-test.invalid", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, options) => {
        const url = new URL(input);
        const table = url.pathname.split("/").at(-1);
        const single = new Headers(options.headers).get("Accept")?.includes("vnd.pgrst.object");
        let data;
        if (table === "profiles") {
          profileRequests.push(url.searchParams);
          data = single ? photo : [photo, plain];
        } else if (table === "products") data = [{ id: "product" }];
        else if (options.method === "POST") data = { id: "new-feedback", ...JSON.parse(options.body) };
        else data = rows;
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { "Content-Type": "application/json", "Content-Range": "0-2/3" },
        });
      },
    },
  });
  store.orders = async () => [{ status: "completed", items: [{ product_id: "product" }] }];

  const reviews = await store.reviews("product");
  const comments = await store.comments("product");
  assert.equal(comments.total, 3);
  for (const list of [reviews, comments.items]) {
    assert.deepEqual(list.map((row) => row.avatar_url), [photo.avatar_url, null, null]);
    assert.ok(list.every((row) => row.email === undefined && row.balance === undefined));
  }
  assert.equal(profileRequests.length, 2, "one batch of authors per feedback page");
  assert.ok(profileRequests.every((q) => q.get("select") === "id,avatar_url"));
  assert.ok(profileRequests.every((q) => q.get("id").includes("author-photo")));

  photo.avatar_url = "https://lh3.googleusercontent.com/new-avatar";
  assert.equal((await store.reviews("product"))[0].avatar_url, photo.avatar_url);
  for (const created of [
    await store.createComment(photo.id, { product_id: "product", body: "New question" }),
    await store.createReview(photo.id, { product_id: "product", rating: 5, comment: "New review" }),
  ]) {
    assert.equal(created.avatar_url, photo.avatar_url);
    assert.equal(created.user_id, photo.id);
    assert.equal(created.email, undefined);
    assert.equal(created.balance, undefined);
  }
});
