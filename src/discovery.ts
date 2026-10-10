import type { Product } from "./types";

export const normalizeSearch = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
export const productGroup = (product: Product) =>
  product.subcategory || product.platform || "Khác";
export const catalogHref = (filters: Record<string, string>) =>
  `/catalog?${new URLSearchParams(filters)}`;
export const productPrice = (product: Product) =>
  product.variants.length
    ? Math.min(...product.variants.map((v) => v.price))
    : Infinity;
export function readRecent(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem("kn-recent") || "[]");
    return Array.isArray(value)
      ? value.filter((v) => typeof v === "string").slice(0, 12)
      : [];
  } catch {
    return [];
  }
}
export function rememberProduct(slug: string) {
  try {
    localStorage.setItem(
      "kn-recent",
      JSON.stringify(
        [slug, ...readRecent().filter((s) => s !== slug)].slice(0, 12),
      ),
    );
  } catch {
    /* Browsing still works when storage is unavailable. */
  }
}
