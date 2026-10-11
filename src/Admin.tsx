import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  BarChart3,
  Check,
  ClipboardList,
  CreditCard,
  FileClock,
  Headphones,
  Package,
  Pencil,
  Plus,
  ShieldCheck,
  Ticket as TicketIcon,
  Upload,
  Users,
  Wallet,
} from "lucide-react";
import { api, categories, date, money, post } from "./api";
import { Badge, Empty, Loading, Modal, useStore } from "./App";
import type { Overview, Product, Variant } from "./types";
import { BannerManager } from "./Banners";
import { ImageUpload } from "./ImageUpload";
import { CouponManager } from "./AdminCoupons";
import { AdminOrderList, AdminOrderDialog } from "./AdminOrders";
import { SupportManager, TicketDialog } from "./AdminSupport";
import { BankPaymentStatus } from "./BankPaymentStatus";
import { AdminCustomers } from "./AdminCustomers";
import { AdminNotifications } from "./AdminNotifications";
import { AdminCategories } from './AdminCategories';
import { Bell } from "lucide-react";

const blankProduct = {
  slug: "",
  name: "",
  category: "game" as const,
  platform: "Steam",
  subcategory: "",
  subtitle: "",
  description: "",
  image: "",
  featured: false,
  active: true,
};
const blankVariant = {
  warranty_days: 30,
  name: "",
  price: 100000,
  original_price: 100000,
  delivery: "key" as const,
  stock: 0,
  region: "Global",
};
export function Admin() {
  const { notify, refresh } = useStore();
  const [data, setData] = useState<Overview | null>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState("overview"),
    [editing, setEditing] = useState<Partial<Product> | null>(null),
    [orderId, setOrderId] = useState<string | null>(null),
    [ticketId, setTicketId] = useState<string | null>(null),
    [action, setAction] = useState<{
      type: "import" | "reconcile";
      id: string;
      name: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [orderFilter, setOrderFilter] = useState("all");
  const load = () =>
    api<Overview>("/admin/overview")
      .then((result) => {
        setData(result);
        setError("");
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  const afterSave = async () => {
    await load();
    await refresh();
  };
  async function doAction(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      if (action!.type === "reconcile")
        await post(`/admin/reconcile/${encodeURIComponent(action!.id)}`, {
          user_id: f.get("user_id"),
          reason: f.get("content"),
        });
      else
        await post(`/admin/inventory/${action!.id}`, {
          secrets: String(f.get("content"))
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        });
      notify("Đã xử lý thành công.");
      setAction(null);
      await afterSave();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  const paid =
    data?.orders.filter((o) =>
      ["completed", "processing"].includes(o.status),
    ) || [];
  return (
    <div className="container page admin-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow orange">KEYNEST / BACK OFFICE</span>
          <h1>Quản trị cửa hàng.</h1>
          <p>Sản phẩm, kho mã và khách hàng trong một nơi.</p>
        </div>
        <button className="button button-outline" onClick={load}>
          Làm mới
        </button>
      </div>
      <div className="admin-layout">
        <aside className="admin-nav">
          {[
            ["overview", "Tổng quan", BarChart3],
            ["products", "Sản phẩm & kho", Package],
            ["categories", "Danh mục", Package],
            ["orders", "Đơn hàng", ClipboardList],
            ["tickets", "Hỗ trợ khách hàng", Headphones],
            ["users", "Khách hàng", Users],
            ["notifications", "Thông báo", Bell],
            ["payments", "Thanh toán", CreditCard],
            ["coupons", "Mã giảm giá", TicketIcon],
            ["banners", "Banner trang chủ", BarChart3],
            ["audit", "Nhật ký hoạt động", FileClock],
          ].map(([id, label, Icon]) => {
            const I = Icon as typeof Package;
            return (
              <button
                className={tab === id ? "selected" : ""}
                key={String(id)}
                onClick={() => setTab(String(id))}
              >
                <I size={18} />
                {String(label)}
                {id === "tickets" && <span aria-label="Yêu cầu chưa xử lý">{data?.tickets.filter(t => t.status !== 'closed').length || 0}</span>}
                {id === "orders" && (
                  <span>
                    {data?.orders.filter((o) => o.status === "processing")
                      .length || 0}
                  </span>
                )}
              </button>
            );
          })}
          <Link to="/">
            <ArrowUpRight size={17} />
            Xem cửa hàng
          </Link>
        </aside>
        <section className="admin-content">
          {error ? (
            <p className="form-error">{error}</p>
          ) : !data ? (
            <Loading />
          ) : (
            <>
              {tab === "banners" && <BannerManager />}
              {tab === 'categories' && <AdminCategories />}
              {tab === "overview" && (
                <>
                  <div className="stat-grid">
                    <div className="panel">
                      <span>
                        <Wallet size={18} />
                        Giá trị đơn đã thanh toán
                      </span>
                      <strong>
                        {money(paid.reduce((n, o) => n + o.total, 0))}
                      </strong>
                      <small>Không gồm đơn hoàn tiền</small>
                    </div>
                    <div className="panel">
                      <span>
                        <ClipboardList size={18} />
                        Chờ giao dịch vụ
                      </span>
                      <strong>
                        {
                          data.orders.filter((o) => o.status === "processing")
                            .length
                        }
                      </strong>
                      <small>Đơn đã thanh toán</small>
                    </div>
                    <div className="panel">
                      <span>
                        <Users size={18} />
                        Khách hàng
                      </span>
                      <strong>
                        {data.users.filter((u) => u.role === "customer").length}
                      </strong>
                      <small>Tài khoản đăng ký</small>
                    </div>
                    <div className="panel">
                      <span>
                        <Headphones size={18} />
                        Yêu cầu hỗ trợ
                      </span>
                      <strong>
                        {data.tickets.filter((t) => t.status === "open").length}
                      </strong>
                      <small>Đang chờ phản hồi</small>
                    </div>
                  </div>
                  <div className="panel">
                    <div className="section-title">
                      <h2>Đơn cần xử lý</h2>
                      <button
                        className="text-button"
                        onClick={() => setTab("orders")}
                      >
                        Xem tất cả <ArrowUpRight size={16} />
                      </button>
                    </div>
                    {data.orders.some((o) => o.status === "processing") ? (
                      <AdminOrderList
                        orders={data.orders.filter(
                          (o) => o.status === "processing",
                        )}
                        data={data}
                        onOpen={setOrderId}
                      />
                    ) : (
                      <Empty
                        icon={Check}
                        title="Mọi thứ đang ổn."
                        description="Không có đơn chờ giao dịch vụ."
                      />
                    )}
                  </div>
                  <div className="panel admin-note">
                    <ShieldCheck />
                    <div>
                      <strong>Giao key tự động. Dịch vụ có hàng đợi.</strong>
                      <p>
                        Mã được nhập trong “Sản phẩm & kho”. Nạp game và proxy
                        giao kết quả ở “Đơn hàng”. Các lần thao tác đều được lưu
                        nhật ký.
                      </p>
                    </div>
                  </div>
                </>
              )}
              {tab === "products" && (
                <>
                  <div className="section-title">
                    <h2>Sản phẩm & kho</h2>
                    <button
                      className="button button-small"
                      onClick={() => setEditing(blankProduct)}
                    >
                      <Plus size={17} />
                      Thêm sản phẩm
                    </button>
                  </div>
                  <div className="table-scroll panel">
                    <table>
                      <thead>
                        <tr>
                          <th>Sản phẩm</th>
                          <th>Nhóm</th>
                          <th>Gói / tồn kho</th>
                          <th>Hiển thị</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {data.products.map((p) => (
                          <tr key={p.id}>
                            <td>
                              <strong>{p.name}</strong>
                              <small>{p.platform}</small>
                            </td>
                            <td>{categories[p.category]}</td>
                            <td>
                              {p.variants.length} gói ·{" "}
                              {p.variants.reduce((n, v) => n + v.stock, 0)} đơn
                              vị
                            </td>
                            <td>
                              <Badge status={p.active ? "Đang bán" : "Đã ẩn"} />
                            </td>
                            <td>
                              <button
                                className="button button-outline button-small"
                                onClick={() => setEditing(p)}
                              >
                                <Pencil size={14} />
                                Quản lý
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {tab === "orders" && (
                <>
                  <div className="section-title">
                    <h2>Đơn hàng</h2>
                    <select
                      aria-label="Lọc trạng thái đơn"
                      value={orderFilter}
                      onChange={(e) => setOrderFilter(e.target.value)}
                    >
                      <option value="all">Tất cả trạng thái</option>
                      <option value="processing">Chờ giao dịch vụ</option>
                      <option value="pending">Chờ thanh toán</option>
                      <option value="completed">Hoàn thành</option>
                      <option value="refunded">Đã hoàn</option>
                    </select>
                  </div>
                  <div className="panel">
                    <AdminOrderList
                      orders={data.orders.filter(
                        (o) =>
                          orderFilter === "all" || o.status === orderFilter,
                      )}
                      data={data}
                      onOpen={setOrderId}
                    />
                  </div>
                </>
              )}
              {tab === "tickets" && (
                <SupportManager data={data} onSelect={setTicketId} />
              )}
              {tab === "users" && <AdminCustomers />}
              {tab === "notifications" && <AdminNotifications />}
              {tab === "payments" && (
                <>
                  <h2>Thanh toán & nạp ví</h2>
                  <BankPaymentStatus />
                  <div className="panel table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Nội dung</th>
                          <th>Khách hàng</th>
                          <th>Số tiền</th>
                          <th>Loại</th>
                          <th>Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.payments.map((p) => (
                          <tr key={p.id}>
                            <td className="mono">
                              {p.code}
                              <small>{date(p.created_at)}</small>
                            </td>
                            <td>
                              {
                                data.users.find((u) => u.id === p.user_id)
                                  ?.email
                              }
                            </td>
                            <td>{money(p.amount)}</td>
                            <td>{p.order_id ? "Đơn hàng" : "Nạp ví"}</td>
                            <td>
                              <Badge status={p.status} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="panel">
                    <h3>Giao dịch cần đối soát</h3>
                    <p className="muted">
                      Kiểm tra bằng chứng chuyển tiền và đúng chủ tài khoản.
                      Khoản chờ đối soát được cộng vào ví để khách đặt lại đơn;
                      mỗi giao dịch chỉ xử lý một lần.
                    </p>
                    {data.events.filter((e) => e.outcome === "needs_review")
                      .length ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>SePay ID / mã</th>
                              <th>Số tiền thực nhận</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {data.events
                              .filter((e) => e.outcome === "needs_review")
                              .map((e) => (
                                <tr key={e.transaction_id}>
                                  <td className="mono">
                                    {e.transaction_id}
                                    <small>
                                      {e.code} · {date(e.created_at)}
                                    </small>
                                  </td>
                                  <td>{money(e.amount)}</td>
                                  <td>
                                    <button
                                      className="button button-small button-outline"
                                      onClick={() =>
                                        setAction({
                                          type: "reconcile",
                                          id: e.transaction_id,
                                          name: `Giao dịch ${e.transaction_id} · ${money(e.amount)}`,
                                        })
                                      }
                                    >
                                      Đối soát vào ví
                                    </button>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="muted">Không có giao dịch chờ đối soát.</p>
                    )}
                  </div>
                </>
              )}
              {tab === "coupons" && (
                <CouponManager
                  coupons={data.coupons}
                  products={data.products}
                  saved={afterSave}
                />
              )}
              {tab === "audit" && (
                <>
                  <h2>Nhật ký hoạt động</h2>
                  <div className="panel table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Thời gian</th>
                          <th>Thao tác</th>
                          <th>Đối tượng</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.audit.map((a) => (
                          <tr key={a.id}>
                            <td>{date(a.created_at)}</td>
                            <td className="mono">{a.action}</td>
                            <td className="mono">{a.target}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!data.audit.length && (
                    <p className="muted">Chưa có hoạt động quản trị.</p>
                  )}
                </>
              )}
            </>
          )}
        </section>
      </div>
      {editing && (
        <ProductEditor
          value={editing}
          close={() => setEditing(null)}
          saved={async () => {
            setEditing(null);
            await afterSave();
          }}
          importKeys={(v) => {
            setEditing(null);
            setAction({ type: "import", id: v.id, name: v.name });
          }}
        />
      )}
      {action && (
        <Modal
          title={
            action.type === "import"
              ? "Nhập mã vào kho"
              : "Đối soát giao dịch vào ví"
          }
          close={() => setAction(null)}
        >
          <form className="form" onSubmit={doAction}>
            <p>
              <strong>{action.name}</strong>
            </p>
            {action.type === "reconcile" && (
              <>
                <label>
                  Khách hàng nhận khoản tiền
                  <select name="user_id" required>
                    <option value="">Chọn đúng tài khoản khách</option>
                    {data!.users.map((u) => (
                      <option value={u.id} key={u.id}>
                        {u.email} · {u.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="info-note">
                  Chỉ xác nhận sau khi kiểm tra bằng chứng chuyển tiền. Khoản
                  thực nhận được cộng vào ví; đơn quá hạn giữ nguyên trạng thái.
                </p>
              </>
            )}
            <label>
              {action.type === "reconcile"
                ? "Lý do / bằng chứng đối soát"
                : "Mỗi dòng một mã sản phẩm"}
              <textarea
                name="content"
                rows={7}
                required
                minLength={action.type === "reconcile" ? 10 : 1}
                maxLength={action.type === "reconcile" ? 2000 : 50000}
              />
            </label>
            <button className="button" disabled={busy}>
              {busy ? "Đang xử lý…" : "Xác nhận"}
              <Check size={17} />
            </button>
          </form>
        </Modal>
      )}
      {data && orderId && data.orders.find((o) => o.id === orderId) && (
        <AdminOrderDialog
          order={data.orders.find((o) => o.id === orderId)!}
          data={data}
          close={() => setOrderId(null)}
          saved={afterSave}
          onTicket={(id) => {
            setOrderId(null);
            setTicketId(id);
          }}
        />
      )}
      {data && ticketId && data.tickets.find((t) => t.id === ticketId) && (
        <TicketDialog
          key={ticketId}
          ticket={data.tickets.find((t) => t.id === ticketId)!}
          data={data}
          close={() => setTicketId(null)}
          saved={afterSave}
          onOrder={(id) => {
            setTicketId(null);
            setOrderId(id);
          }}
        />
      )}
    </div>
  );
}
function ProductEditor({
  value,
  close,
  saved,
  importKeys,
}: {
  value: Partial<Product>;
  close: () => void;
  saved: () => Promise<void>;
  importKeys: (v: Variant) => void;
}) {
  const { notify } = useStore();
  const [product, setProduct] = useState({ ...blankProduct, ...value }),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [variant, setVariant] = useState<Partial<Variant> | null>(null);
  async function saveProduct(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      const p = await post<Product>("/admin/products", {
        ...(product.id ? { id: product.id } : {}),
        slug: f.get("slug"),
        name: f.get("name"),
        category: f.get("category"),
        platform: f.get("platform"),
        subcategory: f.get("subcategory"),
        subtitle: f.get("subtitle"),
        description: f.get("description"),
        usage_notes: f.get("usage_notes"),
        image: f.get("image"),
        featured: f.get("featured") === "on",
        active: f.get("active") === "on",
      });
      setProduct({ ...p, variants: product.variants || [] });
      notify("Đã lưu sản phẩm.");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function saveVariant(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      await post(`/admin/products/${product.id}/variants`, {
        ...(variant!.id ? { id: variant!.id } : {}),
        name: f.get("name"),
        price: Number(f.get("price")),
        original_price: Number(f.get("original_price")),
        delivery: f.get("delivery"),
        stock: Number(f.get("stock")),
        region: f.get("region"),
        warranty_days: Number(f.get("warranty_days")),
      });
      const data = await api<Overview>("/admin/overview");
      setProduct(data.products.find((p) => p.id === product.id)!);
      setVariant(null);
      notify("Đã lưu gói sản phẩm.");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={product.id ? "Quản lý sản phẩm" : "Thêm sản phẩm"}
      close={close}
      wide
    >
      <form className="form" onSubmit={saveProduct}>
        <div className="form-grid">
          <label>
            Tên sản phẩm
            <input
              name="name"
              defaultValue={product.name}
              required
              minLength={2}
              maxLength={140}
            />
          </label>
          <label>
            Slug
            <input
              name="slug"
              defaultValue={product.slug}
              pattern="[a-z0-9-]+"
              minLength={2}
              required
            />
          </label>
          <label>
            Danh mục
            <select name="category" defaultValue={product.category}>
              {Object.entries(categories)
                .filter(([k]) => k !== "all")
                .map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Nền tảng
            <input
              name="platform"
              defaultValue={product.platform}
              maxLength={60}
            />
          </label>
        </div>
        <label>
          Phân loại con
          <input
            name="subcategory"
            defaultValue={product.subcategory}
            maxLength={60}
            placeholder="Ví dụ: Hành động & nhập vai, Proxy dân cư…"
          />
        </label>
        <label>
          Mô tả ngắn
          <input
            name="subtitle"
            defaultValue={product.subtitle}
            maxLength={200}
          />
        </label>
        <ImageUpload
          initial={product.image}
          label="Ảnh sản phẩm"
          onBusy={setUploading}
        />
        <label>
          Mô tả chi tiết
          <textarea
            name="description"
            defaultValue={product.description}
            rows={3}
            maxLength={5000}
          />
        </label>
        <label>
          Hướng dẫn sử dụng / lưu ý (không bắt buộc)
          <textarea name="usage_notes" defaultValue={product.usage_notes || ''} rows={6} maxLength={10000}
            placeholder={'Ví dụ:\n1. Đăng nhập đúng khu vực tài khoản.\n2. Mở trang kích hoạt và nhập mã.\nLưu ý: Chỉ dùng cho tài khoản đáp ứng điều kiện của gói.'} />
          <small className="muted">Hiển thị công khai trên trang sản phẩm. Không nhập key hoặc mật khẩu khách hàng.</small>
        </label>
        <div className="button-row">
          <label className="checkbox">
            <input
              type="checkbox"
              name="active"
              defaultChecked={product.active}
            />
            Đang bán
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              name="featured"
              defaultChecked={product.featured}
            />
            Nổi bật
          </label>
        </div>
        <button className="button button-small" disabled={busy || uploading}>
          Lưu sản phẩm <Check size={16} />
        </button>
      </form>
      <hr />
      {product.id ? (
        <>
          <div className="section-title">
            <h3>Gói sản phẩm & tồn kho</h3>
            <button
              className="button button-outline button-small"
              onClick={() => setVariant(blankVariant)}
            >
              <Plus size={16} />
              Thêm gói
            </button>
          </div>
          {product.variants?.map((v) => (
            <div className="admin-variant" key={v.id}>
              <span>
                <strong>{v.name}</strong>
                <small>
                  {money(v.price)} ·{" "}
                  {v.delivery === "key" ? "Kho mã" : "Dịch vụ"} · Tồn {v.stock}
                  {" · "}
                  {v.warranty_days
                    ? `Bảo hành ${v.warranty_days} ngày`
                    : "Không bảo hành theo ngày"}
                </small>
              </span>
              <button
                className="icon-button"
                aria-label="Sửa gói"
                onClick={() => setVariant(v)}
              >
                <Pencil size={16} />
              </button>
              {v.delivery === "key" && (
                <button
                  className="button button-outline button-small"
                  onClick={() => importKeys(v)}
                >
                  <Upload size={15} />
                  Nhập mã
                </button>
              )}
            </div>
          ))}
          {variant && (
            <form
              className="form variant-form"
              onSubmit={saveVariant}
              key={variant.id || "new"}
            >
              <h3>{variant.id ? "Chỉnh sửa gói" : "Gói mới"}</h3>
              <label>
                Bảo hành (ngày)
                <input
                  name="warranty_days"
                  type="number"
                  min={0}
                  max={3650}
                  step={1}
                  defaultValue={variant.warranty_days ?? 30}
                  required
                />
                <small>
                  Tính từ ngày giao sản phẩm. 0 = không áp dụng. Thay đổi chỉ áp
                  dụng cho đơn mới.
                </small>
              </label>
              <label>
                Tên gói
                <input
                  name="name"
                  defaultValue={variant.name}
                  required
                  minLength={2}
                  maxLength={140}
                />
              </label>
              <div className="form-grid">
                <label>
                  Giá bán (VND)
                  <input
                    name="price"
                    type="number"
                    defaultValue={variant.price}
                    min={1000}
                    max={100000000}
                    required
                  />
                </label>
                <label>
                  Giá gốc (VND)
                  <input
                    name="original_price"
                    type="number"
                    defaultValue={variant.original_price}
                    min={1000}
                    max={100000000}
                    required
                  />
                </label>
                <label>
                  Cách giao
                  <select name="delivery" defaultValue={variant.delivery}>
                    <option value="key">Giao mã tự động</option>
                    <option value="manual">Giao dịch vụ thủ công</option>
                  </select>
                </label>
                <label>
                  Khu vực
                  <input
                    name="region"
                    defaultValue={variant.region}
                    maxLength={60}
                    required
                  />
                </label>
                <label>
                  Số lượng dịch vụ có thể bán
                  <input
                    name="stock"
                    type="number"
                    defaultValue={variant.stock}
                    min={0}
                    max={100000}
                    required
                  />
                  <small>Gói giao mã: tồn kho chỉ tăng khi nhập mã.</small>
                </label>
              </div>
              <div className="button-row">
                <button
                  className="button button-small"
                  disabled={busy || uploading}
                >
                  Lưu gói
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setVariant(null)}
                >
                  Hủy
                </button>
              </div>
            </form>
          )}
        </>
      ) : (
        <p className="muted">Lưu sản phẩm trước khi thêm gói và nhập mã.</p>
      )}
      <hr />
      <button
        className="button button-dark full"
        disabled={busy}
        onClick={saved}
      >
        Hoàn tất quản lý
      </button>
    </Modal>
  );
}
