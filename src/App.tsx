import { useAccountCart } from "./useAccountCart";
import { TwoFactor } from "./TwoFactor";
import { PasswordChangeAnimation } from './PasswordChangeAnimation';
import { useDataRefresh } from './useDataRefresh';
import { AdminVerification } from "./AdminVerification";
import { PreorderNote } from './PreorderNote';
import { HomeAnnouncements } from "./Announcements";
import { LegalPage, SocialLinks } from "./LegalPages";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { Dispatch, SetStateAction, FormEvent, ReactNode } from "react";
import {
  Link,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  ArrowDownLeft,
  Eye,
  EyeOff,
  LockKeyhole,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Landmark,
  Clock3,
  QrCode,
  Gamepad2,
  Gift,
  Globe2,
  Headphones,
  Menu,
  Minus,
  Package,
  Plus,
  Server,
  ShieldCheck,
  ShoppingBag,
  Ticket as TicketIcon,
  Trash2,
  UserRound,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { api, categories, date, money, post, statuses, updateCategories } from "./api";
import type {
  CartItem,
  Ledger,
  Order,
  Payment,
  Product,
  Ticket,
  User,
  Variant,
} from "./types";
import { Admin } from "./Admin";
import { Seller, SellerContact } from './Seller';
import { SELLER_TERMS_VERSION } from '../shared/seller-terms.js';
import { Home, PromotionsPage, GuidePage } from "./Storefront";
import { HeaderSearch, StoreNavigation } from "./Navigation";
import { Catalog } from "./Catalog";
import { rememberProduct } from "./discovery";
import { AuthModal, OAuthErrorPage } from "./Auth";
import { OAuthWelcome } from './OAuthWelcome';
import { AccountPage } from "./Account";
import { Avatar } from "./Avatar";
import { OrdersPage, OrderDetailPage } from "./Orders";
import { CustomerTicketCard } from "./AdminSupport";
import { ProductFeedback, RatingLine } from "./ProductFeedback";
import { productImages } from "../shared/product-images.js";

type Context = {
  products: Product[];
  user: User | null;
  ready: boolean;
  mode: string;
  cart: CartItem[];
  cartReady: boolean;
  cartError: string;
  retryCart: () => void;
  add: (id: string, quantity?: number) => void;
  setCart: (items: CartItem[]) => void;
  refresh: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
  login: () => void;
  setUser: Dispatch<SetStateAction<User | null>>;
};
const StoreContext = createContext<Context>(null!);
export const useStore = () => useContext(StoreContext);
export function Badge({ status }: { status: string }) {
  return (
    <span className={`badge status-${status}`}>
      {statuses[status] || status}
    </span>
  );
}
export function Empty({
  icon: Icon = ShoppingBag,
  title,
  description,
  children,
}: {
  icon?: typeof ShoppingBag;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Icon size={42} strokeWidth={1.3} />
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading">
      <span />
      Đang tải…
    </div>
  );
}
export function Modal({
  title,
  children,
  close,
  wide = false,
  className = "",
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
  className?: string;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const old = document.activeElement as HTMLElement;
    const el = dialogRef.current;
    const items = () =>
      Array.from(
        el?.querySelectorAll<HTMLElement>(
          "button,input,select,textarea,a[href]",
        ) || [],
      ).filter(
        (e) =>
          !e.matches(":disabled") &&
          e.tabIndex >= 0 &&
          e.getClientRects().length > 0,
      );
    (
      el?.querySelector<HTMLElement>("[data-initial-focus]") || items()[0]
    )?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const a = items();
      if (!el?.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? a.at(-1) : a[0])?.focus();
      } else if (e.shiftKey && document.activeElement === a[0]) {
        e.preventDefault();
        a.at(-1)?.focus();
      } else if (!e.shiftKey && document.activeElement === a.at(-1)) {
        e.preventDefault();
        a[0]?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keydown", trap);
      document.body.style.overflow = previous;
      old?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        ref={dialogRef}
        className={`modal ${wide ? "modal-wide" : ""} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" aria-label="Đóng" onClick={close}>
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export function Art({
  product,
  hero = false,
  poster = false,
}: {
  product: Product;
  hero?: boolean;
  poster?: boolean;
}) {
  if (
    (product.slug === "steam-wallet" || product.slug === "valorant") &&
    product.image === productImages[product.slug]
  ) {
    return (
      <div
        className={`product-visual product-visual-${product.slug} ${poster ? "product-visual-poster" : ""}`}
      >
        <div aria-hidden="true">
          <small>
            {product.slug === "valorant" ? "RIOT GAMES" : "DIGITAL GIFT CARD"}
          </small>
          <strong>{product.slug === "valorant" ? "VALORANT" : "STEAM"}</strong>
          <span>{product.slug === "valorant" ? "POINTS" : "WALLET"}</span>
        </div>
        <img
          className="product-image"
          src={product.image}
          alt={product.name}
          loading={hero ? "eager" : "lazy"}
        />
      </div>
    );
  }
  return product.image ? (
    <img
      className={`${hero ? "hero-image" : "product-image"}${product.image === productImages[product.slug] ? " product-image-complete" : ""}`}
      src={
        poster &&
        product.image === productImages[product.slug] &&
        product.image.endsWith(".svg")
          ? product.image.replace(".svg", "-poster.svg")
          : poster
            ? product.image.replace("/header.jpg", "/library_600x900.jpg")
            : product.image
      }
      onError={(e) => {
        if (e.currentTarget.getAttribute("src") !== product.image)
          e.currentTarget.src = product.image;
      }}
      alt={product.name}
      loading={hero ? "eager" : "lazy"}
    />
  ) : (
    <div className={`cover cover-${product.category} cover-${product.slug}`}>
      <span className="cover-platform">
        {product.platform.toUpperCase()} / DIGITAL
      </span>
      {product.category === "gift" ? (
        <Gift size={hero ? 80 : 50} strokeWidth={1.2} />
      ) : product.category === "mmo" ? (
        <Server size={50} strokeWidth={1.2} />
      ) : (
        <Gamepad2 size={50} strokeWidth={1.2} />
      )}
      <strong>{product.name}</strong>
      <span>
        {product.variants.some(v => v.is_preorder)
          ? "Đặt trước · Giao khi có hàng"
          : product.category === "game"
            ? "Game bản quyền · Kích hoạt trên nền tảng"
          : product.category === "mmo"
          ? "Thông tin truy cập giao trong đơn hàng"
          : product.category === "gift"
            ? "Mã kích hoạt · Chọn đúng khu vực"
            : "Nạp theo UID / Riot ID"}
      </span>
    </div>
  );
}
export function App() {
  const [products, setProducts] = useState<Product[]>([]),
    [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [catalogReady, setCatalogReady] = useState(false),
    [mode, setMode] = useState(""),
    [authOpen, setAuthOpen] = useState(false),
    [toast, setToast] = useState<{ message: string; error: boolean } | null>(
      null,
    ),
    [mobile, setMobile] = useState(false),
    [loadError, setLoadError] = useState("");
  const location = useLocation();
  const navigate = useNavigate();
  const notify = (message: string, error = false) =>
    setToast({ message, error });
  const { cart, setCart, cartReady, cartError, retryCart, flushCart } = useAccountCart(user?.id, ready, notify);
  const refreshVersion = useRef(0);
  const refresh = async () => {
    const version = ++refreshVersion.current;
    const [products, user, rows] = await Promise.all([
      api<Product[]>("/products"),
      api<User>("/me"),
      api<{ id: string; name: string }[]>('/categories'),
    ]);
    if (version !== refreshVersion.current) return;
    updateCategories(rows);
    setProducts(products);
    setUser(user);
  };
  useDataRefresh(() => refresh().catch(e => notify(e.message, true)), ['/admin/', '/seller/']);
  useEffect(() => {
    // Session restoration must not delay public storefront rendering.
    api<User>("/me").then(setUser).catch(() => setUser(null)).finally(() => setReady(true));
    Promise.all([
      api<Product[]>("/products"),
      api<{ id: string; name: string }[]>('/categories'),
      api<{ mode: string }>("/config").then((c) => setMode(c.mode)),
    ])
      .then(([products, rows]) => {
        if (refreshVersion.current !== 0) return;
        updateCategories(rows);
        setProducts(products);
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setCatalogReady(true));
  }, []);
  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(null), 4500);
      return () => clearTimeout(id);
    }
  }, [toast]);
  useEffect(() => {
    window.scrollTo(0, 0);
    setMobile(false);
  }, [location.pathname]);
  const add = (id: string, quantity = 1) => {
    if (!cartReady) return notify('Giỏ hàng chưa tải xong. Vui lòng thử lại.', true);
    if (cart.length >= 20 && !cart.some(item => item.variant_id === id))
      return notify('Giỏ hàng tối đa 20 gói sản phẩm.', true);
    const p = products.find((p) => p.variants.some((v) => v.id === id));
    const v = p?.variants.find((v) => v.id === id);
    if (!v?.stock) return notify("Sản phẩm đã hết hàng.", true);
    const current = cart.find((i) => i.variant_id === id)?.quantity || 0;
    if (current + quantity > Math.min(10, v.stock))
      return notify("Vượt số lượng có thể mua.", true);
    setCart(
      current
        ? cart.map((i) =>
            i.variant_id === id ? { ...i, quantity: i.quantity + quantity } : i,
          )
        : [...cart, { variant_id: id, quantity }],
    );
    notify("Đã thêm vào giỏ hàng.");
  };
  const logout = async () => {
    try {
      await flushCart();
      await post("/auth/logout");
      setUser(null);
      navigate("/");
      notify("Đã đăng xuất.");
    } catch (e) {
      notify((e as Error).message, true);
    }
  };
  return (
    <StoreContext.Provider
      value={{
        products,
        user,
        ready,
        mode,
        cart,
        cartReady,
        cartError,
        retryCart,
        add,
        setCart,
        refresh,
        notify,
        login: () => setAuthOpen(true),
        setUser,
      }}
    >
      <div className="app-shell">
        <div className="topline">
          <div className="container">
            <span>
              <Zap size={12} /> Game key · Gift card · Nạp game · MMO
            </span>
            <Link to="/support">
              Hỗ trợ đơn hàng <ArrowUpRight size={12} />
            </Link>
          </div>
        </div>
        <header className="header">
          <div className="container header-main">
            <Link className="logo" to="/">
              <span className="logo-mark">
                <span aria-hidden="true">//</span>
              </span>
              KEYNEST<span className="logo-dot">®</span>
            </Link>
            <HeaderSearch />
            <div className="header-actions">
              <Link className="header-wallet" to="/wallet">
                <Wallet size={21} />
                <span className="header-action-copy">
                  <small>{user ? "Số dư ví" : "Thanh toán"}</small>
                  <strong>{user ? money(user.balance) : "Ví KEYNEST"}</strong>
                </span>
              </Link>
              <button
                className="account-button"
                disabled={!ready}
                aria-label={user ? `Tài khoản của ${user.name}` : "Đăng nhập"}
                onClick={() =>
                  user ? navigate("/account") : setAuthOpen(true)
                }
              >
                {user ? (
                  <Avatar
                    name={user.name}
                    url={user.avatar_url}
                    className="header-avatar signed-in"
                  />
                ) : (
                  <span className="header-avatar">
                    <UserRound size={19} />
                  </span>
                )}
                <span className="header-action-copy">
                  <small>{user ? "Tài khoản" : "Thành viên"}</small>
                  <strong>
                    {user ? user.name.trim().split(/\s+/).at(-1) : "Đăng nhập"}
                  </strong>
                </span>
              </button>
              <Link
                className="cart-link icon-button"
                to="/cart"
                aria-label={`Giỏ hàng ${cart.reduce((n, i) => n + i.quantity, 0)} sản phẩm`}
              >
                <ShoppingBag size={23} />
                {cart.length > 0 && (
                  <b>{cart.reduce((n, i) => n + i.quantity, 0)}</b>
                )}
              </Link>
              <button
                className="mobile-toggle icon-button"
                aria-label="Menu"
                aria-expanded={mobile}
                aria-controls="shop-departments"
                onClick={() => setMobile(!mobile)}
              >
                <Menu />
              </button>
            </div>
          </div>
          <StoreNavigation open={mobile} onOpenChange={setMobile} />
        </header>
        {mode === "demo" && (
          <div className="demo-strip">
            Chế độ thử nghiệm · Tiền và mã sản phẩm là dữ liệu mô phỏng.
            <button onClick={() => setAuthOpen(true)}>
              Dùng tài khoản mẫu <ArrowRight size={13} />
            </button>
          </div>
        )}
        <main>
          {location.pathname === '/reset-password' ? (
            <ResetPassword />
          ) : ['/privacy', '/privacy/', '/terms', '/terms/'].includes(location.pathname) ? (
            <LegalPage privacy={location.pathname.startsWith('/privacy')} />
          ) : user?.role === 'seller' && (user.seller_terms_version !== SELLER_TERMS_VERSION) ? (
            <Seller onboarding />
          ) : loadError ? (
            <div className="container">
              <Empty title="Chưa kết nối được cửa hàng" description={loadError}>
                <button
                  className="button"
                  onClick={() => window.location.reload()}
                >
                  Thử lại
                </button>
              </Empty>
            </div>
          ) : !catalogReady ? (
            <Loading />
          ) : (
            <Routes>
              <Route path="/seller" element={<Protected><Seller /></Protected>} />
              <Route
                path="/"
                element={
                  <>
                    <HomeAnnouncements />
                    <Home />
                  </>
                }
              />
              <Route path="/catalog" element={<Catalog />} />
              <Route path="/promotions" element={<PromotionsPage />} />
              <Route path="/guide" element={<GuidePage />} />
              <Route path="/terms" element={<LegalPage />} />
              <Route path="/privacy" element={<LegalPage privacy />} />
              <Route path="/auth/error" element={<OAuthErrorPage />} />
              <Route path="/products/:slug" element={<ProductPage />} />
              <Route path="/cart" element={<CartPage />} />
              <Route
                path="/wallet"
                element={
                  <Protected>
                    <WalletPage />
                  </Protected>
                }
              />
              <Route
                path="/orders"
                element={
                  <Protected>
                    <OrdersPage />
                  </Protected>
                }
              />
              <Route
                path="/orders/:id"
                element={
                  <Protected>
                    <OrderDetailPage />
                  </Protected>
                }
              />
              <Route
                path="/account"
                element={
                  <Protected>
                    <AccountPage logout={logout} />
                  </Protected>
                }
              />
              <Route path="/support" element={<SupportPage />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/two-factor" element={<TwoFactor challenge />} />
              <Route
                path="/admin-verification"
                element={<AdminVerification />}
              />
              <Route
                path="/admin"
                element={
                  <Protected admin>
                    <Admin />
                  </Protected>
                }
              />
              <Route
                path="*"
                element={
                  <Empty
                    title="Không tìm thấy trang"
                    description="Trang bạn tìm chưa có trong cửa hàng."
                  >
                    <Link className="button" to="/">
                      Về trang chủ
                    </Link>
                  </Empty>
                }
              />
            </Routes>
          )}
        </main>
        <footer>
          <div className="container footer-main">
            <div>
              <Link className="logo" to="/">
                <span className="logo-mark">
                  <span aria-hidden="true">//</span>
                </span>
                KEYNEST
              </Link>
              <p>
                Game hay. Công cụ tốt.
                <br />
                Một nơi cho mọi lựa chọn của bạn.
              </p>
              <SocialLinks />
            </div>
            <div>
              <strong>Cửa hàng</strong>
              <Link to="/catalog?category=game">Game key</Link>
              <Link to="/catalog?category=gift">Gift card</Link>
              <Link to="/catalog?category=topup">Nạp game</Link>
              <Link to="/catalog?category=mmo">MMO & Proxy</Link>
              <Link to="/promotions">Mã ưu đãi</Link>
              <Link to="/guide">Hướng dẫn mua hàng</Link>
            </div>
            <div>
              <strong>Tài khoản</strong>
              <Link to="/orders">Đơn hàng</Link>
              <Link to="/wallet">Ví & thanh toán</Link>
              <Link to="/account">Thông tin cá nhân</Link>
              <Link to="/terms">Điều khoản dịch vụ</Link>
              <Link to="/privacy">Chính sách bảo mật</Link>
            </div>
            <div>
              <strong>Cần một bàn tay?</strong>
              <p>
                Gửi yêu cầu, theo dõi phản hồi
                <br />
                ngay trong tài khoản của bạn.
              </p>
              <Link className="footer-support" to="/support">
                Trung tâm hỗ trợ <ArrowUpRight size={16} />
              </Link>
            </div>
          </div>
          <div className="container footer-bottom">
            <span>
              © {new Date().getFullYear()} KEYNEST. Cửa hàng sản phẩm số.
            </span>
            <span>
              <ShieldCheck size={15} />
              Chuyển khoản ngân hàng & ví KEYNEST
            </span>
          </div>
        </footer>
        {authOpen && <AuthModal close={() => setAuthOpen(false)} />}{" "}
        <OAuthWelcome />
        {toast && (
          <div
            className={`toast ${toast.error ? "toast-error" : ""}`}
            role="status"
          >
            {toast.error ? <X size={18} /> : <CheckCircle2 size={18} />}
            <span>{toast.message}</span>
            <button
              className="icon-button"
              aria-label="Đóng thông báo"
              onClick={() => setToast(null)}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </StoreContext.Provider>
  );
}
function Protected({
  children,
  admin = false,
}: {
  children: ReactNode;
  admin?: boolean;
}) {
  const { user, login, ready } = useStore();
  if (!ready) return <Loading />;
  if (!user)
    return (
      <div className="container">
        <Empty
          icon={UserRound}
          title="Chào bạn, đăng nhập nhé."
          description="Đăng nhập để quản lý ví, theo dõi đơn hàng và nhận sản phẩm."
        >
          <button className="button" onClick={login}>
            Đăng nhập <ArrowRight size={16} />
          </button>
        </Empty>
      </div>
    );
  if (admin && user.role !== "admin")
    return (
      <Empty
        icon={ShieldCheck}
        title="Khu vực quản trị"
        description="Tài khoản của bạn không có quyền truy cập."
      />
    );
  return children;
}
export function ProductCard({ product }: { product: Product }) {
  const v = product.variants.reduce<Variant | undefined>(
    (best, x) => (!best || x.price < best.price ? x : best),
    undefined,
  );
  return (
    <article
      className={`product-card ${product.category === "game" ? "game-poster" : "digital-product"}`}
    >
      <Link to={`/products/${product.slug}`} className="card-art">
        <Art product={product} poster />
        {v && v.original_price > v.price && (
          <span className="discount">
            -{Math.round((1 - v.price / v.original_price) * 100)}%
          </span>
        )}
      </Link>
      <div className="card-meta">
        <span>{product.platform}</span>
        <span
          className={
            product.variants.some((v) => v.stock > 0) ? "available" : "muted"
          }
        >
          <i />
          {product.variants.some(v => v.stock > 0 && !v.is_preorder) ? 'Còn hàng' : product.variants.some(v => v.stock > 0 && v.is_preorder) ? 'Nhận đặt trước' : 'Hết hàng'}
        </span>
      </div>
      <Link className="card-name" to={`/products/${product.slug}`}>
        {product.name}
      </Link>
      <RatingLine product={product} />
      {product.seller && <p className="seller-card-name">Người bán: {product.seller.name}</p>}
      <div className="card-bottom">
        <div>
          {v ? (
            <>
              <strong>{money(v.price)}</strong>
              {v.original_price > v.price && (
                <del>{money(v.original_price)}</del>
              )}
            </>
          ) : (
            <strong>Chưa có gói</strong>
          )}
        </div>
        <Link
          className="card-arrow"
          aria-label={`Xem ${product.name}`}
          to={`/products/${product.slug}`}
        >
          <ArrowUpRight size={18} />
        </Link>
      </div>
    </article>
  );
}
function ProductPage() {
  const { products, add } = useStore();
  const location = useLocation();
  const navigate = useNavigate();
  const p = products.find(
    (p) =>
      p.slug === decodeURIComponent(location.pathname.split("/").at(-1) || ""),
  );
  const [variantId, setVariant] = useState(""),
    [quantity, setQuantity] = useState(1),
    [tab, setTab] = useState("description");
  useEffect(() => {
    setVariant("");
    setQuantity(1);
    setTab("description");
    if (p) rememberProduct(p.slug);
  }, [p?.id]);
  if (!p)
    return (
      <Empty
        title="Sản phẩm không có sẵn"
        description="Sản phẩm có thể đã ngừng bán."
      >
        <Link className="button" to="/catalog">
          Về cửa hàng
        </Link>
      </Empty>
    );
  const v = p.variants.find((v) => v.id === variantId) || p.variants[0];
  if (!v) return <Empty title="Sản phẩm tạm ngừng bán" description="Cửa hàng chưa mở bán gói nào cho sản phẩm này."><Link className="button" to="/catalog">Về cửa hàng</Link></Empty>;
  return (
    <div className="container page">
      <div className="breadcrumb">
        <Link to="/">Trang chủ</Link>
        <ChevronRight size={13} />
        <Link to={`/catalog?category=${p.category}`}>
          {categories[p.category]}
        </Link>
        <ChevronRight size={13} />
        {p.name}
      </div>
      <div className="detail-grid">
        <div>
          <div className="detail-art">
            <Art product={p} />
          </div>
          <div className="detail-assurance">
            <span>
              <ShieldCheck size={17} />
              Mã hóa thông tin giao hàng
            </span>
            <span>
              <Headphones size={17} />
              Hỗ trợ trong tài khoản
            </span>
          </div>
        </div>
        <div className="detail-buy">
          <span className="eyebrow orange">
            {p.platform} / {categories[p.category]}
          </span>
          <h1>{p.name}</h1>
          {p.seller && <section className="seller-notice"><SellerContact seller={p.seller}/><p>Người bán chịu trách nhiệm về thông tin, chất lượng, giao hàng và bảo hành sản phẩm này. Khi có vấn đề, hãy gửi yêu cầu tại Trung tâm hỗ trợ KEYNEST để được kiểm tra.</p></section>}
          <button
            className="detail-rating-button"
            onClick={() => {
              setTab("reviews");
              document
                .getElementById("product-feedback-tabs")
                ?.scrollIntoView({ block: "start" });
            }}
            aria-label="Xem đánh giá sản phẩm"
          >
            <RatingLine product={p} />
          </button>
          <p className="muted">{p.subtitle}</p>
          {v ? (
            <>
              <div className="detail-price">
                <strong>{money(v.price)}</strong>
                {v.original_price > v.price && (
                  <>
                    <del>{money(v.original_price)}</del>
                    <span className="discount">
                      -{Math.round((1 - v.price / v.original_price) * 100)}%
                    </span>
                  </>
                )}
              </div>
              <label className="field-title">Chọn phiên bản / gói</label>
              <div className="variants">
                {p.variants.map((x) => (
                  <button
                    key={x.id}
                    className={x.id === v.id ? "selected" : ""}
                    onClick={() => {
                      setVariant(x.id);
                      setQuantity(1);
                    }}
                  >
                    <span>
                      {x.name}
                      <small>
                        {x.region} ·{" "}
                        {x.is_preorder ? 'Đặt trước' : x.delivery === "key"
                          ? "Giao mã tự động"
                          : "Giao sau khi xử lý"}
                      </small>
                    </span>
                    <strong>{money(x.price)}</strong>
                    {x.id === v.id && <Check size={17} />}
                  </button>
                ))}
              </div>
              <div className="detail-stock">
                <span className={v.stock ? "available" : "muted"}>
                  <i />
                  {v.is_preorder ? (v.stock ? 'Nhận đặt trước' : 'Đã đủ lượt đặt') : v.stock ? "Có sẵn" : "Hết hàng"}
                </span>
                <span>
                  <Globe2 size={14} />
                  {v.region}
                </span>
              </div>
              <p className="product-warranty-note">
                <ShieldCheck size={14} />
                {v.warranty_days > 0
                  ? `Bảo hành ${v.warranty_days} ngày kể từ khi giao sản phẩm`
                  : "Gói này không áp dụng bảo hành theo ngày"}
              </p>
              <PreorderNote item={v} />
              <div className="buy-actions">
                <div className="quantity">
                  <button
                    aria-label="Giảm số lượng"
                    disabled={quantity === 1}
                    onClick={() => setQuantity(quantity - 1)}
                  >
                    <Minus size={15} />
                  </button>
                  <span>{quantity}</span>
                  <button
                    aria-label="Tăng số lượng"
                    disabled={quantity >= Math.min(10, v.stock)}
                    onClick={() => setQuantity(quantity + 1)}
                  >
                    <Plus size={15} />
                  </button>
                </div>
                <button
                  disabled={!v.stock}
                  className="button"
                  onClick={() => add(v.id, quantity)}
                >
                  <ShoppingBag size={18} />
                  Thêm vào giỏ
                </button>
              </div>
              <button
                disabled={!v.stock}
                className="button button-dark full"
                onClick={() => {
                  add(v.id, quantity);
                  navigate("/cart");
                }}
              >
                {v.is_preorder ? 'Đặt trước ngay' : 'Mua ngay'} <ArrowRight size={17} />
              </button>
              {v.delivery === "manual" && !v.is_preorder && (
                <p className="info-note">
                  Điền UID, máy chủ hoặc thông tin dịch vụ ở bước thanh toán.
                  Gói này được xử lý theo yêu cầu, không giao key. Không gửi mật
                  khẩu tài khoản game.
                </p>
              )}
            </>
          ) : (
            <p>Chưa có gói đang bán.</p>
          )}
        </div>
      </div>
      <div className="detail-tabs" id="product-feedback-tabs">
        <button
          className={tab === "description" ? "active" : ""}
          onClick={() => setTab("description")}
        >
          Thông tin sản phẩm
        </button>
        <button
          className={tab === "guide" ? "active" : ""}
          onClick={() => setTab("guide")}
        >
          Hướng dẫn & hỗ trợ
        </button>
        <button
          className={tab === "reviews" ? "active" : ""}
          onClick={() => setTab("reviews")}
        >
          Đánh giá ({p.review_count || 0})
        </button>
        <button
          className={tab === "comments" ? "active" : ""}
          onClick={() => setTab("comments")}
        >
          Bình luận
        </button>
      </div>
      <div className="detail-content">
        {tab === "description" ? (
          <>
            <h2>Về {p.name}</h2>
            <p className="pre-wrap">{p.description}</p>
            {p.usage_notes && <section className="product-usage-notes"><h3>Hướng dẫn sử dụng & lưu ý</h3><p>{p.usage_notes}</p></section>}
            <p>
              Mỗi gói hiển thị rõ nền tảng và khu vực sử dụng. Hãy kiểm tra các
              thông tin này trước khi thanh toán.
            </p>
          </>
        ) : tab === "guide" ? (
          <>
            {p.usage_notes && <section className="product-usage-notes"><h3>Hướng dẫn dành cho {p.name}</h3><p>{p.usage_notes}</p></section>}
            <h2>Từ giỏ hàng đến trải nghiệm của bạn.</h2>
            <ol>
              <li>Chọn gói và kiểm tra khu vực.</li>
              <li>Thanh toán bằng số dư ví hoặc quét QR ngân hàng.</li>
              <li>
                Vào “Đơn hàng của tôi” để nhận mã hoặc theo dõi xử lý dịch vụ.
              </li>
              <li>
                Nếu mã chưa sử dụng không kích hoạt được, gửi yêu cầu hỗ trợ kèm
                mã đơn. Kết quả xử lý được phản hồi trong tài khoản.
              </li>
            </ol>
            <p>
              Mã đã giao và sử dụng không được tự động hoàn. Quản trị viên kiểm
              tra bảo hành và thông báo cách hoàn tiền trong đơn của bạn.
            </p>
          </>
        ) : (
          <>
            <ProductFeedback
              key={`${p.id}-${tab}`}
              product={p}
              mode={tab === "reviews" ? "reviews" : "comments"}
            />
          </>
        )}
      </div>
      <div className="section-title">
        <h2>Có thể bạn cũng thích.</h2>
        <Link to="/catalog">
          Xem tất cả <ArrowUpRight size={18} />
        </Link>
      </div>
      <div className="product-grid">
        {products
          .filter((x) => x.id !== p.id && x.category === p.category)
          .slice(0, 4)
          .map((x) => (
            <ProductCard key={x.id} product={x} />
          ))}
      </div>
    </div>
  );
}
function CartPage() {
  const { products, cart, setCart, cartReady, cartError, retryCart, user, login, refresh, notify } = useStore();
  const navigate = useNavigate();
  const [method, setMethod] = useState("wallet"),
    [coupon, setCoupon] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [key, setKey] = useState(crypto.randomUUID());
  const [couponQuote, setCouponQuote] = useState<{
    signature: string;
    discount: number;
    total: number;
  } | null>(null);
  const [couponError, setCouponError] = useState("");
  const [couponChecking, setCouponChecking] = useState(false);
  const couponSignature = JSON.stringify([cart, coupon.trim(), user?.id]);
  useEffect(() => {
    setCouponError("");
    setCouponQuote(null);
    if (!user || !coupon.trim() || !cart.length) {
      setCouponChecking(false);
      return;
    }
    const controller = new AbortController();
    setCouponChecking(true);
    const timer = setTimeout(() => {
      api<{ discount: number; total: number }>("/coupons/preview", {
        method: "POST",
        body: JSON.stringify({ code: coupon.trim(), items: cart }),
        signal: controller.signal,
      })
        .then((result) => {
          if (!controller.signal.aborted)
            setCouponQuote({ ...result, signature: couponSignature });
        })
        .catch((e) => {
          if (!controller.signal.aborted) setCouponError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setCouponChecking(false);
        });
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [couponSignature]);
  const appliedCoupon =
    couponQuote?.signature === couponSignature ? couponQuote : null;
  useEffect(() => {
    setKey(crypto.randomUUID());
  }, [cart, method, coupon, note]);
  const lines = cart.map((i) => {
    const product = products.find((p) =>
      p.variants.some((v) => v.id === i.variant_id),
    );
    return {
      ...i,
      product,
      variant: product?.variants.find((v) => v.id === i.variant_id),
    };
  });
  const total = lines.reduce(
    (n, i) => n + (i.variant?.price || 0) * i.quantity,
    0,
  );
  const unavailable = lines.some(
    (i) => !i.variant || i.variant.stock < i.quantity,
  );
  async function checkout() {
    if (!cartReady) return;
    if (!user) return login();
    if (unavailable)
      return notify("Vui lòng cập nhật sản phẩm không đủ tồn kho.", true);
    setBusy(true);
    try {
      const o = await post<Order>(
        "/orders",
        { items: cart, method, coupon, customer_note: note },
        { "Idempotency-Key": key },
      );
      setCart([]);
      await refresh();
      navigate("/orders", { state: { payment: o.payment } });
      notify(
        o.method === "wallet"
          ? "Đặt hàng thành công."
          : "Đơn đã tạo. Hoàn tất chuyển khoản để nhận hàng.",
      );
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  if (!cartReady) return <div className="container page" role="status">
    {cartError ? <><p className="form-error">{cartError}</p><button className="button" onClick={retryCart}>Tải lại giỏ hàng</button></> : <p>Đang tải giỏ hàng…</p>}
  </div>;
  return (
    <div className="container page">
      <div className="breadcrumb">
        <Link to="/">Trang chủ</Link>
        <ChevronRight size={13} />
        Giỏ hàng
      </div>
      <div className="page-heading">
        <div>
          <span className="eyebrow orange">Thanh toán</span>
          <h1>Giỏ hàng của bạn.</h1>
          <p>{cart.length} sản phẩm đang chờ cuộc chơi mới.</p>
        </div>
        <Link to="/catalog">
          Tiếp tục khám phá <ArrowRight size={17} />
        </Link>
      </div>
      {!cart.length ? (
        <Empty
          title="Giỏ hàng còn trống"
          description="Một game hay hoặc công cụ phù hợp đang chờ bạn."
        >
          <Link className="button" to="/catalog">
            Khám phá cửa hàng
          </Link>
        </Empty>
      ) : (
        <div className="checkout-layout">
          <div>
            <div className="panel cart-panel">
              {lines.map((i) => (
                <div className="cart-item" key={i.variant_id}>
                  {i.product ? (
                    <Link
                      className="cart-art"
                      to={`/products/${i.product.slug}`}
                    >
                      <Art product={i.product} />
                    </Link>
                  ) : (
                    <Package />
                  )}
                  <div className="cart-item-info">
                    <strong>
                      {i.product?.name || "Sản phẩm không còn bán"}
                    </strong>
                    <span>{i.variant?.name}</span>
                    {i.variant && <PreorderNote item={i.variant} />}
                    <small>
                      {i.variant?.region}
                      {i.variant?.stock === 0 ? " · Hết hàng" : ""}
                    </small>
                  </div>
                  <div className="quantity">
                    <button
                      aria-label="Giảm"
                      disabled={i.quantity === 1}
                      onClick={() =>
                        setCart(
                          cart.map((x) =>
                            x.variant_id === i.variant_id
                              ? { ...x, quantity: x.quantity - 1 }
                              : x,
                          ),
                        )
                      }
                    >
                      <Minus size={14} />
                    </button>
                    <span>{i.quantity}</span>
                    <button
                      aria-label="Tăng"
                      disabled={
                        i.quantity >= Math.min(10, i.variant?.stock || 0)
                      }
                      onClick={() =>
                        setCart(
                          cart.map((x) =>
                            x.variant_id === i.variant_id
                              ? { ...x, quantity: x.quantity + 1 }
                              : x,
                          ),
                        )
                      }
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  <strong>{money((i.variant?.price || 0) * i.quantity)}</strong>
                  <button
                    className="icon-button"
                    aria-label="Xóa sản phẩm"
                    onClick={() =>
                      setCart(cart.filter((x) => x.variant_id !== i.variant_id))
                    }
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              ))}
            </div>
            <div className="panel">
              <h3>Ghi chú đơn hàng / thông tin dịch vụ</h3>
              <p className="muted">
                Với nạp game: nhập UID / Riot ID và máy chủ. Với proxy: nhập
                quốc gia hoặc yêu cầu cấu hình. Sản phẩm đặt trước không yêu cầu UID; bạn có thể để trống ghi chú.
              </p>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
                placeholder="Ví dụ: Genshin UID 123456789, server Asia…"
                aria-label="Thông tin dịch vụ"
              />
              <small>
                Không gửi mật khẩu game hay thông tin thẻ ngân hàng.
              </small>
            </div>
            <div className="panel">
              <h3>Phương thức thanh toán</h3>
              <div className="payment-methods">
                <button
                  onClick={() => setMethod("wallet")}
                  aria-pressed={method === "wallet"}
                  className={method === "wallet" ? "selected" : ""}
                >
                  <Wallet />
                  <span>
                    <strong>Ví KEYNEST</strong>
                    <small>
                      {user
                        ? `Số dư ${money(user.balance)}`
                        : "Đăng nhập để xem số dư"}
                    </small>
                  </span>
                  {method === "wallet" && <CheckCircle2 size={20} />}
                </button>
                <button
                  onClick={() => setMethod("sepay")}
                  aria-pressed={method === "sepay"}
                  className={method === "sepay" ? "selected" : ""}
                >
                  <Landmark />
                  <span>
                    <strong>Chuyển khoản ngân hàng</strong>
                    <small>Quét QR, xác nhận tự động</small>
                  </span>
                  {method === "sepay" && <CheckCircle2 size={20} />}
                </button>
              </div>
            </div>
          </div>
          <aside className="panel order-summary">
            <h2>Tóm tắt đơn hàng</h2>
            <div className="summary-row">
              <span>Tạm tính</span>
              <strong>{money(total)}</strong>
            </div>
            <div className="summary-row">
              <span>Phí thanh toán</span>
              <span>Miễn phí</span>
            </div>
            <label className="field-title">Mã giảm giá</label>
            <div className="input-icon checkout-coupon-field">
              <TicketIcon size={18} />
              <input
                value={coupon}
                onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                maxLength={32}
                placeholder="Nhập mã tại đây"
                aria-label="Mã giảm giá"
              />
            </div>
            {coupon && (
              <p className={couponError ? "form-error" : "muted"} role="status">
                {!user
                  ? "Đăng nhập để kiểm tra điều kiện mã giảm giá."
                  : couponChecking
                    ? "Đang kiểm tra mã…"
                    : couponError ||
                      (appliedCoupon
                        ? `Đã áp dụng mã · Giảm ${money(appliedCoupon.discount)}`
                        : "Nhập mã để kiểm tra điều kiện.")}
              </p>
            )}
            {appliedCoupon && (
              <div className="summary-row">
                <span>Giảm giá</span>
                <strong>−{money(appliedCoupon.discount)}</strong>
              </div>
            )}
            <hr />
            <div className="summary-row summary-total">
              <strong>
                {appliedCoupon ? "Tổng thanh toán" : "Tạm tính trước giảm"}
              </strong>
              <strong>{money(appliedCoupon?.total ?? total)}</strong>
            </div>
            <button
              className="button full"
              disabled={busy || unavailable}
              onClick={checkout}
            >
              {busy
                ? "Đang tạo đơn…"
                : user
                  ? "Đặt hàng & thanh toán"
                  : "Đăng nhập để thanh toán"}
              <ArrowRight size={17} />
            </button>
            {unavailable && (
              <p className="form-error">Có sản phẩm không còn đủ số lượng.</p>
            )}
            <p className="checkout-note">
              <ShieldCheck size={15} />
              Tổng cuối cùng được xác nhận khi tạo đơn. Đơn chuyển khoản giữ
              hàng trong 15 phút.
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}
export function PaymentModal({
  payment: initialPayment,
  onClose,
  onPaid,
}: {
  payment: Payment;
  onClose: () => void;
  onPaid: () => void;
}) {
  const { notify } = useStore();
  const [payment,setPayment]=useState(initialPayment);
  const dynamicTingee=payment.provider==='tingee' && payment.qr_kind!=='static';
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState(payment.status),
    [remaining, setRemaining] = useState(
      Math.max(0, Math.ceil((Date.parse(payment.expires_at) - Date.now()) / 1000)) * 1000,
    );
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;
  useEffect(() => {
    const updateCountdown = () => {
      setRemaining(
        Math.max(0, Math.ceil((Date.parse(payment.expires_at) - Date.now()) / 1000)) * 1000,
      );
    };
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);
    document.addEventListener("visibilitychange", updateCountdown);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", updateCountdown);
    };
  }, [payment.id, payment.expires_at]);
  useEffect(() => {
    if (status !== 'pending') return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      let terminal = false;
      try {
        if (document.hidden) return;
        const options = { signal: controller.signal };
        const p = payment.order_id
          ? (await api<Order>(`/orders/${payment.order_id}`, options)).payment
          : (await api<{ payments: Payment[] }>('/wallet', options)).payments.find(p => p.id === payment.id);
        if (controller.signal.aborted) return;
        if (p) {
          setPayment(p);
          terminal = p.status !== 'pending';
          setStatus(p.status);
          if (p.status === 'paid') onPaidRef.current();
        }
      } catch { /* Retry transient failures without overlapping requests. */ }
      finally {
        if (!controller.signal.aborted && !terminal) timer = setTimeout(check, 2000);
      }
    };
    timer = setTimeout(check, 2000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [payment.id, payment.order_id, status]);
  async function simulate() {
    setBusy(true);
    try {
      const result = await post<{
        paid?: boolean;
        review?: boolean;
        duplicate?: boolean;
      }>(`/demo/pay/${payment.id}`);
      if (result.paid || result.duplicate) {
        setStatus("paid");
        onPaid();
      } else notify("Giao dịch hết hạn hoặc cần kiểm tra.", true);
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Chuyển khoản ngân hàng"
      close={onClose}
      className="transfer-dialog"
    >
      <div className="payment-modal">
        {status === "paid" ? (
          <div className="transfer-success" role="status">
            <span className="transfer-success-icon">
              <CheckCircle2 size={32} />
            </span>
            <h2>Đã nhận thanh toán.</h2>
            <p>
              {payment.order_id
                ? "Thanh toán đơn hàng đã được ghi nhận."
                : "Tiền đã được cộng vào ví KEYNEST của bạn."}
            </p>
            <strong>{money(payment.amount)}</strong>
            <button className="button" onClick={onClose}>
              Hoàn tất
            </button>
          </div>
        ) : (
          <>
            <div className="transfer-summary">
              <span className="transfer-bank-icon">
                <Landmark size={24} />
              </span>
              <div>
                <span>
                  {payment.order_id
                    ? "Thanh toán đơn hàng"
                    : "Nạp vào ví KEYNEST"}
                </span>
                <h2>{money(payment.amount)}</h2>
              </div>
              <span className="transfer-label">
                {payment.demo ? "Bản demo" : dynamicTingee ? "QR động" : "VietQR"}
              </span>
            </div>
            <div className="transfer-grid">
              <div className="transfer-visual">
                {status !== "pending" || remaining <= 0 ? (
                  <div className="transfer-placeholder">
                    <Clock3 size={36} />
                    <strong>
                      {remaining <= 0 && status === "pending"
                        ? "Mã thanh toán hết hạn"
                        : statuses[status]}
                    </strong>
                    <p>Đóng cửa sổ để kiểm tra trạng thái giao dịch.</p>
                  </div>
                ) : payment.demo ? (
                  <div className="demo-payment">
                    <span className="transfer-demo-icon">
                      <Landmark size={38} />
                    </span>
                    <strong>Giao dịch mô phỏng</strong>
                    <p>
                      Bản demo không nhận tiền thật. Dùng nút bên dưới để thử
                      nạp tiền và cập nhật số dư.
                    </p>
                  </div>
                ) : payment.qr_url ? (
                  <>
                    <div className="transfer-qr-frame">
                      <img
                        className="payment-qr"
                        src={payment.qr_url}
                        alt="QR chuyển khoản với số tiền và nội dung chính xác"
                      />
                    </div>
                    <p>
                      <QrCode size={16} /> Mở ứng dụng ngân hàng để quét mã
                    </p>
                  </>
                ) : (
                  <div className="transfer-placeholder">
                    <Landmark size={36} />
                    <strong>{payment.qr_state==='creating' ? 'Đang tạo mã QR' : 'Chưa có mã QR'}</strong>
                    <p>{payment.qr_state==='failed' ? 'Chưa thể tạo mã thanh toán. Vui lòng liên hệ hỗ trợ.' : 'Vui lòng chờ hệ thống cập nhật mã thanh toán.'}</p>
                  </div>
                )}
              </div>
              <div className="transfer-information">
                <h3>Thông tin chuyển khoản</h3>
                <div className="bank-details">
                  {!payment.demo && payment.qr_url && (
                    <>
                      <span>
                        Ngân hàng<strong>{payment.bank}</strong>
                      </span>
                      <span>
                        Số tài khoản
                        <strong>
                          {payment.account}
                          <button
                            className="icon-button"
                            aria-label="Sao chép số tài khoản"
                            onClick={() =>
                              navigator.clipboard
                                .writeText(payment.account)
                                .then(() => notify("Đã sao chép số tài khoản."))
                                .catch(() =>
                                  notify("Không thể sao chép.", true),
                                )
                            }
                          >
                            <Copy size={15} />
                          </button>
                        </strong>
                      </span>
                      <span>
                        Chủ tài khoản<strong>{payment.account_name}</strong>
                      </span>
                    </>
                  )}
                  <span className="transfer-code">
                    {dynamicTingee ? 'Mã hóa đơn thanh toán' : 'Nội dung chuyển khoản'}
                    <strong>
                      {dynamicTingee ? payment.bill_id : payment.code}
                      <button
                        className="icon-button"
                        aria-label="Sao chép mã"
                        onClick={() =>
                          navigator.clipboard
                            .writeText(dynamicTingee ? payment.bill_id || '' : payment.code)
                            .then(() => notify("Đã sao chép nội dung."))
                            .catch(() => notify("Không thể sao chép.", true))
                        }
                      >
                        <Copy size={14} />
                      </button>
                    </strong>
                  </span>
                </div>
                <p className="transfer-instruction">
                  {dynamicTingee ? 'Quét mã QR động của giao dịch này và kiểm tra số tiền trong ứng dụng ngân hàng. Hệ thống tự đối soát theo mã hóa đơn.' : 'Giữ nguyên nội dung và chuyển đúng số tiền để giao dịch được xác nhận tự động.'}
                </p>
              </div>
            </div>
            <div
              className={`transfer-status ${status === "pending" && remaining > 0 ? "is-pending" : ""}`}
            >
              <Clock3 size={17} />
              <span>
                {status !== "pending"
                  ? statuses[status]
                  : remaining > 0
                    ? "Đang chờ thanh toán"
                    : "Đã hết thời gian thanh toán."}
              </span>
              {status === "pending" && remaining > 0 && (
                <strong>
                  {Math.floor(remaining / 60000)}:
                  {String(Math.floor(remaining / 1000) % 60).padStart(2, "0")}
                </strong>
              )}
            </div>
            <p className="transfer-footnote">
              Tự động kiểm tra thanh toán. Giao dịch sai số tiền hoặc quá hạn
              cần được hỗ trợ kiểm tra.
            </p>
            {payment.demo && (
              <button
                className="button full transfer-demo-button"
                disabled={busy || status !== "pending" || remaining <= 0}
                onClick={simulate}
              >
                {busy ? "Đang xác nhận…" : "Mô phỏng thanh toán thành công"}
                <Check size={17} />
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
function WalletPage() {
  const { user, setUser, notify } = useStore();
  const walletLoadVersion = useRef(0);
  const [walletNow, setWalletNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setWalletNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const amountInput = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<{
      balance: number;
      ledger: Ledger[];
      payments: Payment[];
    } | null>(null),
    [amount, setAmount] = useState(200000),
    [payment, setPayment] = useState<Payment | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    amountInput.current?.setCustomValidity(
      amount && (amount < 10000 || amount > 50000000 || amount % 1000 !== 0)
        ? 'Nhập từ 10.000 đến 50.000.000 VND, theo bước 1.000 VND.' : '',
    );
  }, [amount, data]);
  const load = async () => {
    const version = ++walletLoadVersion.current;
    const owner = user?.id;
    try {
      const wallet = await api<NonNullable<typeof data>>("/wallet");
      if (version !== walletLoadVersion.current) return;
      setData(wallet);
      setError('');
      setUser(current => current && current.id === owner ? { ...current, balance: wallet.balance } : current);
    } catch (e) {
      if (version === walletLoadVersion.current) setError((e as Error).message);
    }
  };
  const visiblePayments = data?.payments.filter(p => p.status !== 'expired' &&
    !(p.status === 'pending' && new Date(p.expires_at).getTime() <= walletNow)) || [];
  useEffect(() => {
    load();
    const onFocus = () => { if (!document.hidden) void load(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      walletLoadVersion.current++;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [user?.id]);
  const hasPendingTopup = visiblePayments.some(p => p.status === 'pending');
  useEffect(() => {
    if (!hasPendingTopup || payment) return;
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 3000);
    return () => window.clearInterval(timer);
  }, [hasPendingTopup, payment, user?.id]);
  async function topup(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!Number.isSafeInteger(amount) || amount < 10000 || amount > 50000000 || amount % 1000 !== 0) {
      notify('Nhập từ 10.000 đến 50.000.000 VND, theo bước 1.000 VND.', true);
      return;
    }
    setBusy(true);
    try {
      setPayment(await post<Payment>("/wallet/topup", { amount }));
      await load();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="container page wallet-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow orange">Ví & thanh toán</span>
          <h1>Ví KEYNEST</h1>
          <p>Nạp một lần, sẵn sàng cho lần mua tiếp theo.</p>
        </div>
        <Link to="/orders">
          Xem đơn hàng <ArrowUpRight size={17} />
        </Link>
      </div>
      {error ? (
        <p className="form-error">{error}</p>
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <div className="wallet-layout">
            <section className="wallet-card">
              <div className="wallet-card-heading">
                <span className="wallet-symbol">
                  <Wallet size={22} />
                </span>
                <span>KEYNEST WALLET</span>
              </div>
              <span>Số dư khả dụng</span>
              <strong>{money(user?.balance ?? data.balance)}</strong>
              <p>
                Dùng để thanh toán game key, gift card và dịch vụ tại KEYNEST.
              </p>
              <Link className="wallet-shop-link" to="/catalog">
                Khám phá cửa hàng <ArrowUpRight size={16} />
              </Link>
              <div className="wallet-card-note">
                <ShieldCheck size={16} />
                <span>Số dư dùng trong cửa hàng, không hỗ trợ rút tiền.</span>
              </div>
            </section>
            <form className="panel topup-form" onSubmit={topup}>
              <div className="wallet-topup-heading">
                <div>
                  <h2>Nạp tiền vào ví</h2>
                  <p>Chọn số tiền, tạo mã QR và chuyển khoản ngân hàng.</p>
                </div>
                <Landmark size={23} />
              </div>
              <span className="topup-label">Chọn nhanh số tiền</span>
              <div className="amounts">
                {[100000, 200000, 500000, 1000000].map((n) => (
                  <button
                    type="button"
                    className={n === amount ? "selected" : ""}
                    aria-pressed={n === amount}
                    disabled={busy}
                    onClick={() => setAmount(n)}
                    key={n}
                  >
                    {money(n)}
                  </button>
                ))}
              </div>
              <label className="field-title" htmlFor="topup-amount">
                Số tiền nạp (VND)
              </label>
              <div className="topup-amount-input">
                <input
                  id="topup-amount"
                  ref={amountInput}
                  aria-describedby="topup-amount-hint"
                  disabled={busy}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={15}
                  placeholder="Nhập số tiền"
                  value={amount ? amount.toLocaleString('vi-VN') : ''}
                  required
                  onKeyDown={(e) => {
                    const input = e.currentTarget;
                    const caret = input.selectionStart ?? 0;
                    if (caret !== input.selectionEnd) return;
                    // Skip the visual separator so deletion still removes a digit.
                    if (e.key === 'Backspace' && input.value[caret - 1] === '.') input.setSelectionRange(caret - 1, caret - 1);
                    if (e.key === 'Delete' && input.value[caret] === '.') input.setSelectionRange(caret + 1, caret + 1);
                  }}
                  onChange={(e) => {
                    const input = e.currentTarget;
                    const before = input.value.slice(0, input.selectionStart ?? input.value.length).replace(/\D/g, '').length;
                    const next = Number(input.value.replace(/\D/g, ''));
                    const formatted = next ? next.toLocaleString('vi-VN') : '';
                    setAmount(next);
                    input.value = formatted;
                    let caret = 0, digits = 0;
                    while (caret < formatted.length && digits < before) {
                      if (/\d/.test(formatted[caret])) digits++;
                      caret++;
                    }
                    input.setSelectionRange(caret, caret);
                  }}
                />
                <span aria-hidden="true">VND</span>
              </div>
              <p id="topup-amount-hint" className="topup-amount-hint">
                Từ 10.000 ₫ đến 50.000.000 ₫, theo bước 1.000 ₫.
              </p>
              <div className="topup-footer">
                <span>
                  <QrCode size={17} />
                  Số dư cập nhật khi nhận tiền
                </span>
                <button disabled={busy} className="button">
                  {busy ? "Đang tạo…" : "Tạo mã nạp tiền"}
                  <ArrowRight size={17} />
                </button>
              </div>
            </form>
          </div>
          <section className="panel wallet-history">
            <h2>Lịch sử ví</h2>
            {data.ledger.length ? (
              <div className="transaction-list">
                {data.ledger.map((l) => (
                  <div key={l.id}>
                    <span
                      className={`transaction-icon ${l.amount > 0 ? "positive" : ""}`}
                    >
                      {l.amount > 0 ? <ArrowDownLeft /> : <ArrowUpRight />}
                    </span>
                    <span>
                      <strong>{l.description}</strong>
                      <small>{date(l.created_at)}</small>
                    </span>
                    <strong className={l.amount > 0 ? "positive" : ""}>
                      {l.amount > 0 ? "+" : ""}
                      {money(l.amount)}
                    </strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">Chưa phát sinh giao dịch.</p>
            )}
          </section>
          <section className="panel wallet-requests">
            <h2>Yêu cầu nạp tiền</h2>
            {visiblePayments.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Mã giao dịch</th>
                      <th>Thời gian</th>
                      <th>Số tiền</th>
                      <th>Trạng thái</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePayments.map((p) => (
                      <tr key={p.id}>
                        <td className="mono">{p.code}</td>
                        <td>{date(p.created_at)}</td>
                        <td>{money(p.amount)}</td>
                        <td>
                          <Badge status={p.status} />
                        </td>
                        <td>
                          {p.status === "pending" && (
                            <button
                              className="text-button"
                              onClick={() => setPayment(p)}
                            >
                              Thanh toán
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">Các yêu cầu nạp sẽ hiển thị tại đây.</p>
            )}
          </section>
        </>
      )}
      {payment && (
        <PaymentModal
          payment={payment}
          onClose={() => setPayment(null)}
          onPaid={() => {
            load();
          }}
        />
      )}
    </div>
  );
}
function SupportPage() {
  const { user, login, notify } = useStore();
  const [tickets, setTickets] = useState<Ticket[]>([]),
    [busy, setBusy] = useState(false);
  const load = () =>
    user
      ? api<Ticket[]>("/tickets")
          .then(setTickets)
          .catch((e) => notify(e.message, true))
      : Promise.resolve();
  useEffect(() => {
    load();
  }, [user?.id]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user) return login();
    const form = e.currentTarget,
      f = new FormData(form);
    setBusy(true);
    try {
      await post("/tickets", {
        subject: f.get("subject"),
        message: f.get("message"),
      });
      form.reset();
      await load();
      notify("Yêu cầu đã được gửi.");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="container page">
      <div className="page-heading">
        <div>
          <span className="eyebrow orange">Trung tâm hỗ trợ</span>
          <h1>Cần một bàn tay?</h1>
          <p>Hướng dẫn mua hàng và hỗ trợ, ngay tại đây.</p>
        </div>
        <Headphones size={45} strokeWidth={1.3} />
      </div>
      <div className="support-layout">
        <section>
          <div className="panel faq">
            <h2>Câu hỏi thường gặp</h2>
            {[
              [
                "Tôi nhận sản phẩm ở đâu?",
                "Game key và gift card có sẵn được giao trong trang Đơn hàng sau khi xác nhận thanh toán. Nạp game và dịch vụ MMO do quản trị viên xử lý, kết quả cũng hiển thị trong đơn.",
              ],
              [
                "Chuyển khoản rồi nhưng đơn chưa cập nhật?",
                "Giữ đúng nội dung và số tiền trên QR. Đơn giữ hàng 15 phút. Nếu chuyển sai hoặc quá hạn, gửi yêu cầu kèm mã đơn và mã giao dịch ngân hàng để quản trị viên đối soát.",
              ],
              [
                "Ví KEYNEST hoạt động thế nào?",
                "Nạp bằng chuyển khoản ngân hàng để mua sản phẩm trên cửa hàng. Số dư không tự động rút về ngân hàng. Khoản hoàn đơn được cộng vào ví sau khi quản trị viên kiểm tra.",
              ],
              [
                "Tôi cần gửi gì khi nạp game hoặc mua proxy?",
                "Nạp game cần UID / Riot ID và server. Proxy cần quốc gia hoặc cấu hình. Không gửi mật khẩu tài khoản game. Thông tin proxy được giao riêng trong tài khoản.",
              ],
              [
                "Mã sản phẩm lỗi thì xử lý ra sao?",
                "Mở chi tiết đơn để gửi bảo hành, chọn mã cần kiểm tra và mô tả lỗi. Cửa hàng phản hồi trong tài khoản; khoản hoàn được ghi rõ là vào ví hoặc đã hoàn qua phương thức bên ngoài.",
              ],
            ].map(([q, a]) => (
              <details key={q}>
                <summary>
                  {q}
                  <Plus size={17} />
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
          <div className="panel">
            <h2>Yêu cầu của bạn</h2>
            {!user ? (
              <p className="muted">Đăng nhập để gửi và theo dõi yêu cầu.</p>
            ) : !tickets.length ? (
              <p className="muted">Chưa có yêu cầu hỗ trợ.</p>
            ) : (
              tickets.map((t) => (
                <CustomerTicketCard key={t.id} ticket={t} refresh={load} />
              ))
            )}
          </div>
        </section>
        <form className="panel form" onSubmit={submit}>
          <h2>Gửi yêu cầu hỗ trợ</h2>
          <p className="muted">
            Nêu mã đơn hoặc giao dịch để được hỗ trợ nhanh hơn.
          </p>
          <label>
            Tiêu đề
            <input
              name="subject"
              required
              minLength={3}
              maxLength={120}
              placeholder="Hỗ trợ đơn KN-…"
            />
          </label>
          <label>
            Nội dung
            <textarea
              name="message"
              required
              minLength={10}
              maxLength={3000}
              rows={6}
              placeholder="Mô tả vấn đề bạn gặp phải…"
            />
          </label>
          <button className="button" disabled={busy}>
            {busy
              ? "Đang gửi…"
              : user
                ? "Gửi yêu cầu"
                : "Đăng nhập & gửi yêu cầu"}
            <ArrowUpRight size={17} />
          </button>
        </form>
      </div>
    </div>
  );
}
function ResetPassword() {
  const { notify } = useStore();
  const [completed, setCompleted] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [newPasswordValue, setNewPasswordValue] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const passwordChecks = [
    [newPasswordValue.length >= 10, '10 ký tự trở lên'],
    [/[A-Z]/.test(newPasswordValue) && /[a-z]/.test(newPasswordValue), 'Chữ hoa & thường'],
    [/\d/.test(newPasswordValue), 'Có chữ số'],
  ] as const;
  const [tokens] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    return {
      token_hash: fragment.get("token_hash") || q.get("token_hash"),
      type: fragment.get("type") || q.get("type"),
      recovery_id: q.get("recovery_id"),
    };
  });
  const validRecoveryLink =
    tokens.type === "recovery" &&
    Boolean(tokens.token_hash) &&
    Boolean(tokens.recovery_id);
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState<string | null>(null);
  const [checkingLink, setCheckingLink] = useState(validRecoveryLink);
  const [linkError, setLinkError] = useState('Liên kết thiếu thông tin hoặc đã được mở. Hãy yêu cầu email khôi phục mới từ website.');
  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
    if (!validRecoveryLink) return;
    let active = true;
    // Deferring one task lets React StrictMode cancel its first development-only
    // effect pass before it consumes this single-use recovery link.
    const timer = window.setTimeout(() => {
      post<{ ticket: string }>("/auth/reset/verify", tokens)
        .then(({ ticket: resetTicket }) => {
          if (active) setTicket(resetTicket);
        })
        .catch((error: Error) => {
          if (active) {
            setTicket(null);
            setLinkError(error.message);
          }
        })
        .finally(() => {
          if (active) setCheckingLink(false);
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !ticket || completed) return;
    const form = e.currentTarget;
    const values = new FormData(form);
    const newPassword = values.get("password");
    if (!passwordChecks.every(([met]) => met)) {
      setPasswordError('Mật khẩu mới cần đáp ứng đủ ba điều kiện bên dưới.');
      form.querySelector<HTMLInputElement>('[name="password"]')?.focus();
      return;
    }
    if (newPassword !== values.get("confirmPassword")) {
      setPasswordError('Hai mật khẩu chưa khớp. Vui lòng nhập lại.');
      form.querySelector<HTMLInputElement>('[name="confirmPassword"]')?.focus();
      return;
    }
    setPasswordError('');
    setBusy(true);
    try {
      await post(
        "/auth/reset",
        {
          ticket,
          password: newPassword,
        },
      );
      form.reset();
      setNewPasswordValue('');
      setTicket(null);
      setCompleted(true);
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={completed ? 'Mật khẩu đã được cập nhật' : 'Đặt mật khẩu mới'} className="auth-dialog recovery-dialog"
      close={() => window.location.assign(completed ? '/account' : '/')}>
      <div className="auth-layout">
        <aside className="auth-art" data-mode="login">
          <span className="auth-art-background auth-art-background-login" aria-hidden="true" />
          <span className="auth-brand"><span>//</span> KEYNEST</span>
          <div className="auth-art-copy">
            <span className="auth-kicker">TÀI KHOẢN KEYNEST</span>
            <h2>Đặt lại<br />mật khẩu.</h2>
            <p>Cập nhật mật khẩu để tiếp tục<br />sử dụng tài khoản của bạn.</p>
            <div className="auth-benefits">
              <span><Package size={16} /> Theo dõi đơn hàng đã mua</span>
              <span><Wallet size={16} /> Quản lý số dư và lịch sử ví</span>
              <span><Headphones size={16} /> Tiếp tục yêu cầu hỗ trợ</span>
            </div>
          </div>
          <span className="auth-art-caption">ELDEN RING · PC / STEAM</span>
        </aside>
        <div className="auth-content">
          <div className="auth-heading">
            <span className="auth-kicker">TÀI KHOẢN KEYNEST</span>
            <h1>{completed ? 'Đã đổi mật khẩu.' : 'Đặt mật khẩu mới'}</h1>
            <p>{completed ? 'Mật khẩu của bạn đã được cập nhật.' : 'Chọn mật khẩu chưa dùng trong 30 ngày qua và xác nhận lại bên dưới.'}</p>
          </div>
      <form className="auth-form recovery-form" onSubmit={submit}>
        {completed ? (
          <div className="recovery-complete">
            <PasswordChangeAnimation />
            <p>Dùng mật khẩu mới cho những lần đăng nhập tiếp theo.</p>
            <button type="button" className="button auth-submit" autoFocus onClick={() => window.location.assign('/account')}>
              Tiếp tục đến tài khoản <ArrowRight size={17} />
            </button>
          </div>
        ) : checkingLink ? (
          <p>Đang xác minh liên kết đặt lại mật khẩu…</p>
        ) : ticket ? (
          <>
            <div className="auth-field">
              <label htmlFor="recovery-password">Mật khẩu mới</label>
              <div className="password-control">
              <input
                id="recovery-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Nhập mật khẩu mới"
                autoComplete="new-password"
                value={newPasswordValue}
                disabled={busy}
                onChange={e => { setNewPasswordValue(e.target.value); setPasswordError(''); }}
                aria-describedby="reset-password-rules"
                required
                minLength={10}
                maxLength={128}
              />
              <button type="button" aria-label={showPassword ? 'Ẩn mật khẩu mới' : 'Hiện mật khẩu mới'} aria-pressed={showPassword} onClick={() => setShowPassword(v => !v)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </div>
            </div>
            <div id="reset-password-rules" className="password-rules">
              {passwordChecks.map(([met, label]) => (
                <span key={label} className={met ? 'met' : ''}>
                  <Check size={12} aria-hidden="true" />{label}
                </span>
              ))}
            </div>
            <div className="auth-field">
              <label htmlFor="recovery-confirmation">Nhập lại mật khẩu mới</label>
              <div className="password-control">
              <input id="recovery-confirmation" name="confirmPassword" type={showConfirmation ? 'text' : 'password'} autoComplete="new-password"
                placeholder="Nhập lại để xác nhận"
                required minLength={10} maxLength={128} disabled={busy}
                aria-invalid={!!passwordError} aria-describedby={passwordError ? 'reset-password-error' : undefined}
                onInput={() => setPasswordError('')} />
              <button type="button" aria-label={showConfirmation ? 'Ẩn mật khẩu xác nhận' : 'Hiện mật khẩu xác nhận'} aria-pressed={showConfirmation} onClick={() => setShowConfirmation(v => !v)}>{showConfirmation ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </div>
            </div>
            {passwordError && <p className="recovery-error" id="reset-password-error" role="alert">{passwordError}</p>}
            <button className="button auth-submit" disabled={busy}>
              {busy ? 'Đang cập nhật…' : 'Lưu mật khẩu'}
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          </>
        ) : (
          <p className="recovery-error" role="alert">{linkError}</p>
        )}
      </form>
          <div className="recovery-footer"><LockKeyhole size={14} /> {completed ? 'Mật khẩu cũ đã được thay thế.' : 'Liên kết chỉ dùng một lần và có hiệu lực trong 10 phút.'}</div>
        </div>
      </div>
    </Modal>
  );
}
