import { test, expect } from "@playwright/test";
test("buyer reviews and product comments are persisted, isolated and rendered as text", async ({
  page,
  request,
}) => {
  expect((await (await request.get("/api/health")).json()).mode).toBe("demo");
  const headers = {
    Origin: "http://127.0.0.1:5173",
    "X-App-Request": "keynest",
  };
  await page.goto("/");
  const registration = await page.request.post("/api/auth/register", {
    headers,
    data: {
      email: `feedback-ui-${Date.now()}@example.test`,
      password: "FeedbackPassword123!",
      name: "Feedback Buyer",
    },
  });
  expect(registration.ok()).toBeTruthy();
  const products = await (await page.request.get("/api/products")).json();
  const product = products.find(
    (p: { slug: string }) => p.slug === "hollow-knight",
  );
  const topup = await (
    await page.request.post("/api/wallet/topup", {
      headers,
      data: { amount: 200000 },
    })
  ).json();
  expect(
    (await page.request.post(`/api/demo/pay/${topup.id}`, { headers })).ok(),
  ).toBeTruthy();
  expect(
    (
      await page.request.post("/api/orders", {
        headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
        data: {
          items: [{ variant_id: product.variants[0].id, quantity: 1 }],
          method: "wallet",
          coupon: "",
          customer_note: "",
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/products/hollow-knight");
  await page.getByRole("button", { name: "Xem đánh giá sản phẩm" }).click();
  await page.getByRole("radio", { name: "4 sao", exact: true }).check();
  const reviewText = `Nhận key nhanh ${Date.now()}`;
  await page.getByLabel("Trải nghiệm của bạn").fill(reviewText);
  await page.getByRole("button", { name: "Gửi đánh giá", exact: true }).click();
  await expect(
    page.locator(".feedback-entry").filter({ hasText: reviewText }),
  ).toContainText("4/5");
  await expect(
    page.getByRole("button", { name: "Xem đánh giá sản phẩm" }),
  ).toContainText(`${product.review_count + 1} đánh giá`);
  await expect(page.locator(".feedback-thanks")).toBeVisible();
  await page.getByRole("button", { name: "Bình luận", exact: true }).click();
  const comment = `<img src=x onerror=alert(1)> Hỏi về khu vực ${Date.now()}`;
  await page.getByLabel("Nội dung bình luận").fill(comment);
  await page
    .getByRole("button", { name: "Gửi bình luận", exact: true })
    .click();
  await expect(
    page.locator(".feedback-body").filter({ hasText: comment }),
  ).toBeVisible();
  expect(await page.locator(".feedback-body img").count()).toBe(0);
  await page.reload();
  await page.getByRole("button", { name: "Bình luận", exact: true }).click();
  await expect(
    page.locator(".feedback-body").filter({ hasText: comment }),
  ).toBeVisible();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
  }
  await page
    .locator(".feedback-entry")
    .filter({ hasText: comment })
    .getByRole("button", { name: "Xóa bình luận của Feedback Buyer" })
    .click();
  await expect(
    page.locator(".feedback-body").filter({ hasText: comment }),
  ).toHaveCount(0);
  await page.goto("/products/steam-wallet");
  await page.getByRole("button", { name: "Bình luận", exact: true }).click();
  await expect(
    page.locator(".feedback-body").filter({ hasText: comment }),
  ).toHaveCount(0);
});
