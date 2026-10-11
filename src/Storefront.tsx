import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  Copy,
  Gamepad2,
  Gift,
  Headphones,
  KeyRound,
  Package,
  Server,
  ShieldCheck,
  Smartphone,
  TicketPercent,
  Wallet,
} from "lucide-react";
import { api, categories, date, money } from "./api";
import { Empty, ProductCard, useStore } from "./App";
import type { Category, Coupon } from "./types";
import { BannerSlider } from "./Banners";
import { catalogHref, productGroup, readRecent } from "./discovery";

export function Home() {
  const { products, notify } = useStore();
  const [category, setCategory] = useState<Category>("all");
  const [promotions, setPromotions] = useState<Coupon[]>([]);
  const [offerIndex, setOfferIndex] = useState(0);
  const [offerFocused, setOfferFocused] = useState(false);
  const [offerHidden, setOfferHidden] = useState(document.hidden);
  const [reduceMotion, setReduceMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => setReduceMotion(media.matches);
    const visibility = () => setOfferHidden(document.hidden);
    media.addEventListener('change', motion);
    document.addEventListener('visibilitychange', visibility);
    return () => { media.removeEventListener('change', motion); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => {
    api<Coupon[]>("/promotions")
      .then(setPromotions)
      .catch(() => {});
  }, []);
  const selected = products
    .filter((p) => category === "all" || p.category === category)
    .slice(0, 6);
  const cheap = products
    .filter((p) => p.variants.some((v) => v.price <= 200000))
    .slice(0, 6);
  const recent = readRecent()
    .map((slug) => products.find((p) => p.slug === slug))
    .filter((p) => p !== undefined)
    .slice(0, 6);
  const pinnedOffers = promotions.filter((c) => c.pinned);
  const offers = pinnedOffers.length ? pinnedOffers : promotions.slice(0, 1);
  const promotion = offers[offerIndex % (offers.length || 1)];
  useEffect(() => {
    if (offers.length < 2 || offerFocused || offerHidden || reduceMotion) return;
    const timer = window.setTimeout(() => setOfferIndex(i => (i + 1) % offers.length), 8000);
    return () => window.clearTimeout(timer);
  }, [offers.length, offerIndex, offerFocused, offerHidden, reduceMotion]);
  const icons: Record<string, typeof Package> = { game: Gamepad2, gift: Gift, topup: Smartphone, mmo: Server };
  const groups = Object.keys(categories).filter((c) => c !== 'all').map((category) => ({ category, icon: icons[category] || Package }));
  return (
    <div className="container home storefront">
      <div className="store-heading">
        <div>
          <span className="store-kicker">PLAY MORE. DISCOVER MORE.</span>
          <h1>Khám phá</h1>
          <p>Game yêu thích. Dịch vụ bạn cần.</p>
        </div>
        <Link className="store-guide-link" to="/guide">
          <BookOpen size={17} />
          Lần đầu mua hàng?
          <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="campaign-layout">
        <BannerSlider />
        <div className="campaign-side">
          <Link className="campaign-gift" to="/catalog?category=gift">
            <span>GIFT CARDS</span>
            <Gift size={50} strokeWidth={1.1} />
            <div>
              <h2>
                Một món quà.
                <br />
                Nhiều lựa chọn.
              </h2>
              <p>Steam Wallet · Xbox</p>
              <span>
                Chọn thẻ ngay
                <ArrowRight size={16} />
              </span>
            </div>
          </Link>
          <Link className="campaign-service" to="/catalog?category=mmo">
            <div>
              <span>MMO & PROXY</span>
              <h2>
                Công cụ cho
                <br />
                ngày làm việc.
              </h2>
              <p>Proxy dân cư & IPv4 riêng</p>
            </div>
            <Server size={44} strokeWidth={1} />
            <ArrowUpRight size={19} />
          </Link>
        </div>
      </div>
      <div className="store-benefits">
        <span>
          <KeyRound size={19} />
          <span>
            <strong>Key tự động</strong>
            <small>Sau khi xác nhận thanh toán</small>
          </span>
        </span>
        <span>
          <Wallet size={19} />
          <span>
            <strong>Ví & ngân hàng</strong>
            <small>Theo dõi giao dịch trong tài khoản</small>
          </span>
        </span>
        <span>
          <Package size={19} />
          <span>
            <strong>Đơn hàng tập trung</strong>
            <small>Nhận mã và theo dõi dịch vụ</small>
          </span>
        </span>
        <Link to="/support">
          <Headphones size={19} />
          <span>
            <strong>Hỗ trợ đơn hàng</strong>
            <small>Gửi yêu cầu ngay trên website</small>
          </span>
          <ChevronRight size={15} />
        </Link>
      </div>
      <section className="home-section directory-section">
        <div className="section-title">
          <div>
            <span className="store-kicker">BẮT ĐẦU TỪ ĐÂY</span>
            <h2>Bạn đang tìm gì?</h2>
          </div>
          <Link to="/catalog">
            Toàn bộ cửa hàng
            <ArrowRight size={16} />
          </Link>
        </div>
        <div className="category-directory">
          {groups.map(({ category: c, icon: Icon }) => {
            const items = products.filter((p) => p.category === c);
            return (
              <article key={c}>
                <Link
                  className="directory-title"
                  to={catalogHref({ category: c })}
                >
                  <Icon size={23} />
                  <strong>{categories[c]}</strong>
                  <ArrowUpRight size={17} />
                </Link>
                <div>
                  {[...new Set(items.map(productGroup))]
                    .slice(0, 4)
                    .map((group) => (
                      <Link
                        key={group}
                        to={catalogHref({ category: c, sub: group })}
                      >
                        {group}
                        <ChevronRight size={13} />
                      </Link>
                    ))}
                </div>
                <Link
                  className="directory-count"
                  to={catalogHref({ category: c })}
                >
                  {items.length} sản phẩm
                  <ArrowRight size={13} />
                </Link>
              </article>
            );
          })}
        </div>
      </section>
      {promotion && (
        <div className="offer-strip" role="region" aria-label="Mã giảm giá được ghim"
          onPointerDown={() => setOfferFocused(false)}
          onFocusCapture={e => setOfferFocused(e.target.matches(':focus-visible'))}
          onKeyDown={e => { if (e.key === 'Tab') setOfferFocused(true); }}
          onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOfferFocused(false); }}>
          <TicketPercent size={25} />
          <div className="offer-slide" key={promotion.code}>
            <strong>Thêm một ưu đãi cho đơn hàng của bạn</strong>
            <p>
              Giảm{" "}
              {promotion.discount_type === "fixed"
                ? money(promotion.fixed_amount || 0)
                : `${promotion.percent}%, tối đa ${money(promotion.max_discount)}`}{" "}
              với mã <b>{promotion.code}</b>
            </p>
          </div>
          <button
            onClick={() =>
              navigator.clipboard
                .writeText(promotion.code)
                .then(() => notify("Đã sao chép mã giảm giá."))
                .catch(() => notify("Không thể sao chép.", true))
            }
          >
            <Copy size={15} />
            Sao chép mã
          </button>
          <Link to="/promotions">
            Tất cả ưu đãi
            <ArrowRight size={15} />
          </Link>
          {offers.length > 1 && <div className="offer-pagination" aria-label="Chọn mã giảm giá">
            {offers.map((offer, i) => <button key={offer.code} type="button"
              aria-label={`Xem mã ${offer.code}`} aria-pressed={offerIndex % offers.length === i}
              onClick={() => setOfferIndex(i)}><span /></button>)}
          </div>}
        </div>
      )}
      <section className="home-section">
        <div className="section-title">
          <h2>Sản phẩm nổi bật</h2>
          <Link to="/catalog">
            Xem tất cả
            <ArrowRight size={16} />
          </Link>
        </div>
        <div className="category-tabs">
          {(Object.keys(categories) as Category[]).map((c) => (
            <button
              key={c}
              className={category === c ? "active" : ""}
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
            >
              {categories[c]}
              <span>
                {products.filter((p) => c === "all" || p.category === c).length}
              </span>
            </button>
          ))}
        </div>
        <div className="product-grid">
          {selected.map((p) => (
            <ProductCard product={p} key={p.id} />
          ))}
        </div>
        {!selected.length && (
          <p className="muted">Danh mục đang cập nhật sản phẩm.</p>
        )}
      </section>
      <section className="home-section budget-section">
        <div className="section-title">
          <h2>Dưới 200.000đ</h2>
          <Link to="/catalog?max=200000">
            Xem tất cả
            <ArrowRight size={16} />
          </Link>
        </div>
        <div className="product-grid">
          {cheap.map((p) => (
            <ProductCard product={p} key={p.id} />
          ))}
        </div>
      </section>
      {recent.length > 0 && (
        <section className="home-section recently-viewed">
          <div className="section-title">
            <div>
              <h2>Sản phẩm vừa xem</h2>
              <p className="muted">Lịch sử xem trên trình duyệt này.</p>
            </div>
            <Link to="/catalog">
              Tiếp tục khám phá
              <ArrowRight size={16} />
            </Link>
          </div>
          <div className="product-grid">
            {recent.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
      <div className="store-help">
        <Gamepad2 size={22} />
        <p>Chưa tìm được sản phẩm phù hợp?</p>
        <Link to="/support">
          Gửi câu hỏi cho KEYNEST
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
}

export function PromotionsPage() {
  const { notify } = useStore();
  const [promotions, setPromotions] = useState<Coupon[] | null>(null);
  const [error, setError] = useState("");
  const load = () => {
    setError("");
    api<Coupon[]>("/promotions")
      .then(setPromotions)
      .catch((e) => setError(e.message));
  };
  useEffect(() => {
    load();
  }, []);
  return (
    <div className="container page promotions-page">
      <div className="breadcrumb">
        <Link to="/">Cửa hàng</Link>
        <ChevronRight size={13} />
        Ưu đãi
      </div>
      <div className="page-heading">
        <div>
          <span className="eyebrow orange">ƯU ĐÃI KEYNEST</span>
          <h1>Thêm game. Tiết kiệm hơn.</h1>
          <p>Sao chép mã và nhập tại giỏ hàng trước khi thanh toán.</p>
        </div>
        <TicketPercent size={38} />
      </div>
      {error ? (
        <div role="alert" className="panel">
          <p>{error}</p>
          <button className="button button-outline" onClick={load}>
            Thử lại
          </button>
        </div>
      ) : !promotions ? (
        <p role="status">Đang tải ưu đãi…</p>
      ) : promotions.length ? (
        <div className="coupon-grid">
          {promotions.map((c) => (
            <article className="coupon-card" key={c.code}>
              {c.pinned && (
                <span className="eyebrow orange coupon-pinned">Ưu đãi được ghim</span>
              )}
              <div className="coupon-heading">
                <TicketPercent size={23} />
                <span>MÃ GIẢM GIÁ</span>
              </div>
              <h2>
                Giảm{" "}
                {c.discount_type === "fixed"
                  ? money(c.fixed_amount || 0)
                  : `${c.percent}%`}
              </h2>
              <p>
                {c.discount_type !== "fixed" && (
                  <>
                    Tối đa <strong>{money(c.max_discount)}</strong>.{" "}
                  </>
                )}
                Đơn từ {money(c.min_subtotal || 0)}.
              </p>
              <p className="coupon-conditions">
                {categories[c.category || "all"]}
                {c.product_ids?.length
                  ? ` · ${c.product_ids.length} sản phẩm được chọn`
                  : ""}
                {c.per_user_limit ? ` · ${c.per_user_limit} lần/tài khoản` : ""}
                {c.first_order_only ? " · Đơn đầu tiên" : ""}
                {c.total_limit
                  ? ` · Còn ${Math.max(0, c.total_limit - (c.used_count || 0) - (c.reserved_count || 0))} lượt`
                  : ""}
              </p>
              <div className="coupon-code">
                <code>{c.code}</code>
                <button
                  aria-label={`Sao chép mã ${c.code}`}
                  onClick={() =>
                    navigator.clipboard
                      .writeText(c.code)
                      .then(() => notify("Đã sao chép mã giảm giá."))
                      .catch(() => notify("Không thể sao chép.", true))
                  }
                >
                  <Copy size={17} />
                </button>
              </div>
              <small>
                {c.expires_at
                  ? `Hết hạn: ${date(c.expires_at)}`
                  : "Chưa đặt ngày kết thúc"}
              </small>
              <Link to="/catalog">
                Chọn sản phẩm
                <ArrowRight size={15} />
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title="Chưa có mã ưu đãi"
          description="Các mã mới sẽ xuất hiện tại đây khi được cửa hàng phát hành."
        />
      )}
      <Link className="sale-collection" to="/catalog?sale=1">
        <div>
          <h2>Sản phẩm đang giảm giá</h2>
          <p>Xem giá và các phiên bản hiện có trong cửa hàng.</p>
        </div>
        <ArrowRight size={25} />
      </Link>
    </div>
  );
}

export function GuidePage() {
  return (
    <div className="container page guide-page">
      <div className="breadcrumb">
        <Link to="/">Cửa hàng</Link>
        <ChevronRight size={13} />
        Hướng dẫn
      </div>
      <div className="page-heading">
        <div>
          <span className="eyebrow orange">MUA HÀNG TẠI KEYNEST</span>
          <h1>Từ chọn game đến nhận key.</h1>
          <p>Những điều cần biết cho đơn hàng đầu tiên của bạn.</p>
        </div>
        <BookOpen size={38} />
      </div>
      <div className="guide-steps">
        {[
          {
            icon: Gamepad2,
            title: "Chọn đúng sản phẩm",
            text: "Kiểm tra nền tảng, khu vực kích hoạt và phiên bản. Với dịch vụ nạp game, đọc kỹ thông tin UID và máy chủ cần cung cấp.",
            to: "/catalog",
            cta: "Khám phá cửa hàng",
          },
          {
            icon: Wallet,
            title: "Chọn cách thanh toán",
            text: "Đăng nhập, kiểm tra giỏ hàng và nhập mã ưu đãi. Thanh toán bằng số dư ví hoặc tạo mã chuyển khoản ngân hàng. Chuyển đúng số tiền và nội dung hiển thị trên đơn.",
            to: "/wallet",
            cta: "Ví & nạp tiền",
          },
          {
            icon: KeyRound,
            title: "Nhận mã hoặc dịch vụ",
            text: "Key tự động xuất hiện trong chi tiết đơn hàng sau khi thanh toán được xác nhận. Đơn nạp game và proxy được quản trị viên xử lý, bạn có thể theo dõi trạng thái tại mục đơn hàng.",
            to: "/orders",
            cta: "Đơn hàng của tôi",
          },
        ].map((step, i) => (
          <article key={step.title}>
            <span className="guide-step-number">0{i + 1}</span>
            <step.icon size={29} />
            <h2>{step.title}</h2>
            <p>{step.text}</p>
            <Link to={step.to}>
              {step.cta}
              <ArrowRight size={16} />
            </Link>
          </article>
        ))}
      </div>
      <section className="guide-notes">
        <ShieldCheck size={25} />
        <div>
          <h2>Trước khi xác nhận thanh toán</h2>
          <ul>
            <li>
              Key sai khu vực có thể không kích hoạt được. Đối chiếu với khu vực
              tài khoản game của bạn.
            </li>
            <li>
              Không gửi mật khẩu game trong ghi chú đơn hàng hoặc yêu cầu hỗ
              trợ.
            </li>
            <li>
              Đã chuyển khoản nhưng trạng thái chưa cập nhật: giữ mã đơn hàng và
              gửi yêu cầu hỗ trợ để đối soát.
            </li>
            <li>
              Trong bản demo, tiền, key và thanh toán đều là dữ liệu mô phỏng
              cho đồ án.
            </li>
          </ul>
          <Link to="/support">
            Gửi yêu cầu hỗ trợ
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>
    </div>
  );
}
