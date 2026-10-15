import { OrderChatButton } from './OrderChat';
import { PreorderNote } from './PreorderNote';
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { statuses } from "./api";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  Headphones,
  KeyRound,
  Landmark,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { Art, Badge, Empty, Loading, PaymentModal, useStore } from "./App";
import { api, date, money, post } from "./api";
import type { Order, OrderItem, Payment, Ticket } from "./types";

function useOrderData<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    try {
      const result = await api<T>(path, { signal: request.signal });
      if (!request.signal.aborted) {
        setData(result);
        setError("");
      }
    } catch (e) {
      if (!request.signal.aborted) setError((e as Error).message);
    }
  }, [path]);
  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => {
      clearInterval(timer);
      controller.current?.abort();
    };
  }, [load]);
  return { data, setData, error, load };
}

function OrderProduct({ item }: { item: OrderItem }) {
  const { products } = useStore();
  const product = products.find((p) => p.id === item.product_id);
  return (
    <div className="purchase-product">
      <div className="purchase-cover">
        {product ? (
          <Art product={product} poster />
        ) : item.product_image ? (
          <img src={item.product_image} alt={item.name} />
        ) : (
          <Package size={24} />
        )}
      </div>
      <div className="purchase-product-copy">
        {product ? (
          <Link to={`/products/${product.slug}`}>{item.name}</Link>
        ) : (
          <strong>{item.name}</strong>
        )}
        <span>{item.variant_name}</span>
        <small>
          Số lượng: {item.quantity} <span>·</span>{" "}
          {item.is_preorder ? 'Đặt trước' : item.delivery === "key" ? "Giao mã tự động" : "Giao dịch vụ"}
        </small>
        <PreorderNote item={item} />
      </div>
      <strong className="purchase-line-price">
        {money(item.price * item.quantity)}
      </strong>
    </div>
  );
}

function PaymentLabel({ method }: { method: string }) {
  return (
    <span className="purchase-method">
      {method === "wallet" ? <Wallet size={15} /> : <Landmark size={15} />}
      {method === "wallet" ? "Ví KEYNEST" : "Chuyển khoản ngân hàng"}
    </span>
  );
}

