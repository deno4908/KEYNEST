import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Gamepad2,
  Gift,
  Grid2X2,
  Headphones,
  Package,
  Search,
  Server,
  Smartphone,
  X,
} from "lucide-react";
import { useStore } from "./App";
import { categories, money } from "./api";
import {
  catalogHref,
  normalizeSearch,
  productGroup,
  productPrice,
} from "./discovery";
import type { Category } from "./types";

const categoryIcons: Record<string, typeof Gamepad2> = {
  game: Gamepad2,
  gift: Gift,
  topup: Smartphone,
  mmo: Server,
};
const categoryHints: Record<string, string> = {
  game: "Thế giới tiếp theo của bạn",
  gift: "Nạp ví, tặng bạn bè",
  topup: "Chọn game và gói nạp",
  mmo: "Công cụ cho công việc",
};

export function StoreNavigation({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const { products } = useStore();
  const location = useLocation();
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const focusTrigger = () => {
    const button = trigger.current?.getClientRects().length
      ? trigger.current
      : document.querySelector<HTMLElement>(".mobile-toggle");
    button?.focus();
  };
  const category = new URLSearchParams(location.search).get("category");
  useEffect(() => {
    onOpenChange(false);
    setExpanded(null);
  }, [location.pathname, location.search]);
  useEffect(() => {
    if (!open || !window.matchMedia('(max-width: 760px)').matches) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = document.getElementById('shop-departments');
    panel?.querySelector<HTMLButtonElement>('button')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = [...(panel?.querySelectorAll<HTMLElement>('a[href],button') || [])].filter(el => el.getClientRects().length && !el.matches(':disabled'));
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', trap); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const pointer = (e: PointerEvent) => {
      if (
        !root.current?.contains(e.target as Node) &&
        !(e.target as Element).closest?.(".mobile-toggle")
      )
        onOpenChange(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onOpenChange(false);
        focusTrigger();
      }
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", key);
    };
  }, [open, onOpenChange]);
  return (
    <nav
      className="shop-navigation"
      ref={root}
      aria-label="Điều hướng cửa hàng"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          onOpenChange(false);
      }}
    >
      <div className="container shop-nav-bar">
        <button
          ref={trigger}
          className={`department-toggle ${open ? "selected" : ""}`}
          aria-label="Danh mục sản phẩm"
          aria-expanded={open}
          aria-controls="shop-departments"
          onClick={() => onOpenChange(!open)}
        >
          <Grid2X2 size={18} />
          <span>Danh mục</span>
          <ChevronDown size={14} />
        </button>
        <div className="shop-nav-links">
          <NavLink to="/" end>
            Khám phá
          </NavLink>
          {Object.keys(categories).filter((c) => c !== 'all').map(
            (c) => (
              <Link
                key={c}
                to={catalogHref({ category: c })}
                className={
                  location.pathname === "/catalog" && category === c
                    ? "active"
                    : ""
                }
                aria-current={
                  location.pathname === "/catalog" && category === c
                    ? "page"
                    : undefined
                }
              >
                {categories[c]}
              </Link>
            ),
          )}
          <NavLink
            to="/promotions"
            className={({ isActive }) =>
              `nav-offers ${isActive ? "active" : ""}`
            }
          >
            Ưu đãi
          </NavLink>
        </div>
        <Link to="/orders" className="shop-orders-link">
          <Package size={17} />
          <span>Đơn hàng</span>
        </Link>
      </div>
      {open && (
        <div className="container department-panel" id="shop-departments">
          <div className="department-heading">
            <div>
              <strong>Danh mục sản phẩm</strong>
              <span>Game, thẻ quà tặng và dịch vụ số</span>
            </div>
            <button
              className="icon-button"
              aria-label="Đóng danh mục"
              onClick={() => {
                onOpenChange(false);
                focusTrigger();
              }}
            >
              <X size={19} />
            </button>
          </div>
          <div className="department-columns">
            {Object.keys(categories).filter((c) => c !== 'all').map(
              (c) => {
                const Icon = categoryIcons[c] || Package;
                const items = products.filter((p) => p.category === c);
                const groups = [...new Set(items.map(productGroup))];
                return (
                  <section key={c}>
                    <button className="department-mobile-toggle" type="button" aria-expanded={expanded === c} aria-controls={`department-group-${c}`} onClick={() => setExpanded(expanded === c ? null : c)}>
                      <Icon size={21} />
                      <span><strong>{categories[c]}</strong><small>{groups.length} nhóm sản phẩm</small></span>
                      <ChevronDown size={17} />
                    </button>
                    <Link
                      className="department-title"
                      to={catalogHref({ category: c })}
                    >
                      <Icon size={21} />
                      <div>
                        <strong>{categories[c]}</strong>
                        <small>{categoryHints[c] || 'Khám phá sản phẩm'}</small>
                      </div>
                      <ChevronRight size={15} />
                    </Link>
                    <div id={`department-group-${c}`} className={`department-body ${expanded === c ? 'is-expanded' : ''}`}>
                    <div className="department-children">
                      {groups.map((group) => (
                        <Link
                          key={group}
                          to={catalogHref({ category: c, sub: group })}
                        >
                          {group}
                          <span>
                            {
                              items.filter((p) => productGroup(p) === group)
                                .length
                            }
                          </span>
                        </Link>
                      ))}
                      {!groups.length && <p>Đang cập nhật sản phẩm.</p>}
                    </div>
                    <Link
                      className="department-all"
                      to={catalogHref({ category: c })}
                    >
                      Tất cả {categories[c]}
                      <ArrowRight size={13} />
                    </Link>
                    </div>
                  </section>
                );
              },
            )}
          </div>
          <div className="department-footer">
            <Link to="/catalog">
              Toàn bộ cửa hàng
              <ArrowRight size={15} />
            </Link>
            <Link to="/guide">Hướng dẫn mua hàng</Link>
            <Link to="/support">
              <Headphones size={15} />
              Hỗ trợ
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}

export function HeaderSearch() {
  const { products } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const matches = query.trim()
    ? products
        .filter((p) =>
          normalizeSearch(
            `${p.name} ${p.platform} ${productGroup(p)}`,
          ).includes(normalizeSearch(query)),
        )
        .slice(0, 5)
    : [];
  useEffect(() => {
    setOpen(false);
    setActive(-1);
  }, [location.pathname, location.search]);
  function submit() {
    setOpen(false);
    navigate(
      active >= 0 && matches[active]
        ? `/products/${matches[active].slug}`
        : catalogHref({ q: query.trim() }),
    );
  }
  return (
    <div
      className="search-area"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setOpen(false);
          setActive(-1);
        }
      }}
    >
      <form
        className="header-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Search size={19} />
        <input
          name="q"
          role="combobox"
          aria-label="Tìm sản phẩm"
          aria-expanded={open}
          aria-controls={open ? "search-results" : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            open && active >= 0 ? `search-result-${active}` : undefined
          }
          value={query}
          autoComplete="off"
          placeholder="Tìm game, gift card, proxy…"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              setActive(-1);
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              setActive((i) =>
                matches.length
                  ? (i + (e.key === "ArrowDown" ? 1 : -1) + matches.length) %
                    matches.length
                  : -1,
              );
            }
          }}
        />
        {query ? (
          <button
            type="button"
            aria-label="Xóa tìm kiếm"
            onClick={() => {
              setQuery("");
              setActive(-1);
            }}
          >
            <X size={16} />
          </button>
        ) : (
          <kbd aria-hidden="true">Enter</kbd>
        )}
      </form>
      {open && (
        <div className="search-suggestions">
          <span>{query.trim() ? "SẢN PHẨM PHÙ HỢP" : "KHÁM PHÁ NHANH"}</span>
          <div id="search-results" role="listbox" aria-label="Gợi ý sản phẩm">
            {matches.map((p, i) => (
              <Link
                role="option"
                aria-selected={i === active}
                id={`search-result-${i}`}
                className={i === active ? "selected" : ""}
                key={p.id}
                to={`/products/${p.slug}`}
                onMouseEnter={() => setActive(i)}
              >
                <span className="suggestion-icon">
                  {p.image ? <img src={p.image} alt="" /> : <Gift size={21} />}
                </span>
                <div>
                  <strong>{p.name}</strong>
                  <small>
                    {categories[p.category]} · {p.platform}
                  </small>
                </div>
                <b>
                  {Number.isFinite(productPrice(p))
                    ? money(productPrice(p))
                    : "Xem gói"}
                </b>
              </Link>
            ))}
          </div>
          {query.trim() ? (
            <>
              {!matches.length && (
                <p>Chưa có sản phẩm phù hợp với “{query}”.</p>
              )}
              <Link
                className="search-all"
                to={catalogHref({ q: query.trim() })}
              >
                Xem toàn bộ kết quả
                <ArrowRight size={15} />
              </Link>
            </>
          ) : (
            <div className="search-quick">
              {["Steam", "Xbox", "Valorant", "Proxy"].map((q) => (
                <Link key={q} to={catalogHref({ q })}>
                  {q}
                  <ArrowRight size={13} />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
