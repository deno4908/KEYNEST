import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Empty, Loading, ProductCard } from "./App";
import { api, categories } from "./api";
import type { Category, Product } from "./types";

type CatalogResult = {
  items: Product[];
  total: number;
  page: number;
  pages: number;
  facets: {
    groups: string[];
    platforms: string[];
    regions: string[];
    categories: Record<string, number>;
  };
};

export function Catalog() {
  const [params, setParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [result, setResult] = useState<{
    key: string;
    data: CatalogResult;
  } | null>(null);
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const requestKey = params.toString();
  const data = result?.key === requestKey ? result.data : null;
  const error = failure?.key === requestKey ? failure.message : "";
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<CatalogResult>(`/catalog?${requestKey}`, {
        signal: controller.signal,
      })
        .then((data) => {
          if (!controller.signal.aborted) {
            setResult({ key: requestKey, data });
            setFailure(null);
          }
        })
        .catch((e: Error) => {
          if (!controller.signal.aborted)
            setFailure({ key: requestKey, message: e.message });
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [requestKey, attempt]);
  const category = (params.get("category") || "all") as Category;
  const query = params.get("q") || "";
  const {
    groups = [],
    platforms = [],
    regions = [],
  } = (data || result?.data)?.facets || {};
  function change(key: string, value: string, replace = false) {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    if (key !== "page") next.delete("page");
    if (key === "category")
      ["sub", "platform", "region"].forEach((k) => next.delete(k));
    setParams(next, { replace });
  }
  const pageCount = data?.pages || 1;
  const page = data?.page || 1;
  const chips = [...params.entries()].filter(
    ([k, v]) =>
      v &&
      [
        "q",
        "sub",
        "platform",
        "region",
        "max",
        "delivery",
        "stock",
        "sale",
      ].includes(k),
  );
  const chipLabel = (key: string, value: string) =>
    key === "max"
      ? `Đến ${Number(value).toLocaleString("vi-VN")}đ`
      : key === "delivery"
        ? value === "key"
          ? "Giao key tự động"
          : "Giao dịch vụ"
        : key === "stock"
          ? "Còn hàng"
          : key === "sale"
            ? "Đang giảm giá"
            : value;
  return (
    <div className="container page browse-page">
      <div className="breadcrumb">
        <Link to="/">Trang chủ</Link>
        <ChevronRight size={13} />
        <Link to="/catalog">Cửa hàng</Link>
        {params.get("sub") && (
          <>
            <ChevronRight size={13} />
            <span>{params.get("sub")}</span>
          </>
        )}
      </div>
      <div className="page-heading">
        <div>
          <span className="eyebrow orange">KEYNEST STORE</span>
          <h1>{params.get("sub") || categories[category] || "Cửa hàng"}</h1>
          <p>Chọn nền tảng, khu vực và hình thức giao phù hợp với bạn.</p>
        </div>
        <span className="muted">
          {data ? `${data.total} sản phẩm` : "Đang tải…"}
        </span>
      </div>
      <div className="browse-layout">
        <aside className={`browse-filters ${filtersOpen ? "expanded" : ""}`}>
          <button
            className="browse-filter-toggle"
            onClick={() => setFiltersOpen(!filtersOpen)}
            aria-expanded={filtersOpen}
            aria-controls="catalog-filter-fields"
          >
            <SlidersHorizontal size={17} />
            Bộ lọc sản phẩm<span>{chips.length || ""}</span>
            <ChevronRight size={16} />
          </button>
          <div id="catalog-filter-fields" className="browse-filter-fields">
            <h3>Danh mục</h3>
            <div className="browse-categories">
              {(Object.keys(categories) as Category[]).map((c) => (
                <button
                  key={c}
                  aria-pressed={category === c}
                  onClick={() => change("category", c === "all" ? "" : c)}
                >
                  {categories[c]}
                  <span>
                    {(data || result?.data)?.facets.categories[c] ?? "—"}
                  </span>
                </button>
              ))}
            </div>
            <label>
              Phân loại
              <select
                aria-label="Phân loại"
                value={params.get("sub") || ""}
                onChange={(e) => change("sub", e.target.value)}
              >
                <option value="">Tất cả phân loại</option>
                {groups.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Nền tảng
              <select
                aria-label="Nền tảng"
                value={params.get("platform") || ""}
                onChange={(e) => change("platform", e.target.value)}
              >
                <option value="">Tất cả nền tảng</option>
                {platforms.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Khu vực kích hoạt
              <select
                aria-label="Khu vực kích hoạt"
                value={params.get("region") || ""}
                onChange={(e) => change("region", e.target.value)}
              >
                <option value="">Tất cả khu vực</option>
                {regions.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Khoảng giá
              <select
                aria-label="Khoảng giá"
                value={params.get("max") || ""}
                onChange={(e) => change("max", e.target.value)}
              >
                <option value="">Tất cả mức giá</option>
                <option value="100000">Đến 100.000đ</option>
                <option value="200000">Đến 200.000đ</option>
                <option value="500000">Đến 500.000đ</option>
                <option value="1000000">Đến 1.000.000đ</option>
              </select>
            </label>
            <label>
              Hình thức giao
              <select
                aria-label="Hình thức giao"
                value={params.get("delivery") || ""}
                onChange={(e) => change("delivery", e.target.value)}
              >
                <option value="">Tất cả hình thức</option>
                <option value="key">Key tự động sau thanh toán</option>
                <option value="manual">Dịch vụ xử lý theo đơn</option>
              </select>
            </label>
            <label className="browse-check">
              <input
                type="checkbox"
                checked={params.has("stock")}
                onChange={(e) => change("stock", e.target.checked ? "1" : "")}
              />
              Chỉ sản phẩm còn hàng
            </label>
            <label className="browse-check">
              <input
                type="checkbox"
                checked={params.has("sale")}
                onChange={(e) => change("sale", e.target.checked ? "1" : "")}
              />
              Đang giảm giá
            </label>
            <button className="browse-reset" onClick={() => setParams({})}>
              Xóa tất cả bộ lọc
              <X size={14} />
            </button>
          </div>
        </aside>
        <section className="browse-results">
          <div className="catalog-toolbar">
            <div className="input-icon">
              <Search size={18} />
              <input
                aria-label="Lọc sản phẩm"
                value={query}
                onChange={(e) => change("q", e.target.value, true)}
                placeholder="Tìm trong cửa hàng…"
              />
            </div>
            <select
              aria-label="Sắp xếp"
              value={params.get("sort") || "featured"}
              onChange={(e) => change("sort", e.target.value)}
            >
              <option value="featured">Nổi bật trước</option>
              <option value="asc">Giá thấp đến cao</option>
              <option value="desc">Giá cao đến thấp</option>
              <option value="name">Tên A–Z</option>
            </select>
          </div>
          {chips.length > 0 && (
            <div className="filter-chips">
              {chips.map(([key, value]) => (
                <button
                  key={key}
                  onClick={() => change(key, "")}
                  aria-label={`Bỏ lọc ${chipLabel(key, value)}`}
                >
                  {chipLabel(key, value)}
                  <X size={12} />
                </button>
              ))}
            </div>
          )}
          {error ? (
            <div className="panel" role="alert">
              <p>{error}</p>
              <button
                className="button button-outline"
                onClick={() => {
                  setFailure(null);
                  setAttempt((v) => v + 1);
                }}
              >
                Thử lại
              </button>
            </div>
          ) : !data ? (
            <Loading />
          ) : data.items.length ? (
            <div className="product-grid catalog-grid">
              {data.items.map((p) => (
                <ProductCard product={p} key={p.id} />
              ))}
            </div>
          ) : (
            <Empty
              icon={Search}
              title="Chưa tìm thấy sản phẩm"
              description="Thử từ khóa khác hoặc mở rộng bộ lọc."
            >
              <button
                className="button button-outline"
                onClick={() => setParams({})}
              >
                Xem tất cả sản phẩm
                <ArrowRight size={16} />
              </button>
            </Empty>
          )}
          {pageCount > 1 && (
            <nav className="browse-pagination" aria-label="Phân trang sản phẩm">
              <button
                aria-label="Trang trước"
                disabled={page === 1}
                onClick={() => change("page", String(page - 1))}
              >
                <ChevronLeft size={17} />
              </button>
              <span>
                Trang {page} / {pageCount}
              </span>
              <button
                aria-label="Trang sau"
                disabled={page === pageCount}
                onClick={() => change("page", String(page + 1))}
              >
                <ChevronRight size={17} />
              </button>
            </nav>
          )}
        </section>
      </div>
    </div>
  );
}