export function OrdersPage() {
  const { refresh, notify } = useStore();
  const location = useLocation();
  const { data: orders, error, load } = useOrderData<Order[]>("/orders");
  const [filter, setFilter] = useState("all"),
    [query, setQuery] = useState("");
  const [payment, setPayment] = useState<Payment | null>(
    location.state?.payment || null,
  );
  const [busy, setBusy] = useState("");
  const visible = orders?.filter(
    (o) =>
      (filter === "all" ||
        o.status === filter ||
        (filter === "closed" &&
          ["cancelled", "expired", "refunded"].includes(o.status))) &&
      `${o.number} ${o.items.map((i) => i.name).join(" ")}`
        .toLocaleLowerCase("vi")
        .includes(query.trim().toLocaleLowerCase("vi")),
  );
  async function cancel(order: Order) {
    setBusy(order.id);
    try {
      await post(`/orders/${order.id}/cancel`);
      await load();
      await refresh();
      notify("Đã hủy đơn hàng.");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="container page purchases-page">
      <div className="purchase-heading">
        <div>
          <Link className="purchase-back" to="/account">
            Tài khoản <ChevronRight size={13} /> Lịch sử mua hàng
          </Link>
          <h1>
            Đơn hàng của bạn<span>{orders?.length ?? "—"}</span>
          </h1>
          <p>Sản phẩm đã mua, mã kích hoạt và bảo hành — tất cả ở đây.</p>
        </div>
        <button className="button button-outline button-small" onClick={load}>
          <RefreshCw size={15} />
          Làm mới
        </button>
      </div>
      <div className="purchase-toolbar">
        <div className="purchase-filters" aria-label="Lọc trạng thái đơn hàng">
          {[
            ["all", "Tất cả"],
            ["completed", "Hoàn thành"],
            ["processing", "Đang xử lý"],
            ["pending", "Chờ thanh toán"],
            ["closed", "Đã đóng"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={filter === id ? "active" : ""}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="purchase-search">
          <Search size={16} />
          <input
            aria-label="Tìm đơn hàng"
            placeholder="Mã đơn hoặc tên sản phẩm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}{" "}
          <button className="text-button" onClick={load}>
            Thử lại
          </button>
        </p>
      )}
      {!orders ? (
        !error && <Loading />
      ) : !visible?.length ? (
        <Empty
          icon={Package}
          title={orders.length ? "Không có đơn phù hợp" : "Chưa có đơn hàng"}
          description={
            orders.length
              ? "Thử tìm tên sản phẩm khác hoặc đổi bộ lọc."
              : "Sản phẩm bạn mua sẽ xuất hiện tại đây."
          }
        >
          <Link className="button" to="/catalog">
            Khám phá cửa hàng <ArrowRight size={16} />
          </Link>
        </Empty>
      ) : (
        <div className="purchase-list">
          {visible.map((o) => (
            <article className="purchase-card" key={o.id}>
              <header>
                <div>
                  <Link to={`/orders/${o.id}`}>
                    <span>ĐƠN HÀNG</span> {o.number}
                  </Link>
                  <time dateTime={o.created_at}>{date(o.created_at)}</time>
                </div>
                <Badge status={o.status} />
              </header>
              <div className="purchase-items">
                {o.items.map((i) => (
                  <OrderProduct key={i.id} item={i} />
                ))}
              </div>
              <footer>
                <PaymentLabel method={o.method} />
                <div className="purchase-total">
                  <span>Tổng thanh toán</span>
                  <strong>{money(o.total)}</strong>
                </div>
                <div className="purchase-actions">
                  {o.status === "pending" && o.payment && (
                    <>
                      <button
                        className="text-button"
                        disabled={busy === o.id}
                        onClick={() => cancel(o)}
                      >
                        Hủy đơn
                      </button>
                      <button
                        className="button button-small"
                        onClick={() => setPayment(o.payment!)}
                      >
                        Thanh toán
                      </button>
                    </>
                  )}
                  <Link
                    className="button button-outline button-small"
                    to={`/orders/${o.id}`}
                  >
                    {o.items.some(
                      (i) => (i.delivery === "key" || i.is_preorder) && i.keys.length,
                    ) ? (
                      <>
                        <KeyRound size={15} />
                        Xem key
                      </>
                    ) : (
                      "Chi tiết đơn"
                    )}
                    <ArrowRight size={15} />
                  </Link>
                </div>
              </footer>
            </article>
          ))}
        </div>
      )}
      {payment && (
        <PaymentModal
          payment={payment}
          onClose={() => setPayment(null)}
          onPaid={() => {
            load();
            refresh();
          }}
        />
      )}
    </div>
  );
}

function WarrantyLabel({ item }: { item: OrderItem }) {
  if (item.warranty_status === "none")
    return <>Không áp dụng bảo hành theo ngày</>;
  if (item.warranty_status === "verify")
    return <>Đơn cũ · Cần kiểm tra thời hạn</>;
  if (item.warranty_status === "unavailable")
    return <>Chưa có sản phẩm đủ điều kiện bảo hành</>;
  return (
    <>
      {item.warranty_status === "expired"
        ? "Đã hết hạn"
        : `Bảo hành ${item.warranty_days} ngày`}{" "}
      · {item.warranty_status === "active" ? "Đến " : ""}
      {date(item.warranty_expires_at!)}
    </>
  );
}

function Warranty({
  order,
  onCreated,
}: {
  order: Order;
  onCreated: (ticket: Ticket) => void;
}) {
  const { notify } = useStore();
  const eligible = order.items.filter((i) =>
    ["active", "verify"].includes(i.warranty_status),
  );
  const [selected, setSelected] = useState<string[]>(() =>
    eligible.flatMap((i) => i.key_ids),
  );
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const requests = order.warranty_requests || [];
  const open = requests.some((t) => ["open", "in_progress"].includes(t.status));
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!selected.length || open || busy) return;
    setBusy(true);
    setError("");
    try {
      const ticket = await post<Ticket>(`/orders/${order.id}/warranty`, {
        key_ids: selected,
        message: message.trim(),
      });
      onCreated(ticket);
      setMessage("");
      notify("Đã gửi yêu cầu bảo hành.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="order-section warranty-section"
      aria-labelledby="warranty-title"
    >
      <div className="order-section-title">
        <h2 id="warranty-title">
          <ShieldCheck size={20} />
          Bảo hành sản phẩm
        </h2>
        <span>Hỗ trợ sau mua</span>
      </div>
      <p className="order-section-intro">
        Chọn sản phẩm hoặc lượt dịch vụ gặp vấn đề và mô tả lỗi. Phản hồi từ cửa
        hàng sẽ hiển thị ngay trong đơn này.
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={busy || open}>
          <legend className="sr-only">Sản phẩm cần bảo hành</legend>
          <div className="warranty-products">
            {order.items.map((item) => (
              <div className="warranty-product" key={item.id}>
                <div>
                  <strong>
                    {item.name} <span>· {item.variant_name}</span>
                  </strong>
                  <small className={`warranty-state ${item.warranty_status}`}>
                    <WarrantyLabel item={item} />
                  </small>
                </div>
                {item.key_ids.map((id, index) => (
                  <label className="warranty-choice" key={id}>
                    <input
                      type="checkbox"
                      disabled={
                        !["active", "verify"].includes(item.warranty_status)
                      }
                      checked={selected.includes(id)}
                      onChange={(e) =>
                        setSelected((ids) =>
                          e.target.checked
                            ? [...ids, id]
                            : ids.filter((x) => x !== id),
                        )
                      }
                    />
                    {item.delivery === "key" ? (
                      <KeyRound size={14} />
                    ) : (
                      <Package size={14} />
                    )}
                    <span>
                      {item.delivery === "key" ? "Mã" : "Lượt dịch vụ"} #
                      {index + 1}
                    </span>
                  </label>
                ))}
              </div>
            ))}
          </div>
          {eligible.some((i) => i.warranty_status === "verify") && (
            <p className="warranty-help">
              Đơn cũ chưa ghi nhận đủ thông tin bảo hành. Bạn vẫn có thể gửi yêu
              cầu để cửa hàng kiểm tra.
            </p>
          )}
          {!!eligible.length && !open && (
            <>
              <label className="warranty-message">
                Mô tả vấn đề
                <textarea
                  placeholder="Ví dụ: Mã báo đã sử dụng khi kích hoạt trên Steam. Mình gặp lỗi lúc…"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  minLength={10}
                  maxLength={3000}
                  required
                />
              </label>
              <div className="warranty-submit">
                <small>Không gửi mật khẩu đăng nhập hoặc mã OTP.</small>
                <button
                  className="button button-small"
                  disabled={
                    busy || !selected.length || message.trim().length < 10
                  }
                >
                  {busy ? "Đang gửi…" : "Gửi yêu cầu bảo hành"}
                  <ArrowRight size={15} />
                </button>
              </div>
            </>
          )}
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
      {open && (
        <div className="warranty-pending">
          <Clock3 size={17} />
          <span>
            Yêu cầu đã được tiếp nhận. Cửa hàng đang kiểm tra sản phẩm của bạn.
          </span>
        </div>
      )}
      {requests.length > 0 && (
        <div className="warranty-history">
          <h3>Yêu cầu đã gửi</h3>
          {requests.map((t) => (
            <article key={t.id}>
              <div>
                <time dateTime={t.created_at}>{date(t.created_at)}</time>
                <Badge status={t.status} />
              </div>
              <p>{t.message}</p>
              {t.reply && (
                <div className="warranty-reply">
                  <strong>KEYNEST phản hồi</strong>
                  <p>{t.reply}</p>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      <details className="warranty-policy">
        <summary>Thời hạn bảo hành được tính thế nào?</summary>
        <p>
          Thời hạn được lưu theo gói tại lúc mua, bắt đầu khi sản phẩm được
          giao. Mỗi gói trong cùng đơn có thể có thời hạn khác nhau. Đơn đã hoàn
          tiền không nhận yêu cầu bảo hành mới. Với vấn đề khác hoặc gói không
          áp dụng bảo hành theo ngày, vui lòng{" "}
          <Link to="/support">liên hệ hỗ trợ</Link>.
        </p>
      </details>
    </section>
  );
}

export function OrderDetailPage() {
  const { id = "" } = useParams();
  return <OrderDetails key={id} id={id} />;
}

function OrderDetails({ id }: { id: string }) {
  const {
    data: order,
    setData,
    error,
    load,
  } = useOrderData<Order>(`/orders/${id}`);
  const { notify, refresh } = useStore();
  const [payment, setPayment] = useState<Payment | null>(null);
  const [copied, setCopied] = useState("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(""), 2000);
    } catch {
      notify(
        "Không thể sao chép tự động. Bạn có thể chọn và sao chép nội dung mã.",
        true,
      );
    }
  }
  if (!order)
    return (
      <div className="container page purchases-page">
        <Link className="purchase-back" to="/orders">
          <ArrowLeft size={15} />
          Đơn hàng của bạn
        </Link>
        {error ? (
          <Empty
            icon={Package}
            title="Không thể mở đơn hàng"
            description={error}
          >
            <button className="button button-outline" onClick={load}>
              Thử lại
            </button>
          </Empty>
        ) : (
          <Loading />
        )}
      </div>
    );
  const paid = ["processing", "completed", "refunded"].includes(order.status);
  const stopped = ["cancelled", "expired", "refunded"].includes(order.status);
  const steps = [
    { title: "Đặt hàng", time: order.created_at, done: true, icon: Package },
    { title: "Thanh toán", time: order.paid_at, done: paid, icon: Wallet },
    {
      title: "Giao sản phẩm",
      time: null,
      done: !!order.completed_at || order.status === "completed",
      icon: KeyRound,
    },
    {
      title: "Hoàn thành",
      time: order.completed_at,
      done: !!order.completed_at || order.status === "completed",
      icon: CheckCircle2,
    },
  ];
  return (
    <div className="container page purchases-page order-detail-page">
      <div className="purchase-heading">
        <div>
          <Link className="purchase-back" to="/orders">
            <ArrowLeft size={15} />
            Đơn hàng của bạn
          </Link>
          <h1>Chi tiết đơn hàng</h1>
        </div>
        <Badge status={order.status} />
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}{" "}
          <button className="text-button" onClick={load}>
            Thử lại
          </button>
        </p>
      )}
      <div className="order-detail-layout">
        <aside className="order-summary-column">
          <section className="order-section order-summary">
            <div className="order-reference">
              <span>MÃ ĐƠN HÀNG</span>
              <strong>{order.number}</strong>
            </div>
            <div className="purchase-items">
              {order.items.map((i) => (
                <OrderProduct key={i.id} item={i} />
              ))}
            </div>
            <dl>
              <div>
                <dt>Ngày mua</dt>
                <dd>{date(order.created_at)}</dd>
              </div>
              {order.completed_at && (
                <div>
                  <dt>Hoàn thành</dt>
                  <dd>{date(order.completed_at)}</dd>
                </div>
              )}
              <div>
                <dt>Thanh toán</dt>
                <dd>
                  <PaymentLabel method={order.method} />
                </dd>
              </div>
              <div>
                <dt>Tạm tính</dt>
                <dd>{money(order.subtotal)}</dd>
              </div>
              {order.discount > 0 && (
                <div>
                  <dt>Giảm giá</dt>
                  <dd className="purchase-discount">
                    −{money(order.discount)}
                  </dd>
                </div>
              )}
              <div className="order-grand-total">
                <dt>Tổng thanh toán</dt>
                <dd>{money(order.total)}</dd>
              </div>
            </dl>
            {order.status === "pending" && order.payment && (
              <button
                className="button full"
                onClick={() => setPayment(order.payment!)}
              >
                Thanh toán đơn hàng
                <ArrowRight size={16} />
              </button>
            )}
            {order.customer_note && (
              <div className="order-customer-note">
                <small>Thông tin giao dịch vụ</small>
                <p>{order.customer_note}</p>
              </div>
            )}
          </section>
          <section className="order-help">
            <Headphones size={22} />
            <div>
              <h3>Cần hỗ trợ thêm?</h3>
              <p>Trao đổi với cửa hàng về đơn {order.number}.</p>
              <Link to="/support">
                Liên hệ hỗ trợ <ArrowRight size={14} />
              </Link>
            </div>
          </section>
        </aside>
        <div className="order-content-column">
          <section
            className="order-section order-progress"
            aria-label="Tiến trình đơn hàng"
          >
            <ol>
              {steps.map((step, index) => (
                <li
                  key={step.title}
                  className={
                    step.done
                      ? "done"
                      : !stopped && index === steps.findIndex((s) => !s.done)
                        ? "current"
                        : ""
                  }
                >
                  <span className="order-step-icon">
                    {step.done ? <Check size={17} /> : <step.icon size={17} />}
                  </span>
                  <div>
                    <strong>{step.title}</strong>
                    <small>
                      {step.time
                        ? date(step.time)
                        : step.done
                          ? "Đã xong"
                          : stopped
                            ? "—"
                            : index === steps.findIndex((s) => !s.done)
                              ? "Đang chờ"
                              : "Chưa đến bước này"}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
            {stopped && (
              <p className="order-stopped">
                {order.status === "refunded"
                  ? order.refund_method === "external"
                    ? `Cửa hàng đã xác nhận hoàn tiền bên ngoài${order.refund_reference ? ` · Mã giao dịch: ${order.refund_reference}` : ""}.`
                    : "Đơn đã được hoàn tiền vào ví KEYNEST."
                  : order.status === "expired"
                    ? "Đơn đã hết thời gian thanh toán."
                    : "Đơn hàng đã hủy."}
              </p>
            )}
          </section>
          <section
            className="order-section order-delivery"
            aria-labelledby="delivery-title"
          >
            <div className="order-section-title">
              <h2 id="delivery-title">
                <KeyRound size={20} />
                {order.items.every((i) => i.delivery === "manual" && !i.is_preorder)
                  ? "Kết quả xử lý dịch vụ"
                  : "Sản phẩm đã mua"}
              </h2>
              <Link to="/guide">
                Hướng dẫn
                <ChevronRight size={14} />
              </Link>
            </div>
            {order.items.map((item) => (
              <div className="order-delivery-item" key={item.id}>
                {item.seller_id && <OrderChatButton itemId={item.id} />}
                <div className="order-delivery-label">
                  <strong>{item.name}</strong>
                  <span>{item.variant_name}</span>
                </div>
                {item.delivery === "manual" && !(item.is_preorder && item.delivered_at) ? (
                  <div className="service-delivery-result">
                    <p>
                      <strong>
                        {item.delivered_at
                          ? (item.is_preorder ? 'Đã giao sản phẩm đặt trước' : "Đã hoàn tất dịch vụ")
                          : order.status === "pending"
                            ? "Chờ thanh toán"
                            : order.status === "processing"
                              ? (item.is_preorder ? 'Đã thanh toán · Chờ giao hàng đặt trước' : "Đang xử lý dịch vụ")
                              : "Trạng thái: " + statuses[order.status]}
                      </strong>
                    </p>
                    <PreorderNote item={item} />
                    {!item.is_preorder && <p className="muted">
                      Sản phẩm nạp/dịch vụ được xử lý theo thông tin đặt hàng,
                      không có mã kích hoạt.
                    </p>}
                    {order.customer_note && (
                      <p className="pre-wrap">
                        <strong>Thông tin đã cung cấp: </strong>
                        {order.customer_note}
                      </p>
                    )}
                    {item.keys.map((result, index) => (
                      <p className="pre-wrap" key={index}>
                        <strong>Kết quả {index + 1}: </strong>
                        {result}
                      </p>
                    ))}
                  </div>
                ) : item.keys.length ? (
                  item.keys.map((value, n) => (
                    <div className="delivered-key" key={item.key_ids[n] || n}>
                      <span className="key-number">
                        {String(n + 1).padStart(2, "0")}
                      </span>
                      <code>{value}</code>
                      <button
                        className="icon-button"
                        aria-label={`Sao chép mã ${n + 1} của ${item.name}`}
                        onClick={() => copy(value, `${item.id}-${n}`)}
                      >
                        {copied === `${item.id}-${n}` ? (
                          <Check size={16} />
                        ) : (
                          <Copy size={16} />
                        )}
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="delivery-waiting">
                    <Clock3 size={17} />
                    {order.status === "processing"
                      ? "Cửa hàng đang chuẩn bị thông tin dịch vụ cho bạn."
                      : order.status === "pending"
                        ? "Mã sản phẩm sẽ xuất hiện sau khi thanh toán."
                        : stopped
                          ? "Không có mã khả dụng cho đơn này."
                          : "Chưa có thông tin giao hàng. Vui lòng liên hệ hỗ trợ."}
                  </p>
                )}
              </div>
            ))}
            {order.items.some((i) => (i.delivery === "key" || i.is_preorder) && i.keys.length) && (
              <p className="order-key-note">
                <ShieldCheck size={14} />
                Giữ riêng mã và thông tin tài khoản. Nhấn biểu tượng để sao
                chép.
              </p>
            )}
            <span className="sr-only" role="status">
              {copied ? "Đã sao chép mã" : ""}
            </span>
          </section>
          <Warranty
            order={order}
            onCreated={(ticket) =>
              setData((current) =>
                current
                  ? {
                      ...current,
                      warranty_requests: [
                        ticket,
                        ...(current.warranty_requests || []),
                      ],
                    }
                  : current,
              )
            }
          />
        </div>
      </div>
      {payment && (
        <PaymentModal
          payment={payment}
          onClose={() => setPayment(null)}
          onPaid={() => {
            load();
            refresh();
          }}
        />
      )}
    </div>
  );
}
