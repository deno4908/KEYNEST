import { OrderChat, OrderChatButton, type SellerDispute } from "./OrderChat";
import { PreorderNote } from './PreorderNote';
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Package,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Upload,
  Download,
  RefreshCw,
  MessageCircle,
  ChevronDown,
} from "lucide-react";
import { api, post, money, date, statuses, categories } from "./api";
import { Loading, Modal, useStore } from "./App";
import { ProductEditor } from "./Admin";
import { ProfileForm, WithdrawalList } from "./Seller";
import type { Sale, SellerData } from "./Seller";
import type { Product, Ticket } from "./types";
import { useDataRefresh } from "./useDataRefresh";
import { useChatLive } from './useChatLive';
import { SELLER_TERMS_VERSION } from "../shared/seller-terms.js";
import bankDirectory from "./data/vietnam-banks.json";

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();
const stock = (p: Product) => p.variants.reduce((sum, v) => sum + v.stock, 0);
const waiting = (s: Sale) =>
  s.delivery === "manual" && !s.delivered_at && !s.refunded_at && s.order.status === "processing";
function exportCsv(name: string, rows: (string | number)[][]) {
  const csv = rows
    .map((row) =>
      row
        .map((value) => {
          const text = String(value);
          return `"${(/^[\s]*[=+\-@]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`;
        })
        .join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Pages({
  page,
  total,
  change,
}: {
  page: number;
  total: number;
  change: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / 12));
  return (
    <div className="seller-pagination">
      <span>
        {total} kết quả · Trang {page}/{pages}
      </span>
      <div className="button-row">
        <button
          className="button button-outline button-small"
          disabled={page <= 1}
          onClick={() => change(page - 1)}
        >
          Trước
        </button>
        <button
          className="button button-outline button-small"
          disabled={page >= pages}
          onClick={() => change(page + 1)}
        >
          Sau
        </button>
      </div>
    </div>
  );
}
type Action = { endpoint: string; title: string; quantity?: number };
type Support = Ticket & { order_number: string; refund_item_id?: string; refund?: SellerDispute };

export function Seller({ onboarding = false }: { onboarding?: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, setUser, refresh, notify } = useStore();
  const [data, setData] = useState<SellerData | null>(null);
  const [error, setError] = useState(""),
    [updated, setUpdated] = useState(""),
    [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState("products"),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [category, setCategory] = useState("all"),
    [period, setPeriod] = useState("all"),
    [sort, setSort] = useState("name"),
    [page, setPage] = useState(1);
  useEffect(() => {
    const target = new URLSearchParams(location.search).get("tab");
    if (target && ['sales', 'products', 'revenue', 'withdrawals', 'support', 'profile', 'notifications'].includes(target)) {
      setTab(target);
      setQuery("");
      setFilter("all");
      setPage(1);
    }
  }, [location.key, location.search]);
  const [editing, setEditing] = useState<Partial<Product> | null>(null),
    [action, setAction] = useState<Action | null>(null),
    [deleting, setDeleting] = useState<Product | null>(null),
    [detail, setDetail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState(""),
    [secrets, setSecrets] = useState("");
  const [tickets, setTickets] = useState<Support[]>([]),
    [supportError, setSupportError] = useState(""),
    [ticketId, setTicketId] = useState<string | null>(null),
    [reply, setReply] = useState("");
  const [idempotency, setIdempotency] = useState(() => crypto.randomUUID());
  const generation = useRef(0);
  const load = async () => {
    if (user?.role !== "seller") return;
    const version = ++generation.current;
    setSyncing(true);
    try {
      const next = await api<SellerData>("/seller/overview");
      if (version !== generation.current) return;
      setData(next);
      setUser(next.profile);
      setError("");
      setUpdated(new Date().toISOString());
    } catch (e) {
      if (version === generation.current) setError((e as Error).message);
    } finally {
      if (version === generation.current) setSyncing(false);
    }
  };
  const saved = async () => {
    await load();
    await refresh();
  };
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [user?.id, user?.role]);
  useDataRefresh(
    load,
    ["/seller/", "/admin/", "/orders", "/wallet", "/tickets", "/order-chat/"],
    { intervalMs: 30000, enabled: user?.role === "seller" },
  );
  const supportLive = useChatLive<Support[]>(tab === 'support' && user?.role === 'seller' ? 'seller-support' : null,
    user?.id, rows => { setTickets(rows); setSupportError(''); }, setSupportError);
  useEffect(() => {
    setPage(1);
  }, [query, filter, category, sort, period, tab]);
  if (user?.role !== "seller")
    return (
      <div className="container page">
        <h1>Kênh người bán</h1>
        <p>Tài khoản cần được admin cấp quyền seller.</p>
      </div>
    );
  if (!data)
    return error ? (
      <div className="container page">
        <p role="alert">{error}</p>
        <button className="button" onClick={load}>
          Thử lại
        </button>
      </div>
    ) : (
      <Loading />
    );
  const ready =
    data.profile.seller_terms_version === SELLER_TERMS_VERSION &&
    !!data.profile.seller_terms_accepted_at;
  if (onboarding && !ready)
    return (
      <div className="container page seller-page seller-onboarding">
        <ProfileForm profile={data.profile} fee={data.fee_bps} saved={saved} />
      </div>
    );
  const selectTab = (next: string) => {
    navigate(`/seller?tab=${encodeURIComponent(next)}`);
    setTab(next);
    setFilter("all");
    setQuery("");
    setPage(1);
  };
  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setActionError("");
    try {
      await fn();
      await load();
      notify(success);
      return true;
    } catch (e) {
      setActionError((e as Error).message);
      notify((e as Error).message, true);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const openAction = (next: Action) => {
    setAction(next);
    setActionError("");
    setSecrets("");
  };
  const lines = secrets
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const duplicate = new Set(lines).size !== lines.length;
  async function submitAction(e: FormEvent) {
    e.preventDefault();
    if (
      await run(
        () => post(action!.endpoint, { secrets: lines }),
        "Đã cập nhật.",
      )
    )
      setAction(null);
  }
  async function withdraw(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    if (
      await run(
        () =>
          post("/seller/withdrawals", {
            amount: Number(f.get("amount")),
            bank: f.get("bank"),
            account_number: f.get("account_number"),
            account_name: f.get("account_name"),
            idempotency,
          }),
        "Đã gửi yêu cầu rút tiền.",
      )
    ) {
      setIdempotency(crypto.randomUUID());
      (form.elements.namedItem("amount") as HTMLInputElement).value = "";
    }
  }
  const products = data.products
    .filter(
      (p) =>
        fold(`${p.name} ${p.slug}`).includes(fold(query)) &&
        (category === "all" || p.category === category) &&
        (filter === "all" ||
          (filter === "active" && p.active) ||
          (filter === "hidden" && !p.active) ||
          (filter === "empty" && stock(p) === 0) ||
          (filter === "low" &&
            (!p.variants.length || p.variants.some((v) => v.active !== false && !v.unlimited && v.delivery === 'key' && v.stock <= 5)))),
    )
    .sort((a, b) =>
      sort === "stock"
        ? stock(a) - stock(b)
        : a.name.localeCompare(b.name, "vi"),
    );
  const since = period === "all" ? 0 : Date.now() - Number(period) * 86400000;
  const sales = data.sales
    .filter(
      (s) =>
        new Date(s.order.created_at).getTime() >= since &&
        fold(`${s.order.number} ${s.name} ${s.variant_name}`).includes(
          fold(query),
        ) &&
        (filter === "all" ||
          (filter === "waiting" ? waiting(s) : s.order.status === filter)),
    )
    .sort((a, b) => b.order.created_at.localeCompare(a.order.created_at));
  const revenue = data.sales.filter(
    (s) =>
      new Date(s.order.created_at).getTime() >= since && s.seller_net != null,
  );
  const gross = revenue.reduce((sum, s) => sum + (s.seller_gross || 0), 0),
    fees = revenue
      .filter((s) => !s.seller_reversed_at)
      .reduce((sum, s) => sum + (s.seller_fee || 0), 0),
    reversed = revenue
      .filter((s) => s.seller_reversed_at)
      .reduce((sum, s) => sum + (s.seller_net || 0), 0),
    net = revenue
      .filter((s) => !s.seller_reversed_at)
      .reduce((sum, s) => sum + (s.seller_net || 0), 0);
  const withdrawals = data.withdrawals.filter(
    (w) =>
      (filter === "all" || w.status === filter) &&
      fold(`${w.id} ${w.bank} ${w.reference}`).includes(fold(query)),
  );
  const low = data.products.filter(
    (p) =>
      p.active && (!p.variants.length || p.variants.some((v) => v.active !== false && !v.unlimited && v.delivery === 'key' && v.stock <= 5)),
  );
  const pending = data.sales.filter(waiting);
  const displayed = <T,>(rows: T[]) =>
    rows.slice(
      (Math.min(page, Math.max(1, Math.ceil(rows.length / 12))) - 1) * 12,
      Math.min(page, Math.max(1, Math.ceil(rows.length / 12))) * 12,
    );
  const pages = (total: number) => (
    <Pages
      page={Math.min(page, Math.max(1, Math.ceil(total / 12)))}
      total={total}
      change={setPage}
    />
  );
  const selectedSale = data.sales.find((s) => s.id === detail);
  const selectedSaleImage = selectedSale && (selectedSale.product_image || data.products.find(p => p.id === selectedSale.product_id)?.image);
  const selectedTicket = tickets.find((t) => t.id === ticketId);
  const saleExport = () =>
    exportCsv("keynest-don-ban.csv", [
      [
        "Đơn",
        "Ngày đặt",
        "Sản phẩm",
        "Gói",
        "Số lượng",
        "Trạng thái",
        "Doanh thu",
        "Phí",
        "Thực nhận",
        "Đã thu hồi",
      ],
      ...sales.map((s) => [
        s.order.number,
        s.order.created_at,
        s.name,
        s.variant_name,
        s.quantity,
        statuses[s.order.status] || s.order.status,
        s.seller_gross || 0,
        s.seller_fee || 0,
        s.seller_net || 0,
        s.seller_reversed_at ? "Có" : "Không",
      ]),
    ]);
  return (
    <div className="container page seller-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow orange">KEYNEST / SELLER</span>
          <h1>Gian hàng của bạn.</h1>
          <p>
            {data.profile.seller_name || data.profile.name} · Quản lý sản phẩm,
            đơn bán và dòng tiền.
          </p>
        </div>
        <div className="seller-sync">
          <button
            className="button button-outline"
            disabled={syncing}
            onClick={load}
          >
            <RefreshCw size={15} />
            {syncing ? "Đang cập nhật…" : "Làm mới"}
          </button>
          <small>
            {updated
              ? `Cập nhật ${date(updated)}`
              : "Đang kết nối"}
          </small>
        </div>
      </header>
      {error && (
        <p className="form-error" role="alert">
          Chưa đồng bộ được dữ liệu mới: {error}. Dữ liệu đang hiển thị là lần
          tải thành công gần nhất.
        </p>
      )}
      <div className="seller-stats seller-overview-stats">
        <div>
          <small>Tiền đang giữ</small>
          <strong>{money(data.held || 0)}</strong>
        </div>
        <div>
          <small>Sản phẩm đang bán</small>
          <strong>
            {data.products.filter((p) => p.active).length}
            <small> / {data.products.length}</small>
          </strong>
        </div>
        <div className="seller-stat-balance">
          <small>Số dư khả dụng</small>
          <strong>{money(data.profile.balance)}</strong>
        </div>
        <div>
          <small>Đang chờ rút</small>
          <strong>
            {money(
              data.withdrawals
                .filter((w) => w.status === "pending")
                .reduce((sum, w) => sum + w.amount, 0),
            )}
          </strong>
        </div>
        <div>
          <small>Chờ giao thủ công</small>
          <strong>{pending.length}</strong>
        </div>
      </div>
      {!!data.profile.seller_debt && (
        <p className="form-error">
          Cần bù trừ {money(data.profile.seller_debt)} từ đơn hoàn tiền. Chưa
          thể rút tiền khi còn khoản này.
        </p>
      )}
      {(low.length > 0 || pending.length > 0) && (
        <div className="seller-attention">
          {low.length > 0 && (
            <button
              onClick={() => {
                selectTab("products");
                setFilter("low");
              }}
            >
              Có {low.length} sản phẩm cần bổ sung kho <Arrow />
            </button>
          )}
          {pending.length > 0 && (
            <button
              onClick={() => {
                selectTab("sales");
                setFilter("waiting");
              }}
            >
              {pending.length} gói đang chờ bạn giao <Arrow />
            </button>
          )}
        </div>
      )}
      <nav className="seller-tabs" aria-label="Kênh người bán">
        {[
          ["products", "Sản phẩm & kho"],
          ["sales", "Đơn bán"],
          ["revenue", "Doanh thu"],
          ["withdrawals", "Rút tiền"],
          ["support", "Hỗ trợ & bảo hành"],
          ["notifications", "Hộp thông báo"],
          ["profile", "Hồ sơ & điều khoản"],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-current={tab === key ? "page" : undefined}
            className={tab === key ? "selected" : ""}
            onClick={() => selectTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === 'notifications' && <NotificationInbox />}
      {tab === "profile" && (
        <ProfileForm profile={data.profile} fee={data.fee_bps} saved={saved} />
      )}
      {["products", "sales", "withdrawals", "support"].includes(tab) && (
        <div className="seller-toolbar">
          <label>
            Tìm kiếm
            <input
              type="search"
              placeholder={
                tab === "sales"
                  ? "Mã đơn, tên sản phẩm hoặc gói…"
                  : "Nhập từ khóa…"
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label>
            Trạng thái
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">Tất cả</option>
              {(tab === "products"
                ? [
                    ["active", "Đang bán"],
                    ["hidden", "Đã ẩn"],
                    ["empty", "Hết hàng"],
                    ["low", "Tồn kho ≤ 5"],
                  ]
                : tab === "sales"
                  ? [
                      ["waiting", "Chờ giao"],
                      ["pending", "Chờ thanh toán"],
                      ["processing", "Đang xử lý"],
                      ["completed", "Hoàn thành"],
                      ["refunded", "Đã hoàn tiền"],
                      ["cancelled", "Đã hủy"],
                      ["expired", "Hết hạn"],
                    ]
                  : tab === "support"
                    ? [
                        ["open", "Đang chờ"],
                        ["in_progress", "Đang xử lý"],
                        ["closed", "Đã đóng"],
                      ]
                    : [
                        ["pending", "Chờ duyệt"],
                        ["paid", "Đã chuyển"],
                        ["rejected", "Từ chối"],
                        ["cancelled", "Đã hủy"],
                      ]
              ).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {tab === "products" && (
            <>
              <label>
                Danh mục
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {Object.entries(categories).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Sắp xếp
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="name">Tên A–Z</option>
                  <option value="stock">Tồn kho thấp trước</option>
                </select>
              </label>
            </>
          )}
        </div>
      )}
      {["sales", "revenue"].includes(tab) && (
        <div className="seller-toolbar">
          <label>
            Thời gian đặt đơn
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="all">Toàn bộ</option>
              <option value="7">7 ngày qua</option>
              <option value="30">30 ngày qua</option>
              <option value="90">90 ngày qua</option>
            </select>
          </label>
          <button className="button button-outline" onClick={saleExport}>
            <Download size={16} />
            Xuất CSV đơn bán
          </button>
        </div>
      )}
      {tab === "products" && (
        <section>
          <div className="section-title">
            <h2>Sản phẩm của tôi</h2>
            <button className="button" onClick={() => setEditing({})}>
              <Plus size={16} />
              Thêm sản phẩm
            </button>
          </div>
          <div className="seller-product-list">
            {displayed(products).map((p) => (
              <article key={p.id}>
                <span className="seller-product-cover">
                  {p.image ? <img src={p.image} alt={p.name} loading="lazy" /> : <Package size={28} />}
                </span>
                <div className="seller-product-copy">
                  <div className="seller-product-heading">
                    {p.active && p.review_status === 'approved' ? <Link to={`/products/${p.slug}`}><strong>{p.name}</strong></Link> : <strong>{p.name}</strong>}
                    <span className={`seller-review-badge seller-review-${p.review_status === 'approved' && !p.active ? 'hidden' : p.review_status || 'pending'}`}>
                      {p.review_status === 'approved' ? (p.active ? 'Đang bán' : 'Đã ẩn') : p.review_status === 'rejected' ? 'Cần chỉnh sửa' : 'Chờ duyệt'}
                    </span>
                  </div>
                  <p className="seller-product-meta">{p.variants.length} gói bán · {p.variants.some(v => v.unlimited) ? 'Kho không giới hạn' : `${stock(p)} tồn kho`}</p>
                  {p.review_status !== 'approved' && <p className="seller-product-review-note">
                    {p.review_status === 'rejected' ? `Lý do từ chối: ${p.review_reason || 'Liên hệ hỗ trợ để biết thêm.'}` : 'Admin đang kiểm tra. Sản phẩm sẽ được mở bán sau khi duyệt.'}
                  </p>}
                </div>
                <div className="seller-row-actions">
                  <button
                    className="button button-outline"
                    onClick={() => setEditing(p)}
                  >
                    Quản lý
                  </button>
                  <button
                    className="icon-button"
                    disabled={busy || (!p.active && p.review_status !== 'approved')}
                    aria-label={`${p.active ? "Ẩn bán" : "Mở bán"} ${p.name}`}
                    title={p.review_status !== 'approved' ? 'Cần admin duyệt trước khi mở bán' : undefined}
                    onClick={() =>
                      void run(
                        () =>
                          post(`/seller/products/${p.id}/visibility`, {
                            active: !p.active,
                          }),
                        p.active ? "Đã ẩn sản phẩm." : "Đã mở bán.",
                      )
                    }
                  >
                    {p.active ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                  <button
                    className="icon-button seller-delete-button"
                    aria-label={`Xóa sản phẩm ${p.name}`}
                    onClick={() => {
                      setDeleting(p);
                      setActionError("");
                    }}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
                <details className="seller-product-variants">
                  <summary><span><Package size={15} />Gói bán & tồn kho<small>{p.variants.length}</small></span><ChevronDown size={16} /></summary>
                  <div className="seller-stock-list">
                    {p.variants.map((v) => (
                      <div key={v.id}>
                        <div className="seller-stock-info">
                          <strong>{v.name}</strong>
                          <span>{money(v.price)}</span>
                        </div>
                        <span className={`seller-stock-badge${!v.unlimited && v.stock <= 5 ? ' is-low' : ''}`}>
                          {v.unlimited ? 'Không giới hạn' : `${v.is_preorder ? 'Còn lượt đặt' : 'Tồn'} ${v.stock}`}
                        </span>
                        {v.delivery === "key" && !v.unlimited && (
                          <button
                            className="button button-small button-outline"
                            onClick={() =>
                              openAction({
                                endpoint: `/seller/inventory/${v.id}`,
                                title: `Nhập mã · ${v.name}`,
                              })
                            }
                          >
                            <Upload size={14} />
                            Nhập mã
                          </button>
                        )}
                      </div>
                    ))}
                    {!p.variants.length && (
                      <p>Chưa có gói. Mở Quản lý để thêm gói bán.</p>
                    )}
                  </div>
                </details>
              </article>
            ))}
          </div>
          {!products.length && (
            <div className="panel seller-empty">
              <Package size={32} />
              <h3>
                {data.products.length
                  ? "Không có sản phẩm phù hợp"
                  : "Bắt đầu với sản phẩm đầu tiên"}
              </h3>
              <p>
                {data.products.length
                  ? "Thử thay đổi bộ lọc hoặc từ khóa."
                  : "Thêm sản phẩm, gói bán và nhập kho để bắt đầu."}
              </p>
            </div>
          )}
          {pages(products.length)}
        </section>
      )}
      {tab === "sales" && (
        <section className="seller-section">
          <h2>Đơn bán & giao hàng</h2>
          <div className="panel table-scroll">
            <table className="seller-sales-table">
              <thead>
                <tr>
                  <th>Đơn / sản phẩm</th>
                  <th>Trạng thái</th>
                  <th>Phí / thực nhận</th>
                  <th>Giao hàng</th>
                </tr>
              </thead>
              <tbody>
                {displayed(sales).map((s) => (
                  <tr key={s.id}>
                    <td>
                      <button
                        className="seller-text-button"
                        onClick={() => setDetail(s.id)}
                      >
                        {s.order.number}
                      </button>
                      <p>
                        {s.name} · {s.variant_name} ×{s.quantity}
                      </p>
                      <small>{date(s.order.created_at)}</small>
                      <PreorderNote item={s} />
                    </td>
                    <td>
                      {statuses[s.order.status] || s.order.status}
                      <p>
                        {s.seller_gross != null ? money(s.seller_gross) : "—"}
                      </p>
                    </td>
                    <td>
                      {s.seller_fee != null ? money(s.seller_fee) : "—"}
                      <p>
                        {s.seller_reversed_at
                          ? "Đã thu hồi"
                          : s.seller_net != null
                            ? money(s.seller_net)
                            : "—"}
                      </p>
                    </td>
                    <td>
                      <div className="seller-sale-actions">
                      <OrderChatButton itemId={s.id} label="Chat" />
                      {s.delivered_at ? (
                        <span className="badge status-completed">Đã giao</span>
                      ) : waiting(s) ? (
                        <button
                          className="button button-small"
                          onClick={() =>
                            openAction({
                              endpoint: `/seller/items/${s.id}/fulfill`,
                              title: `Giao ${s.quantity} kết quả · ${s.name}`,
                              quantity: s.quantity,
                            })
                          }
                        >
                          Giao sản phẩm
                        </button>
                      ) : (
                        "—"
                      )}
                      <button
                        className="button button-small button-outline"
                        onClick={() => setDetail(s.id)}
                      >
                        Chi tiết
                      </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!sales.length && (
              <p className="seller-empty">Không có đơn bán phù hợp.</p>
            )}
          </div>
          {pages(sales.length)}
        </section>
      )}
      {tab === "revenue" && (
        <section className="seller-section">
          <h2>Doanh thu & đối soát</h2>
          <p className="muted">
            Theo thời gian đặt đơn, chỉ tính các gói đã thanh toán. Doanh thu
            thực nhận khác số dư ví sau khi mua hàng, rút tiền hoặc bù trừ.
          </p>
          <div className="seller-stats">
            {[
              ["Doanh thu sau giảm giá", gross],
              ["Phí của đơn chưa hoàn", fees],
              ["Thực nhận chưa bị thu hồi", net],
              ["Thu nhập đã thu hồi", reversed],
            ].map(([label, value]) => (
              <div key={label}>
                <small>{label}</small>
                <strong>{money(Number(value))}</strong>
              </div>
            ))}
          </div>
          <h3>Lịch sử biến động số dư</h3>
          <div className="panel table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Nội dung</th>
                  <th>Số tiền</th>
                </tr>
              </thead>
              <tbody>
                {displayed(data.ledger || []).map((l) => (
                  <tr key={l.id}>
                    <td>{date(l.created_at)}</td>
                    <td>{l.description}</td>
                    <td>
                      {l.amount > 0 ? "+" : ""}
                      {money(l.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.ledger?.length && (
              <p className="seller-empty">Chưa có giao dịch.</p>
            )}
          </div>
          {pages(data.ledger?.length || 0)}
        </section>
      )}
      {tab === "revenue" && (
        <section className="panel table-scroll seller-section">
          <h3>Tiền đang giữ</h3>
          <p>
            48 giờ tính từ lúc giao thành công từng sản phẩm. Yêu cầu hoàn tiền
            chưa giải quyết sẽ tiếp tục giữ tiền.
          </p>
          <table>
            <thead>
              <tr>
                <th>Đơn / sản phẩm</th>
                <th>Số tiền sau phí</th>
                <th>Giải ngân dự kiến</th>
                <th>Trao đổi</th>
              </tr>
            </thead>
            <tbody>
              {data.sales
                .filter(
                  (s) =>
                    s.seller_net != null &&
                    !s.seller_settled_at &&
                    !s.seller_reversed_at,
                )
                .map((s) => (
                  <tr key={s.id}>
                    <td>
                      {s.order.number}
                      <p>{s.name}</p>
                    </td>
                    <td>{money(s.seller_net || 0)}</td>
                    <td>
                      {s.seller_frozen
                        ? "Đóng băng · chờ xử lý hoàn tiền"
                        : s.seller_hold_until
                          ? date(s.seller_hold_until)
                          : "Chưa giao hàng"}
                    </td>
                    <td>
                      <OrderChatButton itemId={s.id} label="Chat" />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      )}
      {tab === "withdrawals" && (
        <div className="seller-withdraw-layout">
          <form className="panel form" onSubmit={withdraw}>
            <h2>Yêu cầu rút tiền</h2>
            <p className="muted">
              Khả dụng: {money(data.profile.balance)}. Tối thiểu 50.000đ. Tiền
              được giữ ngay khi gửi; yêu cầu bị từ chối được trả về ví.
            </p>
            <label>
              Số tiền
              <input
                name="amount"
                type="number"
                min={50000}
                max={Math.min(data.profile.balance, 100000000)}
                step={1}
                required
              />
            </label>
            <label>
              Ngân hàng
              <select name="bank" defaultValue="" required>
                <option value="" disabled>Chọn ngân hàng nhận tiền</option>
                {bankDirectory.banks.map((bank) => (
                  <option key={bank.code} value={bank.shortName}>
                    {bank.shortName} — {bank.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Số tài khoản
              <input
                name="account_number"
                inputMode="numeric"
                pattern="[0-9]{5,30}"
                required
              />
            </label>
            <label>
              Tên chủ tài khoản
              <input
                name="account_name"
                minLength={2}
                maxLength={100}
                required
              />
            </label>
            <button
              className="button"
              disabled={
                busy ||
                data.profile.balance < 50000 ||
                !!data.profile.seller_debt
              }
            >
              {busy ? "Đang gửi…" : "Gửi yêu cầu rút"}
            </button>
          </form>
          <section>
            <div className="section-title">
              <h2>Lịch sử rút tiền</h2>
              <button
                className="button button-outline button-small"
                onClick={() =>
                  exportCsv("keynest-rut-tien.csv", [
                    ["Mã", "Ngày", "Số tiền", "Trạng thái", "Mã chuyển khoản"],
                    ...withdrawals.map((w) => [
                      w.id,
                      w.created_at,
                      w.amount,
                      w.status,
                      w.reference,
                    ]),
                  ])
                }
              >
                Xuất CSV
              </button>
            </div>
            <WithdrawalList withdrawals={displayed(withdrawals)} />
            {pages(withdrawals.length)}
          </section>
        </div>
      )}
      {tab === "support" && (
        <section>
          <h2>Hỗ trợ & bảo hành</h2>
          <p className="muted">
            Trao đổi về các đơn thuộc gian hàng của bạn. Yêu cầu liên quan nhiều
            người bán do KEYNEST điều phối. Hoàn tiền do quản trị viên đối soát.
          </p>
          {supportError && (
            <p role="alert" className="form-error">
              {supportError}
            </p>
          )}
          <div className="seller-withdraw-list">
            {tickets
              .filter(
                (t) =>
                  (filter === "all" || t.status === filter) &&
                  fold(`${t.subject} ${t.order_number}`).includes(fold(query)),
              )
              .map((t) => (
                <article className="panel seller-support-card" key={t.id}>
                  <div className="seller-support-card-heading">
                    <span className="seller-support-card-icon"><MessageCircle size={22} /></span>
                    <div><small>{t.refund_item_id ? 'HOÀN TIỀN SẢN PHẨM' : 'TRAO ĐỔI ĐƠN HÀNG'}</small><h3>{t.subject}</h3></div>
                    <span className={`badge status-${t.status}`}>{t.refund?.needs_admin ? 'Chờ admin' : t.refund?.status === 'refunded' ? 'Đã hoàn tiền' : t.refund?.status === 'rejected' ? 'Đã từ chối' : statuses[t.status]}</span>
                  </div>
                  <p className="seller-support-preview">{t.message}</p>
                  <div className="seller-support-meta"><span>Đơn <strong>{t.order_number}</strong></span><span>Gửi lúc {date(t.created_at)}</span>{t.refund?.amount != null && <span>Số tiền <strong>{money(t.refund.amount)}</strong></span>}</div>
                  {t.refund?.status === 'open' && <p className="seller-support-deadline">{t.refund.needs_admin ? 'Đã quá 48 giờ. Yêu cầu đang chờ admin xử lý.' : `Phản hồi trước ${date(t.refund.response_due_at!)}. Đồng ý sẽ tự hoàn tiền sản phẩm vào ví người mua.`}</p>}
                  <div className="seller-support-footer">
                  <button
                    className="button button-outline"
                    onClick={() => {
                      setTicketId(t.id);
                      setReply("");
                    }}
                  >
                    {t.refund_item_id ? 'Xem yêu cầu & trao đổi' : 'Xem trao đổi'} <Arrow />
                  </button>
                  <small>{t.messages?.length || 0} phản hồi</small>
                  </div>
                </article>
              ))}
            {!tickets.length && !supportError && (
              <p className="seller-empty">Chưa có yêu cầu hỗ trợ.</p>
            )}
          </div>
        </section>
      )}
      {editing && (
        <ProductEditor
          scope="seller"
          value={editing}
          close={() => setEditing(null)}
          changed={saved}
          saved={async () => {
            setEditing(null);
            await saved();
          }}
          importKeys={(v) =>
            openAction({
              endpoint: `/seller/inventory/${v.id}`,
              title: `Nhập mã · ${v.name}`,
            })
          }
        />
      )}
      {deleting && (
        <Modal title="Xóa sản phẩm" close={() => !busy && setDeleting(null)}>
          <p>
            Xóa vĩnh viễn <strong>{deleting.name}</strong> cùng các gói và mã
            chưa bán? Sản phẩm có lịch sử giao dịch không thể xóa; bạn có thể ẩn
            bán.
          </p>
          {actionError && (
            <p role="alert" className="form-error">
              {actionError}
            </p>
          )}
          <div className="button-row">
            <button
              className="button button-outline"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              Giữ lại
            </button>
            <button
              className="button button-outline"
              disabled={busy}
              onClick={async () => {
                if (
                  await run(
                    () =>
                      post(`/seller/products/${deleting.id}/visibility`, {
                        active: false,
                      }),
                    "Đã ẩn sản phẩm.",
                  )
                )
                  setDeleting(null);
              }}
            >
              Ẩn bán
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={async () => {
                if (
                  await run(
                    () =>
                      api(`/seller/products/${deleting.id}`, {
                        method: "DELETE",
                      }),
                    "Đã xóa sản phẩm.",
                  )
                )
                  setDeleting(null);
              }}
            >
              Xác nhận xóa
            </button>
          </div>
        </Modal>
      )}
      {action && (
        <Modal title={action.title} close={() => !busy && setAction(null)}>
          <form className="form" onSubmit={submitAction}>
            <label>
              Mỗi dòng một mã hoặc kết quả giao hàng
              <textarea
                rows={8}
                required
                value={secrets}
                onChange={(e) => setSecrets(e.target.value)}
              />
            </label>
            <small>
              {lines.length} dòng
              {action.quantity != null
                ? ` / cần ${action.quantity} kết quả`
                : ""}
            </small>
            {duplicate && (
              <p className="form-error">
                Có dòng trùng lặp. Kiểm tra lại trước khi gửi.
              </p>
            )}
            {actionError && (
              <p className="form-error" role="alert">
                {actionError}
              </p>
            )}
            <button
              className="button"
              disabled={
                busy ||
                !lines.length ||
                duplicate ||
                (action.quantity != null && lines.length !== action.quantity)
              }
            >
              {busy ? "Đang xử lý…" : "Xác nhận"}
            </button>
          </form>
        </Modal>
      )}
      {selectedSale && (
        <Modal
          title={`Đơn ${selectedSale.order.number}`}
          className="seller-sale-modal"
          close={() => setDetail(null)}
        >
          <div className="seller-sale-detail">
            <div className="seller-sale-product">
              <span className="seller-sale-product-icon">
                {selectedSaleImage ? <img src={selectedSaleImage} alt={selectedSale.name} loading="lazy" /> : <Package size={28} />}
              </span>
              <div><h3>{selectedSale.name}</h3><p>{selectedSale.variant_name} · Số lượng: {selectedSale.quantity}</p></div>
              <span className={`badge status-${selectedSale.order.status}`}>{statuses[selectedSale.order.status] || selectedSale.order.status}</span>
            </div>
            <section className="seller-sale-section">
              <h3>Doanh thu của sản phẩm</h3>
              <dl className="seller-sale-finance">
                <div><dt>Doanh thu</dt><dd>{selectedSale.seller_gross != null ? money(selectedSale.seller_gross) : '—'}</dd></div>
                <div><dt>Phí nền tảng</dt><dd>{selectedSale.seller_fee != null ? money(selectedSale.seller_fee) : '—'}</dd></div>
                <div><dt>Thực nhận</dt><dd>{selectedSale.seller_net != null ? money(selectedSale.seller_net) : '—'}</dd></div>
              </dl>
              {selectedSale.seller_reversed_at ? <p className="info-note">Khoản thu đã được thu hồi.</p> : selectedSale.seller_frozen && <p className="info-note">Khoản thu đang bị giữ để chờ xử lý.</p>}
            </section>
            <section className="seller-sale-section">
            <h3>Thông tin giao hàng</h3>
            <dl className="seller-sale-facts">
              <div><dt>Ngày đặt hàng</dt><dd>{date(selectedSale.order.created_at)}</dd></div>
              <div><dt>Hình thức giao</dt><dd>{selectedSale.delivery === 'manual' ? 'Người bán giao hàng' : 'Giao tự động'}</dd></div>
              <div><dt>Giao hàng</dt><dd>{selectedSale.delivered_at ? date(selectedSale.delivered_at) : 'Chưa giao'}</dd></div>
              <div><dt>Bảo hành</dt><dd>{selectedSale.warranty_days ? `${selectedSale.warranty_days} ngày` : 'Không bảo hành theo ngày'}</dd></div>
            </dl>
            <PreorderNote item={selectedSale} />
            </section>
            {selectedSale.order.customer_note && (
              <section className="seller-sale-section">
                <h3>Thông tin khách cung cấp</h3>
                <p className="seller-preserve">
                  {selectedSale.order.customer_note}
                </p>
              </section>
            )}
            {waiting(selectedSale) && (
              <button
                className="button"
                onClick={() => {
                  setDetail(null);
                  openAction({
                    endpoint: `/seller/items/${selectedSale.id}/fulfill`,
                    title: `Giao ${selectedSale.quantity} kết quả · ${selectedSale.name}`,
                    quantity: selectedSale.quantity,
                  });
                }}
              >
                Giao sản phẩm
              </button>
            )}
          </div>
        </Modal>
      )}
      {selectedTicket && (
        selectedTicket.refund_item_id ? <OrderChat itemId={selectedTicket.refund_item_id} close={() => setTicketId(null)} /> :
        <Modal
          title={selectedTicket.subject}
          close={() => !busy && setTicketId(null)}
        >
          <div className="seller-conversation">
            <p className="seller-preserve">{selectedTicket.message}</p>
            {selectedTicket.messages?.map((m, i) => (
              <article key={i}>
                <strong>
                  {m.role === "seller"
                    ? "Người bán"
                    : m.role === "admin"
                      ? "KEYNEST"
                      : "Người mua"}
                </strong>
                <p className="seller-preserve">{m.body}</p>
                {m.created_at && <small>{date(m.created_at)}</small>}
              </article>
            ))}
          </div>
          {selectedTicket.status !== "closed" && (
            <form
              className="form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await run(
                    () =>
                      supportLive.send({ id: selectedTicket.id, body: reply }),
                    "Đã gửi phản hồi.",
                  )
                ) {
                  setReply("");
                }
              }}
            >
              <label>
                Phản hồi
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  minLength={3}
                  maxLength={3000}
                  required
                />
              </label>
              <button className="button" disabled={busy || !supportLive.connected}>
                Gửi phản hồi
              </button>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
function Arrow() {
  return <span aria-hidden="true">→</span>;
}
import { NotificationInbox } from './Notifications';
