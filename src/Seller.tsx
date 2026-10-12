import { useEffect, useState } from "react";
import { useDataRefresh } from './useDataRefresh';
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  Package,
  Plus,
  Wallet,
  Store,
  ExternalLink,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";
import { api, post, money, date } from "./api";
import { Loading, Modal, useStore } from "./App";
import { ProductEditor } from "./Admin";
import type { Product, User, OrderItem } from "./types";
import { SELLER_TERMS_VERSION, sellerTerms } from "../shared/seller-terms.js";
import "./seller.css";

type Withdrawal = {
  id: string;
  user_id: string;
  amount: number;
  bank: string;
  account_number: string;
  account_name: string;
  status: string;
  reason: string;
  reference: string;
  created_at: string;
};
type Sale = OrderItem & {
  seller_gross?: number;
  seller_fee?: number;
  seller_net?: number;
  seller_reversed_at?: string;
  order: {
    number: string;
    status: string;
    created_at: string;
    customer_note: string;
  };
};
type SellerData = {
  profile: User;
  products: Product[];
  sales: Sale[];
  withdrawals: Withdrawal[];
  fee_bps: number;
};
const withdrawalStatus: Record<string, string> = {
  pending: "Chờ duyệt",
  paid: "Đã chuyển tiền",
  rejected: "Từ chối",
  cancelled: "Đã hủy để đối soát",
};
export function SellerContact({
  seller,
}: {
  seller: NonNullable<Product["seller"]>;
}) {
  return (
    <div className="seller-contact">
      <span className="seller-avatar">
        <Store size={22} />
      </span>
      <div>
        <small>Người bán</small>
        <strong>{seller.name}</strong>
      </div>
    </div>
  );
}
function ProfileForm({
  profile,
  fee,
  saved,
}: {
  profile: User;
  fee: number;
  saved: () => Promise<void>;
}) {
  const { setUser } = useStore();
  const [shopName, setShopName] = useState(profile.seller_name || profile.name);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const user = await post<User>("/seller/profile", {
        name: f.get("name"),
        accepted: f.get("accepted") === "on",
        terms_version: SELLER_TERMS_VERSION,
        fee_bps: fee,
      });
      setUser(user);
      await saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form panel seller-profile" onSubmit={submit}>
      <div className="seller-profile-heading">
        <span className="seller-profile-icon">
          <Store size={27} />
        </span>
        <div>
          <span className="eyebrow orange">HỒ SƠ NGƯỜI BÁN</span>
          <h2>Thiết lập gian hàng của bạn</h2>
          <p className="muted">
            Hoàn thiện thông tin và xem điều khoản trước khi bắt đầu bán hàng
            trên KEYNEST.
          </p>
        </div>
      </div>
      <div className="seller-setup-layout">
        <div className="seller-setup-main">
          <section className="seller-setup-section">
            <h3>
              <span>01</span> Thông tin gian hàng
            </h3>
            <label>
              Tên người bán / gian hàng
              <input
                name="name"
                required
                minLength={2}
                maxLength={80}
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
              />
            </label>
            <small>Tên này xuất hiện trên các sản phẩm bạn đăng bán.</small>
          </section>
          <section className="seller-setup-section">
            <h3>
              <span>02</span> Quyền lợi & trách nhiệm
            </h3>
            <div className="seller-terms">
              <h3>Điều khoản người bán</h3>
              <p>
                Phí hiện tại: <strong>{fee / 100}%</strong> trên giá trị sản
                phẩm sau giảm giá. Ví dụ bán 100.000đ, phí {money(fee * 10)},
                nhận {money(100000 - fee * 10)}.
              </p>
              {sellerTerms.map(([title, body]) => (
                <section key={title}>
                  <h4>{title}</h4>
                  <p>{body}</p>
                </section>
              ))}
            </div>
          </section>
        </div>
        <aside className="seller-setup-aside">
          <span className="eyebrow orange">HỒ SƠ HIỂN THỊ</span>
          <div className="seller-shop-preview">
            <Store size={28} />
            <strong>{shopName.trim() || "Tên gian hàng của bạn"}</strong>
            <span>Người bán trên KEYNEST</span>
          </div>
          <div className="seller-fee-preview">
            <span>Phí nền tảng</span>
            <strong>
              {fee / 100}
              <small>%</small>
            </strong>
            <p>Áp dụng trên giá trị sản phẩm sau giảm giá.</p>
            <dl>
              <div>
                <dt>Ví dụ bán</dt>
                <dd>{money(100000)}</dd>
              </div>
              <div>
                <dt>Phí website</dt>
                <dd>−{money(fee * 10)}</dd>
              </div>
              <div>
                <dt>Bạn nhận</dt>
                <dd>{money(100000 - fee * 10)}</dd>
              </div>
            </dl>
          </div>
          <p className="seller-setup-tip">
            <ShieldCheck size={18} />
            Bạn chịu trách nhiệm về chất lượng, giao hàng và bảo hành sản phẩm
            của mình.
          </p>
        </aside>
      </div>
      <div className="seller-setup-footer">
        <label className="checkbox">
          <input type="checkbox" name="accepted" required />
          Tôi đã đọc và đồng ý với điều khoản người bán.
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button" disabled={busy}>
          {busy ? "Đang lưu…" : "Đồng ý và lưu hồ sơ"}
          <ArrowRight size={16} />
        </button>
      </div>
    </form>
  );
}
export function Seller({ onboarding = false }: { onboarding?: boolean }) {
  const { user, refresh, notify } = useStore();
  const [data, setData] = useState<SellerData | null>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState("products");
  const [editing, setEditing] = useState<Partial<Product> | null>(null),
    [action, setAction] = useState<{ endpoint: string; title: string } | null>(
      null,
    ),
    [busy, setBusy] = useState(false);
  const [idempotency, setIdempotency] = useState(() => crypto.randomUUID());
  const load = async () => {
    try {
      setData(await api<SellerData>("/seller/overview"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const saved = async () => {
    await load();
    await refresh();
  };
  useDataRefresh(load, ['/seller/', '/admin/']);
  useEffect(() => {
    if (user?.role === "seller") void load();
  }, [user?.id, user?.role]);
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
  async function submitAction(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await post(action!.endpoint, {
        secrets: String(f.get("secrets"))
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setAction(null);
      await saved();
      notify("Đã cập nhật.");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function withdraw(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    try {
      await post("/seller/withdrawals", {
        amount: Number(f.get("amount")),
        bank: f.get("bank"),
        account_number: f.get("account_number"),
        account_name: f.get("account_name"),
        idempotency,
      });
      setIdempotency(crypto.randomUUID());
      form.reset();
      await saved();
      notify("Đã gửi yêu cầu. Số tiền được giữ trong lúc admin duyệt.");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  if (onboarding)
    return (
      <div className="container page seller-page seller-onboarding">
        <ProfileForm profile={data.profile} fee={data.fee_bps} saved={saved} />
      </div>
    );
  return (
    <div className="container page seller-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow orange">KEYNEST / SELLER</span>
          <h1>Gian hàng của bạn.</h1>
          <p>Quản lý sản phẩm, giao hàng và doanh thu tại một nơi.</p>
        </div>
        <button className="button button-outline" onClick={load}>
          Làm mới
        </button>
      </header>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="seller-stats">
        <div>
          <Package />
          <small>Sản phẩm</small>
          <strong>{data.products.length}</strong>
        </div>
        <div>
          <Wallet />
          <small>Số dư khả dụng</small>
          <strong>{money(data.profile.balance)}</strong>
        </div>
        <div>
          <Wallet />
          <small>Đang chờ rút</small>
          <strong>
            {money(
              data.withdrawals
                .filter((w) => w.status === "pending")
                .reduce((n, w) => n + w.amount, 0),
            )}
          </strong>
        </div>
        <div>
          <Store />
          <small>Phí nền tảng</small>
          <strong>{data.fee_bps / 100}%</strong>
        </div>
      </div>
      {!!data.profile.seller_debt && (
        <p className="form-error">
          Cần bù trừ {money(data.profile.seller_debt)} từ đơn hoàn tiền. Doanh
          thu mới sẽ bù trừ khoản này trước khi cộng ví; tạm thời chưa thể rút
          tiền.
        </p>
      )}
      <nav className="seller-tabs" aria-label="Kênh người bán">
        {[
          ["products", "Sản phẩm & kho"],
          ["sales", "Đơn bán"],
          ["withdrawals", "Rút tiền"],
          ["profile", "Hồ sơ & điều khoản"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? "selected" : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "profile" && (
        <ProfileForm profile={data.profile} fee={data.fee_bps} saved={saved} />
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
            {data.products.map((p) => (
              <article key={p.id}>
                <img src={p.image} alt="" />
                <div>
                  <Link to={`/products/${p.slug}`}>
                    <strong>{p.name}</strong>
                  </Link>
                  <p>
                    {p.active ? "Đang bán" : "Đã ẩn"} · {p.variants.length} gói
                    · {p.variants.reduce((n, v) => n + v.stock, 0)} tồn kho
                  </p>
                </div>
                <button
                  className="button button-outline"
                  onClick={() => setEditing(p)}
                >
                  Quản lý
                </button>
              </article>
            ))}
          </div>
          {!data.products.length && (
            <div className="panel seller-empty">
              <Package size={36} />
              <h3>Bắt đầu với sản phẩm đầu tiên</h3>
              <p>Thêm mô tả, ảnh, gói bán và kho mã để khách hàng đặt mua.</p>
            </div>
          )}
        </section>
      )}
      {tab === "sales" && (
        <section>
          <h2>Đơn bán & giao hàng</h2>
          <p className="muted">
            Doanh thu được ghi nhận khi thanh toán thành công. Phí áp dụng theo
            thời điểm đặt hàng.
          </p>
          <div className="panel table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Đơn / sản phẩm</th>
                  <th>Thanh toán</th>
                  <th>Phí / thực nhận</th>
                  <th>Giao hàng</th>
                </tr>
              </thead>
              <tbody>
                {data.sales.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.order.number}</strong>
                      <p>
                        {s.name} · {s.variant_name} ×{s.quantity}
                      </p>
                      <small>{date(s.order.created_at)}</small>
                    </td>
                    <td>
                      {s.order.status === "refunded"
                        ? "Đã hoàn tiền"
                        : s.seller_net != null
                          ? "Đã thanh toán"
                          : "Chưa thanh toán"}
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
                      {s.delivered_at ? (
                        "Đã giao"
                      ) : s.delivery === "manual" &&
                        s.order.status === "processing" ? (
                        <>
                          <p>{s.order.customer_note}</p>
                          <button
                            className="button button-small"
                            onClick={() =>
                              setAction({
                                endpoint: `/seller/items/${s.id}/fulfill`,
                                title: `Giao ${s.quantity} kết quả · ${s.name}`,
                              })
                            }
                          >
                            Giao sản phẩm
                          </button>
                        </>
                      ) : (
                        "Chờ xử lý"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.sales.length && (
              <p className="seller-empty">Chưa có đơn bán.</p>
            )}
          </div>
        </section>
      )}
      {tab === "withdrawals" && (
        <div className="seller-withdraw-layout">
          <form className="panel form" onSubmit={withdraw}>
            <h2>Yêu cầu rút tiền</h2>
            <p className="muted">
              Tối thiểu 50.000đ. Tiền được giữ ngay khi gửi; admin chuyển khoản
              và cập nhật kết quả. Yêu cầu bị từ chối sẽ được trả lại ví.
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
              <input name="bank" minLength={2} maxLength={100} required />
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
              Gửi yêu cầu rút
            </button>
          </form>
          <section>
            <h2>Lịch sử rút tiền</h2>
            <WithdrawalList withdrawals={data.withdrawals} />
          </section>
        </div>
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
            setAction({
              endpoint: `/seller/inventory/${v.id}`,
              title: `Nhập mã · ${v.name}`,
            })
          }
        />
      )}
      {action && (
        <Modal
          title={action.title}
          close={() => {
            if (!busy) setAction(null);
          }}
        >
          <form className="form" onSubmit={submitAction}>
            <label>
              Mỗi dòng một mã hoặc kết quả giao hàng
              <textarea name="secrets" rows={8} required />
            </label>
            <button className="button" disabled={busy}>
              Xác nhận
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
function WithdrawalList({
  withdrawals,
  review,
}: {
  withdrawals: Withdrawal[];
  review?: (w: Withdrawal) => void;
}) {
  return (
    <div className="seller-withdraw-list">
      {!withdrawals.length && (
        <p className="muted">Chưa có yêu cầu rút tiền.</p>
      )}
      {withdrawals.map((w) => (
        <article className="panel" key={w.id}>
          <div className="section-title">
            <strong>{money(w.amount)}</strong>
            <span>{withdrawalStatus[w.status] || w.status}</span>
          </div>
          <p>
            {w.bank} · {w.account_number} · {w.account_name}
          </p>
          <small>
            {date(w.created_at)} · {w.id.slice(0, 8)}
          </small>
          {w.reason && <p>{w.reason}</p>}
          {w.reference && <p>Mã chuyển khoản: {w.reference}</p>}
          {review && w.status === "pending" && (
            <button className="button button-outline" onClick={() => review(w)}>
              Xử lý yêu cầu
            </button>
          )}
        </article>
      ))}
    </div>
  );
}
export function AdminSellers() {
  const { notify } = useStore();
  const [data, setData] = useState<{
      sellers: User[];
      withdrawals: Withdrawal[];
      fee_bps: number;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState<Withdrawal | null>(null);
  const load = async () => {
    try {
      setData(await api("/admin/sellers"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useDataRefresh(load, ['/admin/', '/seller/']);
  async function fee(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await post("/admin/sellers/fee", {
        fee_bps: Math.round(Number(f.get("fee")) * 100),
      });
      await load();
      notify("Đã cập nhật phí cho đơn mới.");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function resolve(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await post(`/admin/sellers/withdrawals/${review!.id}`, {
        status: f.get("status"),
        reason: f.get("reason"),
        reference: f.get("reference"),
      });
      setReview(null);
      await load();
      notify("Đã xử lý yêu cầu.");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="seller-page">
      <h2>Người bán & rút tiền</h2>
      <p className="muted">Cấp hoặc thu hồi quyền seller tại mục Khách hàng.</p>
      {error && (
        <p role="alert">
          {error}
          <button onClick={load}>Thử lại</button>
        </p>
      )}
      {!data ? (
        !error && <Loading />
      ) : (
        <>
          <form className="panel form" onSubmit={fee}>
            <label>
              Phí nền tảng (%)
              <input
                name="fee"
                type="number"
                min={0}
                max={100}
                step={0.01}
                defaultValue={data.fee_bps / 100}
                required
              />
            </label>
            <small className="muted">
              Chỉ áp dụng cho đơn mới, không thay đổi phí đã lưu trên đơn cũ.
            </small>
            <button className="button" disabled={busy}>
              Lưu mức phí
            </button>
          </form>
          <div className="panel table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Người bán</th>
                  <th>Ví / cần bù trừ</th>
                  <th>Điều khoản</th>
                </tr>
              </thead>
              <tbody>
                {data.sellers.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {s.seller_name || s.name}
                      <p>{s.email}</p>
                    </td>

                    <td>
                      {money(s.balance)}
                      <p>{money(s.seller_debt || 0)}</p>
                    </td>
                    <td>
                      {s.seller_terms_accepted_at
                        ? date(s.seller_terms_accepted_at)
                        : "Chưa đồng ý"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Yêu cầu rút tiền</h3>
          <WithdrawalList withdrawals={data.withdrawals} review={setReview} />
        </>
      )}
      {review && (
        <Modal
          title="Xử lý rút tiền"
          close={() => {
            if (!busy) setReview(null);
          }}
        >
          <form className="form" onSubmit={resolve}>
            <strong>
              {money(review.amount)} · {review.account_name}
            </strong>
            <p>
              {review.bank} · {review.account_number}
            </p>
            <p>
              Chỉ xác nhận đã chuyển sau khi chuyển khoản thực tế thành công.
              Nút này ghi nhận kết quả, không tự chuyển tiền ngân hàng.
            </p>
            <label>
              Kết quả
              <select name="status">
                <option value="paid">Đã chuyển tiền</option>
                <option value="rejected">Từ chối và trả lại ví</option>
              </select>
            </label>
            <label>
              Mã giao dịch chuyển khoản
              <input name="reference" maxLength={200} />
            </label>
            <label>
              Ghi chú / lý do
              <textarea name="reason" required minLength={3} maxLength={1000} />
            </label>
            <button className="button" disabled={busy}>
              Xác nhận xử lý
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
