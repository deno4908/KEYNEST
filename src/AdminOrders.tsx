import { useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Copy,
  KeyRound,
  Landmark,
  Package,
  Search,
  ShieldCheck,
  UserRound,
  Wallet,
} from "lucide-react";
import { Art, Badge, Modal, useStore } from "./App";
import { date, money, post } from "./api";
import type { Order, Overview } from "./types";

export function AdminOrderList({
  orders,
  data,
  onOpen,
}: {
  orders: Order[];
  data: Overview;
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const rows = orders.filter((o) => {
    const u = data.users.find((u) => u.id === o.user_id);
    return `${o.number} ${u?.name} ${u?.email} ${o.items.map((i) => i.name).join(" ")}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
  });
  return (
    <div className="admin-order-list">
      <div className="admin-tools">
        <label>
          <Search size={16} />
          <input
            aria-label="Tìm đơn quản trị"
            placeholder="Mã đơn, khách hàng, email, sản phẩm…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <small>{rows.length} đơn hàng</small>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Đơn hàng</th>
              <th>Người mua</th>
              <th>Sản phẩm</th>
              <th>Thanh toán</th>
              <th>Trạng thái</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const u = data.users.find((u) => u.id === o.user_id);
              return (
                <tr key={o.id}>
                  <td>
                    <strong>{o.number}</strong>
                    <small>{date(o.created_at)}</small>
                  </td>
                  <td>
                    <strong>{u?.name || "Khách hàng"}</strong>
                    <small>{u?.email}</small>
                  </td>
                  <td>
                    <strong>{o.items[0]?.name}</strong>
                    <small>
                      {o.items.length > 1
                        ? `+ ${o.items.length - 1} sản phẩm khác`
                        : `${o.items[0]?.variant_name} ×${o.items[0]?.quantity}`}
                    </small>
                  </td>
                  <td>
                    <strong>{money(o.total)}</strong>
                    <small>
                      {o.method === "wallet" ? "Ví KEYNEST" : "Ngân hàng"}
                    </small>
                  </td>
                  <td>
                    <Badge status={o.status} />
                  </td>
                  <td>
                    <button
                      className="button button-outline button-small"
                      onClick={() => onOpen(o.id)}
                    >
                      Chi tiết
                      <ArrowRight size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && (
          <p className="admin-empty-line">Không có đơn hàng phù hợp.</p>
        )}
      </div>
    </div>
  );
}
export function AdminOrderDialog({
  order,
  data,
  close,
  saved,
  onTicket,
}: {
  order: Order;
  data: Overview;
  close: () => void;
  saved: () => Promise<void>;
  onTicket: (id: string) => void;
}) {
  const { notify } = useStore();
  const user = data.users.find((u) => u.id === order.user_id);
  const warranties = data.tickets.filter(
    (t) => t.kind === "warranty" && t.order_id === order.id,
  );
  const [mode, setMode] = useState<"wallet" | "external">("wallet"),
    [ticket, setTicket] = useState(warranties[0]?.id || ""),
    [refundOpen, setRefundOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const manual = order.items.filter((i) => i.delivery === "manual" && !i.delivered_at),
    count = manual.reduce((n, i) => n + i.quantity, 0);
  async function fulfill(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await post(`/admin/orders/${order.id}/fulfill`, {
        secrets: String(f.get("secrets"))
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      await saved();
      notify("Đã giao dịch vụ cho khách.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refund(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await post(`/admin/orders/${order.id}/refund`, {
        ticket_id: ticket,
        method: mode,
        reason: f.get("reason"),
        reference: f.get("reference") || "",
      });
      await saved();
      setRefundOpen(false);
      notify(
        mode === "wallet"
          ? "Đã hoàn tiền vào ví khách hàng."
          : "Đã ghi nhận khoản hoàn bên ngoài.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`Chi tiết ${order.number}`}
      close={close}
      wide
      className="admin-dialog admin-order-dialog"
    >
      <div className="admin-order-dialog-header">
        <div>
          <span>Đặt lúc {date(order.created_at)}</span>
          <small>{order.id}</small>
        </div>
        <Badge status={order.status} />
      </div>
      <div className="admin-order-columns">
        <main>
          <section className="admin-detail-section">
            <h3>
              <Package size={17} />
              Sản phẩm đã mua
            </h3>
            {order.items.map((i) => {
              const p = data.products.find((p) => p.id === i.product_id);
              return (
                <div className="admin-purchased-item" key={i.id}>
                  <div className="admin-purchased-line">
                    <div className="purchase-cover">
                      {p ? <Art product={p} poster /> : <Package size={20} />}
                    </div>
                    <div>
                      <strong>{i.name}</strong>
                      <small>
                        {i.variant_name} · Số lượng {i.quantity}
                      </small>
                      <small>
                        {i.delivery === "key"
                          ? "Giao mã tự động"
                          : "Giao dịch vụ"}
                        {i.delivered_at ? ` · ${date(i.delivered_at)}` : ""}
                      </small>
                    </div>
                    <strong>{money(i.price * i.quantity)}</strong>
                  </div>
                  {i.keys.length > 0 && (
                    <details className="admin-key-details">
                      <summary>
                        <KeyRound size={14} />
                        {i.delivery === "key"
                          ? `Xem ${i.keys.length} mã đã giao`
                          : `Xem ${i.keys.length} kết quả xử lý dịch vụ`}
                      </summary>
                      {i.keys.map((k, n) => (
                        <div className="admin-delivered-key" key={n}>
                          <code>{k}</code>
                          <button
                            className="icon-button"
                            aria-label={`Sao chép mã ${n + 1}`}
                            onClick={() =>
                              navigator.clipboard
                                .writeText(k)
                                .then(() => notify("Đã sao chép."))
                                .catch(() =>
                                  notify("Không thể sao chép.", true),
                                )
                            }
                          >
                            <Copy size={14} />
                          </button>
                        </div>
                      ))}
                    </details>
                  )}
                  <small className="admin-warranty-line">
                    {i.warranty_days === null
                      ? "Thời hạn bảo hành cần xác minh"
                      : i.warranty_days > 0
                        ? `Bảo hành ${i.warranty_days} ngày${i.warranty_expires_at ? ` · Đến ${date(i.warranty_expires_at)}` : " từ khi giao"}`
                        : "Không bảo hành theo ngày"}
                  </small>
                </div>
              );
            })}
          </section>
          {order.customer_note && (
            <section className="admin-detail-section">
              <h3>Thông tin khách cung cấp</h3>
              <p className="pre-wrap">{order.customer_note}</p>
            </section>
          )}
          {order.status === "processing" && (
            <section className="admin-detail-section">
              <h3>
                <KeyRound size={17} />
                Giao dịch vụ
              </h3>
              <p>
                Sau khi thực hiện nạp/dịch vụ, nhập {count} kết quả xác nhận,
                mỗi dòng cho một đơn vị theo thứ tự dưới đây.
              </p>
              <ol className="manual-delivery-order">
                {manual.map((i) => (
                  <li key={i.id}>
                    {i.name} · {i.variant_name} ×{i.quantity}
                  </li>
                ))}
              </ol>
              <form className="form" onSubmit={fulfill}>
                <label>
                  Kết quả xử lý (không phải key)
                  <textarea
                    name="secrets"
                    rows={4}
                    required
                    placeholder="Ví dụ: Đã nạp thành công vào UID …, máy chủ …"
                  />
                </label>
                <button className="button button-small" disabled={busy}>
                  Xác nhận hoàn tất {count} lượt dịch vụ
                </button>
              </form>
            </section>
          )}
          <section className="admin-detail-section">
            <h3>
              <ShieldCheck size={17} />
              Bảo hành & xử lý sau mua
            </h3>
            {warranties.length ? (
              warranties.map((t) => (
                <button
                  className="admin-warranty-ticket"
                  key={t.id}
                  onClick={() => onTicket(t.id)}
                >
                  <div>
                    <strong>{t.subject}</strong>
                    <small>
                      {date(t.created_at)} · {t.warranty_key_ids?.length || 0}{" "}
                      mã cần kiểm tra
                    </small>
                  </div>
                  <Badge status={t.status} />
                  <ArrowRight size={15} />
                </button>
              ))
            ) : (
              <p className="muted">
                Khách chưa gửi yêu cầu bảo hành cho đơn này.
              </p>
            )}
            {order.status === "refunded" ? (
              <div className="refund-receipt">
                <CheckCircle2 size={20} />
                <div>
                  <strong>
                    Đã hoàn {money(order.total)}{" "}
                    {order.refund_method === "external"
                      ? "bên ngoài hệ thống"
                      : "vào ví KEYNEST"}
                  </strong>
                  {order.refunded_at && (
                    <small>{date(order.refunded_at)}</small>
                  )}
                  <p>{order.refund_reason}</p>
                  {order.refund_reference && (
                    <p>Mã giao dịch: {order.refund_reference}</p>
                  )}
                </div>
              </div>
            ) : (
              ["processing", "completed"].includes(order.status) &&
              warranties.length > 0 && (
                <>
                  <button
                    className="button button-outline button-small"
                    onClick={() => setRefundOpen(!refundOpen)}
                  >
                    Xử lý hoàn tiền
                  </button>
                  {refundOpen && (
                    <form className="form admin-refund-form" onSubmit={refund}>
                      <div className="refund-amount">
                        <span>Hoàn toàn bộ đơn hàng</span>
                        <strong>{money(order.total)}</strong>
                      </div>
                      <label>
                        Yêu cầu bảo hành liên quan
                        <select
                          value={ticket}
                          onChange={(e) => setTicket(e.target.value)}
                          required
                        >
                          {warranties.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.subject} · {date(t.created_at)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Phương thức hoàn
                        <select
                          value={mode}
                          onChange={(e) =>
                            setMode(e.target.value as typeof mode)
                          }
                        >
                          <option value="wallet">Hoàn vào ví KEYNEST</option>
                          <option value="external">
                            Xác nhận đã hoàn bên ngoài
                          </option>
                        </select>
                      </label>
                      <p className="refund-explanation">
                        {mode === "wallet"
                          ? "Cộng toàn bộ tiền vào ví khách, đóng yêu cầu bảo hành và cập nhật trạng thái đơn trong cùng giao dịch."
                          : "Chỉ ghi nhận khoản bạn đã chuyển trả bằng phương thức khác. Hệ thống không chuyển tiền ngân hàng và không cộng ví."}
                      </p>
                      {mode === "external" && (
                        <label>
                          Mã giao dịch đã hoàn
                          <input
                            name="reference"
                            minLength={3}
                            maxLength={200}
                            required
                            placeholder="Mã tham chiếu ngân hàng / giao dịch"
                          />
                        </label>
                      )}
                      <label>
                        Lý do hoàn tiền
                        <textarea
                          name="reason"
                          minLength={10}
                          maxLength={2000}
                          required
                          placeholder="Ghi rõ kết quả kiểm tra và lý do hoàn cho khách…"
                        />
                      </label>
                      <label className="checkbox">
                        <input type="checkbox" required />
                        {mode === "wallet"
                          ? "Tôi xác nhận hoàn toàn bộ đơn vào ví khách hàng."
                          : "Tôi xác nhận đã chuyển trả đủ tiền cho khách bên ngoài hệ thống."}
                      </label>
                      <button className="button" disabled={busy}>
                        {busy
                          ? "Đang xử lý…"
                          : mode === "wallet"
                            ? "Xác nhận hoàn vào ví"
                            : "Xác nhận đã hoàn bên ngoài"}
                      </button>
                    </form>
                  )}
                </>
              )
            )}
          </section>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </main>
        <aside>
          <section className="admin-detail-section">
            <h3>
              <UserRound size={17} />
              Người mua hàng
            </h3>
            <strong>{user?.name}</strong>
            <p className="admin-customer-email">{user?.email}</p>
            <dl>
              <div>
                <dt>Mã khách</dt>
                <dd className="mono">{user?.id.slice(0, 8).toUpperCase()}</dd>
              </div>
              <div>
                <dt>Số dư hiện tại</dt>
                <dd>{money(user?.balance || 0)}</dd>
              </div>
            </dl>
          </section>
          <section className="admin-detail-section">
            <h3>
              {order.method === "wallet" ? (
                <Wallet size={17} />
              ) : (
                <Landmark size={17} />
              )}
              Thanh toán
            </h3>
            <dl>
              <div>
                <dt>Phương thức</dt>
                <dd>
                  {order.method === "wallet" ? "Ví KEYNEST" : "Ngân hàng"}
                </dd>
              </div>
              <div>
                <dt>Tạm tính</dt>
                <dd>{money(order.subtotal)}</dd>
              </div>
              <div>
                <dt>Giảm giá{order.coupon ? ` · ${order.coupon}` : ""}</dt>
                <dd>−{money(order.discount)}</dd>
              </div>
              <div className="admin-order-total">
                <dt>Tổng cộng</dt>
                <dd>{money(order.total)}</dd>
              </div>
              {order.paid_at && (
                <div>
                  <dt>Thanh toán lúc</dt>
                  <dd>{date(order.paid_at)}</dd>
                </div>
              )}
              {order.completed_at && (
                <div>
                  <dt>Giao xong</dt>
                  <dd>{date(order.completed_at)}</dd>
                </div>
              )}
              {order.payment && (
                <>
                  <div>
                    <dt>Nội dung chuyển khoản</dt>
                    <dd className="mono">{order.payment.code}</dd>
                  </div>
                  <div>
                    <dt>Hạn thanh toán</dt>
                    <dd>{date(order.payment.expires_at)}</dd>
                  </div>
                </>
              )}
            </dl>
          </section>
        </aside>
      </div>
    </Modal>
  );
}
