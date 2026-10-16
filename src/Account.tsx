import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Headphones,
  LayoutDashboard,
  LogOut,
  Mail,
  Package,
  ShieldCheck,
  UserRound,
  Wallet,
} from "lucide-react";
import { Badge, useStore } from "./App";
import { api, date, money, post } from "./api";
import type { Ledger, Order, User } from "./types";
import { ChangePassword } from "./ChangePassword";
import { Avatar } from "./Avatar";
import { AvatarUpload } from "./AvatarUpload";
import { TwoFactor } from "./TwoFactor";
import { Recaptcha } from './Recaptcha';
import { NotificationInbox, SessionManager } from "./AccountOperations";

type AccountData = { orders: Order[]; balance: number; ledger: Ledger[] };
export function AccountPage({ logout }: { logout: () => void }) {
  const { user, setUser, mode, notify } = useStore();
  const [passwordLocked, setPasswordLocked] = useState(true);
  const [captcha, setCaptcha] = useState<{ enabled: boolean; site_key: string | null } | null>(null);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaVersion, setCaptchaVersion] = useState(0);
  const [captchaError, setCaptchaError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api<{ captcha: { enabled: boolean; site_key: string | null } }>('/config', { signal: controller.signal })
      .then(data => setCaptcha(data.captcha))
      .catch(error => { if (!controller.signal.aborted) setCaptchaError(error.message); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    api<{ locked: boolean }>("/me/password-policy", {
      signal: controller.signal,
    })
      .then((result) => setPasswordLocked(result.locked))
      .catch(() => {});
    return () => controller.abort();
  }, [user?.id]);
  const [params, setParams] = useSearchParams();
  const section = ["profile", "security"].includes(params.get("section") || "")
    ? params.get("section")!
    : "overview";
  const [name, setName] = useState(user!.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [recovery, setRecovery] = useState("");
  const [data, setData] = useState<AccountData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoadError("");
    setData(null);
    Promise.all([
      api<Order[]>("/orders", { signal: controller.signal }),
      api<{ balance: number; ledger: Ledger[] }>("/wallet", {
        signal: controller.signal,
      }),
    ])
      .then(([orders, wallet]) => setData({ orders, ...wallet }))
      .catch((e) => {
        if (!controller.signal.aborted) setLoadError(e.message);
      });
    return () => controller.abort();
  }, [user!.id, attempt]);
  useEffect(() => {
    setName(user!.name);
  }, [user!.name]);
  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const updated = await api<User>("/me", {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim() }),
      });
      setUser(updated);
      setName(updated.name);
      setSaved(true);
      notify("Đã cập nhật thông tin.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function sendRecovery() {
    if (busy || passwordLocked || !captcha || (captcha.enabled && !captchaToken)) return;
    setBusy(true);
    setError("");
    setRecovery("");
    try {
      setRecovery(
        (
          await post<{ message: string }>("/auth/forgot", {
            email: user!.email,
          }, captchaToken ? { 'X-Captcha-Token': captchaToken } : {})
        ).message,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setCaptchaToken('');
      setCaptchaVersion(n => n + 1);
    }
  }
  const pending = data?.orders.filter(
    (o) => o.status === "pending" || o.status === "processing",
  ).length;
  const recent = data?.orders
    .slice()
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 3);
  return (
    <div className="container member-page">
      <div className="member-breadcrumb">
        <Link to="/">Cửa hàng</Link>
        <ChevronRight size={13} />
        <span>Tài khoản</span>
      </div>
      <div className="member-layout">
        <aside className="member-sidebar">
          <div className="member-identity">
            <Avatar
              className="member-avatar"
              name={user!.name}
              url={user!.avatar_url}
            />
            <h2>{user!.name}</h2>
            <p title={user!.email}>{user!.email}</p>
            <span className="member-role">
              {user!.role === "admin" ? "Quản trị viên" : user!.role === 'seller' ? 'Người bán KEYNEST' : "Thành viên KEYNEST"}
            </span>
          </div>
          <nav aria-label="Quản lý tài khoản">
            <span className="member-nav-label">TÀI KHOẢN CỦA TÔI</span>
            {(
              [
                ["overview", LayoutDashboard, "Tổng quan"],
                ["profile", UserRound, "Thông tin cá nhân"],
                ["security", ShieldCheck, "Đăng nhập & bảo mật"],
              ] as const
            ).map(([id, Icon, label]) => (
              <button
                key={id}
                aria-current={section === id ? "page" : undefined}
                onClick={() => {
                  setParams(id === "overview" ? {} : { section: id });
                  setError("");
                  setSaved(false);
                }}
              >
                <Icon size={18} />
                {label}
                <ChevronRight size={14} />
              </button>
            ))}
            <span className="member-nav-label">MUA SẮM</span>
            <Link to="/orders">
              <Package size={18} />
              Đơn hàng của tôi
              <ChevronRight size={14} />
            </Link>
            <Link to="/wallet">
              <Wallet size={18} />
              Ví & giao dịch
              <ChevronRight size={14} />
            </Link>
            <Link to="/support">
              <Headphones size={18} />
              Trung tâm hỗ trợ
              <ChevronRight size={14} />
            </Link>
            {user!.role === 'seller' && <Link to="/seller"><LayoutDashboard size={18}/>Kênh người bán<ChevronRight size={14}/></Link>}
            {user!.role === 'admin' && <Link to="/admin" className="member-admin-desktop">
              <LayoutDashboard size={18} /> Quản trị cửa hàng <ChevronRight size={14} />
            </Link>}
          </nav>
          <button className="member-logout" onClick={logout}>
            <LogOut size={17} />
            Đăng xuất
          </button>
        </aside>
        <section className="member-content">
          <header className="member-heading">
            <div>
              <span className="auth-kicker">MY KEYNEST</span>
              <h1>
                {section === "profile"
                  ? "Thông tin cá nhân"
                  : section === "security"
                    ? "Đăng nhập & bảo mật"
                    : `Chào ${user!.name.trim().split(/\s+/).at(-1)},`}
              </h1>
              <p>
                {section === "profile"
                  ? "Quản lý thông tin hiển thị trong tài khoản của bạn."
                  : section === "security"
                    ? "Thông tin đăng nhập và cách khôi phục tài khoản."
                    : "Mọi đơn hàng và giao dịch của bạn, ở cùng một nơi."}
              </p>
            </div>
            {section === "overview" && (
              <Link className="button button-outline" to="/catalog">
                Tiếp tục khám phá
                <ArrowUpRight size={16} />
              </Link>
            )}
          </header>
          {section === "overview" && (
            <>
              <NotificationInbox />
              <div className="member-stats">
                <section className="member-balance">
                  <div>
                    <Wallet size={18} />
                    <span>Số dư khả dụng</span>
                  </div>
                  <strong>{money(data?.balance ?? user!.balance)}</strong>
                  <Link to="/wallet">
                    Nạp tiền vào ví
                    <ArrowRight size={16} />
                  </Link>
                </section>
                <section>
                  <div>
                    <Package size={18} />
                    <span>Tổng đơn hàng</span>
                  </div>
                  <strong>{data ? data.orders.length : "—"}</strong>
                  <Link to="/orders">
                    Xem lịch sử mua hàng
                    <ArrowRight size={16} />
                  </Link>
                </section>
                <section>
                  <div>
                    <LayoutDashboard size={18} />
                    <span>Đơn cần theo dõi</span>
                  </div>
                  <strong>{pending === undefined ? "—" : pending}</strong>
                  <span className="member-stat-note">
                    Chờ thanh toán hoặc đang xử lý
                  </span>
                </section>
              </div>
              {loadError ? (
                <div className="member-load-error" role="alert">
                  <p>{loadError}</p>
                  <button
                    className="button button-outline"
                    onClick={() => setAttempt((v) => v + 1)}
                  >
                    Thử tải lại
                  </button>
                </div>
              ) : !data ? (
                <div className="member-skeleton" role="status">
                  Đang tải hoạt động tài khoản…
                </div>
              ) : (
                <>
                  <section className="member-panel">
                    <div className="member-panel-heading">
                      <h2>Đơn hàng gần đây</h2>
                      <Link to="/orders">
                        Xem tất cả
                        <ArrowRight size={15} />
                      </Link>
                    </div>
                    {recent!.length ? (
                      <div className="member-orders">
                        {recent!.map((order) => (
                          <Link
                            className="member-order"
                            to={`/orders/${order.id}`}
                            key={order.id}
                          >
                            <span className="member-order-icon member-order-cover">
                              {order.items[0]?.product_image ? (
                                <img
                                  src={order.items[0].product_image}
                                  alt={order.items[0].name}
                                  loading="lazy"
                                />
                              ) : <Package size={22} />}
                            </span>
                            <div>
                              <strong>
                                {order.items[0]?.name || order.number}
                                {order.items.length > 1 &&
                                  ` +${order.items.length - 1}`}
                              </strong>
                              <small>
                                #{order.number} · {date(order.created_at)}
                              </small>
                            </div>
                            <Badge status={order.status} />
                            <b>{money(order.total)}</b>
                            <ChevronRight
                              className="member-order-arrow"
                              size={17}
                            />
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <div className="member-empty">
                        <Package size={30} />
                        <h3>Đơn hàng đầu tiên đang chờ bạn</h3>
                        <p>
                          Game key, gift card và dịch vụ đã mua sẽ xuất hiện tại
                          đây.
                        </p>
                        <Link className="button button-outline" to="/catalog">
                          Khám phá cửa hàng
                          <ArrowRight size={16} />
                        </Link>
                      </div>
                    )}
                  </section>
                  <div className="member-bottom-grid">
                    <section className="member-panel">
                      <div className="member-panel-heading">
                        <h2>Hoạt động ví</h2>
                        <Link to="/wallet">
                          Chi tiết
                          <ArrowRight size={15} />
                        </Link>
                      </div>
                      {data.ledger.length ? (
                        <div className="member-transactions">
                          {data.ledger
                            .slice()
                            .sort(
                              (a, b) =>
                                Date.parse(b.created_at) -
                                Date.parse(a.created_at),
                            )
                            .slice(0, 3)
                            .map((entry) => (
                              <div key={entry.id}>
                                <span
                                  className={entry.amount > 0 ? "incoming" : ""}
                                >
                                  {entry.amount > 0 ? (
                                    <ArrowDownLeft size={18} />
                                  ) : (
                                    <ArrowUpRight size={18} />
                                  )}
                                </span>
                                <div>
                                  <strong>{entry.description}</strong>
                                  <small>{date(entry.created_at)}</small>
                                </div>
                                <b
                                  className={entry.amount > 0 ? "incoming" : ""}
                                >
                                  {entry.amount > 0 ? "+" : ""}
                                  {money(entry.amount)}
                                </b>
                              </div>
                            ))}
                        </div>
                      ) : (
                        <div className="member-quiet-empty">
                          <Wallet size={24} />
                          <p>Chưa có giao dịch ví.</p>
                          <Link to="/wallet">
                            Nạp tiền để mua hàng nhanh hơn
                            <ArrowRight size={14} />
                          </Link>
                        </div>
                      )}
                    </section>
                    <div className="member-help-column">
                    {user!.role === 'seller' && <Link to="/seller" className="button button-outline"><LayoutDashboard size={17}/>Kênh người bán<ArrowUpRight size={16}/></Link>}
                    {user!.role === 'admin' && <Link to="/admin" className="button button-outline member-admin-link">
                      <LayoutDashboard size={17} /> Quản trị cửa hàng <ArrowUpRight size={16} />
                    </Link>}
                    <section className="member-help">
                      <Headphones size={26} />
                      <h2>Cần hỗ trợ đơn hàng?</h2>
                      <p>
                        Gửi yêu cầu để được hỗ trợ về key, thanh toán hoặc dịch
                        vụ đã mua.
                      </p>
                      <Link to="/support">
                        Liên hệ hỗ trợ
                        <ArrowUpRight size={16} />
                      </Link>
                      <span>Lịch sử trao đổi được lưu trong tài khoản.</span>
                    </section>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
          {section === "profile" && (
            <section className="member-panel member-profile">
              <div className="member-panel-heading">
                <h2>Hồ sơ của bạn</h2>
                <UserRound size={19} />
              </div>
              <div className="member-profile-intro">
                <Avatar
                  className="member-avatar"
                  name={user!.name}
                  url={user!.avatar_url}
                />
                <div>
                  <strong>{user!.name}</strong>
                  <p>Tên này xuất hiện trên tài khoản và đánh giá sản phẩm.</p>
                </div>
              </div>
              <form onSubmit={update} className="member-form">
                <AvatarUpload />
                <div>
                  <label htmlFor="member-name">Họ tên</label>
                  <input
                    id="member-name"
                    name="name"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setSaved(false);
                    }}
                    minLength={2}
                    maxLength={80}
                    required
                    autoComplete="name"
                    disabled={busy}
                  />
                </div>
                <div>
                  <label htmlFor="member-email">
                    Email đăng nhập <span>Cố định</span>
                  </label>
                  <input
                    id="member-email"
                    type="email"
                    value={user!.email}
                    readOnly
                    aria-describedby="email-note"
                  />
                  <p id="email-note">
                    Email dùng để đăng nhập và nhận liên kết khôi phục mật khẩu.
                  </p>
                </div>
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="member-form-actions">
                  <span role="status">
                    {saved ? (
                      <>
                        <Check size={16} />
                        Đã lưu thay đổi
                      </>
                    ) : (
                      "Bạn có thể cập nhật tên hiển thị bất cứ lúc nào."
                    )}
                  </span>
                  <button
                    className="button"
                    disabled={busy || name.trim() === user!.name}
                  >
                    {busy ? "Đang lưu…" : "Lưu thay đổi"}
                    <Check size={16} />
                  </button>
                </div>
              </form>
            </section>
          )}
          {section === "security" && (
            <section className="member-panel member-security">
              <div className="member-panel-heading">
                <h2>Phương thức đăng nhập</h2>
                <ShieldCheck size={20} />
              </div>
              <div className="member-security-row">
                <span className="member-security-icon">
                  <Mail size={22} />
                </span>
                <div>
                  <h3>Email & mật khẩu</h3>
                  <p>{user!.email}</p>
                  <small>Sử dụng email này để đăng nhập vào KEYNEST.</small>
                </div>
              </div>
              <div className="member-security-row">
                <span className="member-security-icon">
                  <ShieldCheck size={22} />
                </span>
                <div>
                  <h3>Khôi phục qua email</h3>
                  <p>
                    {passwordLocked
                      ? "Phiên đăng nhập Google/Discord không sử dụng chức năng này. Hãy khôi phục mật khẩu tại nhà cung cấp đăng nhập."
                      : mode === "demo"
                        ? "Bản demo chưa gửi email khôi phục. Tính năng này hoạt động khi cửa hàng kết nối Supabase."
                        : "Nhận liên kết qua email để thiết lập mật khẩu mới cho tài khoản."}
                  </p>
                  {!passwordLocked && mode !== 'demo' && !recovery && <>
                    {captchaError && <p className="form-error" role="alert">{captchaError}</p>}
                    {captcha?.enabled && captcha.site_key && <Recaptcha key={captchaVersion} siteKey={captcha.site_key} onToken={setCaptchaToken} />}
                  </>}
                  <button
                    className="button button-outline"
                    onClick={sendRecovery}
                    disabled={
                      passwordLocked || busy || mode === "demo" || !!recovery || !captcha || (captcha.enabled && !captchaToken)
                    }
                  >
                    {passwordLocked
                      ? "Không khả dụng"
                      : busy
                        ? "Đang gửi…"
                        : recovery
                          ? "Đã gửi yêu cầu"
                          : "Gửi email đặt lại mật khẩu"}
                    <ArrowRight size={16} />
                  </button>
                  {!passwordLocked && recovery && (
                    <p className="member-success" role="status">
                      {recovery}
                    </p>
                  )}
                  {error && (
                    <p className="form-error" role="alert">
                      {error}
                    </p>
                  )}
                </div>
              </div>
              <ChangePassword locked={passwordLocked} />
              <TwoFactor />
              <SessionManager />
              <div className="member-security-note">
                <ShieldCheck size={19} />
                <p>
                  Không chia sẻ mật khẩu hoặc mã game cho người khác. Đăng xuất
                  khi sử dụng máy tính công cộng.
                </p>
              </div>
            </section>
          )}
        </section>
      </div>
    </div>
  );
}
