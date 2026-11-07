import { test, expect } from "@playwright/test";

test("home budget products and catalog link follow the selected category", async ({ page }) => {
  const products = [
    ...Array.from({ length: 7 }, (_, i) => ({ category: "game", price: 100000 + i, slug: `game-${i}` })),
    { category: "mmo", price: 50000, slug: "proxy-budget" },
    { category: "gift", price: 250000, slug: "gift-expensive" },
    { category: "topup", price: 200000, slug: "topup-budget" },
  ].map((p) => ({
    id: p.slug, slug: p.slug, name: p.slug, category: p.category,
    platform: "KEYNEST", subcategory: "", subtitle: "", description: "",
    image: "", featured: true, active: true, review_count: 0,
    rating_average: 0, rating_counts: [],
    variants: [{ id: p.slug, name: "Standard", price: p.price, original_price: p.price,
      stock: 10, region: "VN", delivery: "manual", warranty_days: 0 }],
  }));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me" || path === "/api/auth/refresh")
      return route.fulfill({ status: 401, json: { code: "AUTH_REQUIRED" } });
    const body = path === "/api/region" ? { allowed: true }
      : path === "/api/config" ? { mode: "supabase", captcha: { enabled: false } }
      : path === "/api/products" ? products
      : path === "/api/categories" ? [
        { id: "game", name: "Game key" }, { id: "gift", name: "Gift card" },
        { id: "topup", name: "Nạp game" }, { id: "mmo", name: "MMO & Proxy" },
      ] : [];
    await route.fulfill({ json: body });
  });
  await page.goto("/");
  const budget = page.locator(".budget-section");
  const cards = budget.locator(".card-name");
  await expect(cards).toHaveCount(6);
  await expect(budget.getByRole("link", { name: "Xem tất cả" })).toHaveAttribute("href", "/catalog?max=200000");
  for (const [label, slugs, category] of [
    ["MMO & Proxy", ["proxy-budget"], "mmo"],
    ["Nạp game", ["topup-budget"], "topup"],
    ["Gift card", [], "gift"],
    ["Game key", products.slice(0, 6).map(p => p.slug), "game"],
  ] as const) {
    await page.locator(".category-tabs").getByRole("button", { name: new RegExp(label) }).click();
    await expect(cards).toHaveText([...slugs]);
    await expect(budget.getByRole("link", { name: "Xem tất cả" })).toHaveAttribute("href", `/catalog?category=${category}&max=200000`);
    if (!slugs.length) await expect(budget).toContainText("Danh mục này chưa có sản phẩm dưới 200.000đ.");
  }
  await page.locator(".category-tabs").getByRole("button", { name: /Tất cả/ }).click();
  await expect(cards).toHaveCount(6);
  await expect(budget.getByRole("link", { name: "Xem tất cả" })).toHaveAttribute("href", "/catalog?max=200000");
});
