import { z } from "zod";
import { categoryId } from './categories.js';

export const catalogQuery = z
  .object({
    q: z.string().trim().max(120).default(""),
    category: categoryId.default("all"),
    sub: z.string().max(60).default(""),
    platform: z.string().max(80).default(""),
    region: z.string().max(80).default(""),
    min: z.coerce.number().int().min(0).max(100000000).default(0),
    max: z.coerce.number().int().min(0).max(100000000).default(100000000),
    stock: z.enum(["0", "1"]).default("0"),
    sale: z.enum(["0", "1"]).default("0"),
    delivery: z.enum(["", "key", "manual"]).default(""),
    sort: z.enum(["featured", "asc", "desc", "name"]).default("featured"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    page_size: z.coerce.number().int().min(1).max(48).default(12),
  })
  .strict()
  .refine((v) => v.min <= v.max, "Khoảng giá không hợp lệ.");

export const normalizeSearch = (value) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .trim();
const group = (p) => p.subcategory || p.platform || "Khác";

// Demo implements the same contract as the PostgreSQL catalog_search RPC.
export function searchCatalog(products, f) {
  const active = products.filter((p) => p.active);
  const scoped = active.filter(
    (p) => f.category === "all" || p.category === f.category,
  );
  const unique = (values) => [...new Set(values)].sort();
  const facets = {
    groups: unique(scoped.map(group)),
    platforms: unique(scoped.map((p) => p.platform)),
    regions: unique(scoped.flatMap((p) => p.variants.map((v) => v.region))),
    categories: Object.fromEntries(
      [...new Set(["all", "game", "gift", "topup", "mmo", ...active.map((p) => p.category)])].map((c) => [
        c,
        active.filter((p) => c === "all" || p.category === c).length,
      ]),
    ),
  };
  const price = (p) => Math.min(...p.variants.map((v) => v.price));
  const filtered = scoped
    .filter(
      (p) =>
        normalizeSearch(
          `${p.name} ${p.platform} ${p.description} ${group(p)}`,
        ).includes(normalizeSearch(f.q)) &&
        (!f.sub || group(p) === f.sub) &&
        (!f.platform || p.platform === f.platform) &&
        p.variants.some(
          (v) =>
            v.price >= f.min &&
            v.price <= f.max &&
            (f.stock !== "1" || v.stock > 0) &&
            (!f.delivery || v.delivery === f.delivery) &&
            (!f.region || v.region === f.region) &&
            (f.sale !== "1" || v.original_price > v.price),
        ),
    )
    .sort((a, b) => {
      const order =
        f.sort === "asc"
          ? price(a) - price(b)
          : f.sort === "desc"
            ? price(b) - price(a)
            : f.sort === "name"
              ? a.name.localeCompare(b.name)
              : Number(b.featured) - Number(a.featured) ||
                (a.sort_order || 0) - (b.sort_order || 0);
      return order || a.id.localeCompare(b.id);
    });
  const pages = Math.max(1, Math.ceil(filtered.length / f.page_size));
  const page = Math.min(f.page, pages);
  return {
    items: filtered.slice((page - 1) * f.page_size, page * f.page_size),
    total: filtered.length,
    page,
    page_size: f.page_size,
    pages,
    facets,
  };
}
