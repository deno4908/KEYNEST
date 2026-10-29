import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
process.env.NODE_ENV = "test";
process.env.APP_MODE = "demo";
const dir = mkdtempSync(join(tmpdir(), "keynest-feedback-"));
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
test("product feedback: verified ratings, discussion isolation, author permissions and pagination", async (t) => {
  t.after(() => {
    server.close();
    assert.ok(
      resolve(dir).startsWith(resolve(tmpdir()) + sep + "keynest-feedback-"),
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
  const other = await req("/auth/register", {
    email: "feedback@example.test",
    password: "Feedback123!",
    name: "Other",
  });
  const products = (await req("/products")).body;
  const p = products.find((p) => p.slug === "hollow-knight");
  const second = products.find((x) => x.id !== p.id);
  const review = {
    product_id: p.id,
    rating: 4,
    comment: "Received and activated successfully.",
  };
  assert.equal((await req("/reviews", review)).status, 401);
  assert.equal((await req("/reviews", review, other.cookie)).status, 403);
  assert.equal(
    (await req("/reviews", { ...review, rating: 6 }, buyer.cookie)).status,
    400,
  );
  const order = await req(
    "/orders",
    {
      items: [{ variant_id: p.variants[0].id, quantity: 1 }],
      method: "wallet",
      coupon: "",
      customer_note: "",
    },
    buyer.cookie,
  );
  assert.equal(order.status, 201);
  const buyerProfile = store.db.users.find((u) => u.email === "student@keynest.local");
  buyerProfile.avatar_url = "/api/media/buyer.webp";
  const reviewed = await req("/reviews", review, buyer.cookie);
  assert.equal(reviewed.status, 201);
  assert.equal(reviewed.body.avatar_url, buyerProfile.avatar_url);
  buyerProfile.avatar_url = "https://lh3.googleusercontent.com/updated-avatar";
  const publicReview = (await req(`/products/${p.id}/reviews`)).body[0];
  assert.equal(publicReview.avatar_url, buyerProfile.avatar_url);
  assert.equal(publicReview.email, undefined);
  assert.equal(publicReview.balance, undefined);
  assert.equal((await req("/reviews", review, buyer.cookie)).status, 400);
  const stats = (await req("/products")).body.find((x) => x.id === p.id);
  assert.equal(stats.review_count, 1);
  assert.equal(stats.rating_average, 4);
  assert.deepEqual(stats.rating_counts, [0, 0, 0, 1, 0]);
  assert.equal((await req(`/products/${second.id}/reviews`)).body.length, 0);
  const comment = {
    product_id: p.id,
    body: "<img src=x onerror=alert(1)> Is this region supported?",
  };
  assert.equal((await req("/comments", comment)).status, 401);
  assert.equal(
    (await req("/comments", comment, other.cookie, "https://evil.test")).status,
    403,
  );
  assert.equal(
    (
      await req(
        "/comments",
        { ...comment, user_id: buyer.body.id },
        other.cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (await req("/comments", { ...comment, body: "  " }, other.cookie)).status,
    400,
  );
  assert.equal(
    (
      await req(
        "/comments",
        { ...comment, product_id: randomUUID() },
        other.cookie,
      )
    ).status,
    404,
  );
  const otherProfile = store.db.users.find((u) => u.id === other.body.user.id);
  otherProfile.avatar_url = "/api/media/commenter.webp";
  const posted = await req("/comments", comment, other.cookie);
  assert.equal(posted.status, 201);
  assert.equal(posted.body.user_id, other.body.user.id);
  assert.equal(posted.body.name, "Other");
  assert.equal(posted.body.avatar_url, otherProfile.avatar_url);
  otherProfile.avatar_url = "/api/media/updated-commenter.webp";
  const publicComment = (await req(`/products/${p.id}/comments`)).body.items[0];
  assert.equal(publicComment.avatar_url, otherProfile.avatar_url);
  assert.equal(publicComment.email, undefined);
  assert.equal(publicComment.password_hash, undefined);
  otherProfile.avatar_url = null;
  assert.equal((await req(`/products/${p.id}/comments`)).body.items[0].avatar_url, null);
  assert.equal(
    (await req(`/products/${p.id}/comments`)).body.items[0].body,
    comment.body,
  );
  assert.equal((await req(`/products/${second.id}/comments`)).body.total, 0);
  assert.equal(
    (await req(`/comments/${posted.body.id}/delete`, {}, buyer.cookie)).status,
    404,
  );
  assert.equal(
    (await req(`/comments/${posted.body.id}/delete`, {}, other.cookie)).status,
    200,
  );
  const moderated = await req("/comments", comment, other.cookie);
  assert.equal(
    (await req(`/comments/${moderated.body.id}/delete`, {}, admin.cookie))
      .status,
    200,
  );
  for (let i = 0; i < 23; i++)
    store.createComment(other.body.user.id, {
      product_id: p.id,
      body: `Comment ${i}`,
    });
  const first = (await req(`/products/${p.id}/comments`)).body;
  const next = (await req(`/products/${p.id}/comments?page=2`)).body;
  assert.equal(first.total, 23);
  assert.equal(first.items.length, 20);
  assert.equal(next.items.length, 3);
  assert.equal(
    new Set([...first.items, ...next.items].map((c) => c.id)).size,
    23,
  );
  assert.equal((await req(`/products/${p.id}/comments?page=-1`)).status, 400);
  assert.equal((await req(`/products/${p.id}/reviews?page=1.5`)).status, 400);
  assert.equal(
    (await req("/products")).body.find((x) => x.id === p.id).review_count,
    1,
  );
});
