import { useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Headphones,
  Package,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { Badge } from "./App";
import { date, money } from "./api";
import type { Overview, Product } from "./types";

export const needsStock = (p: Product) =>
  p.active &&
  (!p.seller_id || p.review_status === "approved") &&
  p.variants.some(
    (v) =>
      v.active !== false &&
      v.delivery === "key" &&
      !v.unlimited &&
      v.stock <= 5,
  );
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dayKey = (value: string | number) => dayFormatter.format(new Date(value));
export function AdminOverview({
  data,
  go,
  openOrder,
  openTicket,
}: {
  data: Overview;
  go: (tab: string, filter?: string) => void;
  openOrder: (id: string) => void;
  openTicket: (id: string) => void;
}) {
  const [period, setPeriod] = useState(7);
  const days = Array.from({ length: period }, (_, index) =>
    dayKey(Date.now() - (period - index - 1) * 86400000),
  );
  const daySet = new Set(days);
  const orderDays = new Map(
    data.orders.map((o) => [o.id, dayKey(o.paid_at || o.created_at)]),
  );
  const paid = data.orders.filter(
    (o) =>
      ["completed", "processing"].includes(o.status) &&
      daySet.has(orderDays.get(o.id)!),
  );
  const placed = data.orders.filter((o) => daySet.has(dayKey(o.created_at)));
  const total = paid.reduce((sum, o) => sum + o.total, 0);
  const totals = new Map(days.map((day) => [day, 0]));
  for (const order of paid) {
    const day = orderDays.get(order.id)!;
    totals.set(day, totals.get(day)! + order.total);
  }
  const series = days.map((day) => ({ day, amount: totals.get(day)! }));
  const max = Math.max(1, ...series.map((s) => s.amount));
  const waiting = data.orders
    .filter((o) => o.status === "processing")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const support = data.tickets.filter((t) =>
    ["open", "in_progress"].includes(t.status),
  );
  const reviews = data.products.filter(
    (p) => p.seller_id && p.review_status === "pending",
  );
  const stock = data.products.filter(needsStock);
  const payments = data.events.filter((e) => e.outcome === "needs_review");
  const queues = [
    {
      tab: "orders",
      filter: "processing",
      name: "Đơn chờ giao",
      count: waiting.length,
      description: "Đã thanh toán, cần hoàn tất giao hàng",
      Icon: ClipboardList,
    },
    {
      tab: "tickets",
      name: "Hỗ trợ chưa đóng",
      count: support.length,
      description: "Kiểm tra phản hồi và bảo hành",
      Icon: Headphones,
    },
    {
      tab: "products",
      filter: "review",
      name: "Sản phẩm chờ duyệt",
      count: reviews.length,
      description: "Kiểm tra nội dung trước khi mở bán",
      Icon: ShieldCheck,
    },
    {
      tab: "payments",
      name: "Giao dịch đối soát",
      count: payments.length,
      description: "Xác minh trước khi ghi có số dư",
      Icon: CreditCard,
    },
    {
      tab: "products",
      filter: "low",
      name: "Sản phẩm sắp hết mã",
      count: stock.length,
      description: "Có gói giao mã còn tối đa 5 đơn vị",
      Icon: Package,
    },
  ];
  const recent = [...data.orders]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 6);
  return (
    <div className="admin-overview">
      <div className="admin-overview-heading">
        <div>
          <span className="eyebrow">HOẠT ĐỘNG CỬA HÀNG</span>
          <h2>Hôm nay cần làm gì?</h2>
          <p>Nắm tình hình và mở đúng công việc đang chờ.</p>
        </div>
        <label>
          Khoảng thống kê
          <select
            aria-label="Khoảng thống kê"
            value={period}
            onChange={(e) => setPeriod(Number(e.target.value))}
          >
            <option value={7}>7 ngày gần nhất</option>
            <option value={30}>30 ngày gần nhất</option>
            <option value={90}>90 ngày gần nhất</option>
          </select>
        </label>
      </div>
      <div className="admin-kpis">
        <div>
          <span>
            <Wallet size={17} /> Giá trị đơn đã thanh toán
          </span>
          <strong>{money(total)}</strong>
          <small>{paid.length} đơn · chưa gồm đơn hoàn toàn bộ</small>
        </div>
        <div>
          <span>
            <ClipboardList size={17} /> Đơn được tạo
          </span>
          <strong>{placed.length}</strong>
          <small>Trong {period} ngày, gồm mọi trạng thái</small>
        </div>
        <div>
          <span>
            <CheckCircle2 size={17} /> Đơn đã hoàn thành
          </span>
          <strong>{paid.filter((o) => o.status === "completed").length}</strong>
          <small>Trong nhóm đơn thanh toán kỳ này</small>
        </div>
        <div>
          <span>
            <CreditCard size={17} /> Giá trị trung bình / đơn
          </span>
          <strong>{money(paid.length ? total / paid.length : 0)}</strong>
          <small>Chỉ tính đơn đã thanh toán kỳ này</small>
        </div>
      </div>
      <div className="panel admin-work-panel">
        <div className="section-title">
          <h3>Hàng đợi công việc</h3>
          <span className="admin-live-label">Trạng thái hiện tại</span>
        </div>
        <div className="admin-work-grid">
          {queues.map(({ tab, filter, name, count, description, Icon }) => (
            <button
              key={name}
              onClick={() => go(tab, filter)}
              className={count ? "has-work" : ""}
            >
              <span className="admin-work-icon">
                <Icon size={19} />
              </span>
              <strong>{count}</strong>
              <h4>{name}</h4>
              <p>{description}</p>
              <span className="admin-work-open">
                Mở danh sách <ArrowUpRight size={14} />
              </span>
            </button>
          ))}
        </div>
        <p className="admin-data-note">
          Hàng đợi không bị giới hạn bởi khoảng thống kê. Số chưa đọc trong hộp
          thư là trạng thái xem thông báo, độc lập với công việc ở đây.
        </p>
      </div>
      <div className="admin-overview-columns">
        <section className="panel admin-chart">
          <div className="section-title">
            <h3>Giá trị thanh toán theo ngày</h3>
            <span>{period} ngày</span>
          </div>
          <div className="admin-chart-summary">
            <strong>{money(total)}</strong>
            <span>Múi giờ Việt Nam</span>
          </div>
          <div
            className="admin-chart-bars"
            role="img"
            aria-label={`Giá trị đơn đã thanh toán trong ${period} ngày: ${money(total)}`}
          >
            {series.map((s) => (
              <div key={s.day} title={`${s.day}: ${money(s.amount)}`}>
                <i
                  style={{
                    height: `${s.amount ? Math.max(3, (s.amount / max) * 100) : 0}%`,
                  }}
                />
              </div>
            ))}
          </div>
          <div className="admin-chart-axis">
            <span>{days[0]}</span>
            <span>{days.at(-1)}</span>
          </div>
          {!paid.length && (
            <p className="muted">Chưa có đơn đã thanh toán trong khoảng này.</p>
          )}
          <details className="admin-chart-data">
            <summary>Xem dữ liệu từng ngày</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Ngày</th>
                    <th>Giá trị đơn</th>
                  </tr>
                </thead>
                <tbody>
                  {series.map((s) => (
                    <tr key={s.day}>
                      <td>{s.day}</td>
                      <td>{money(s.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <p className="admin-data-note">
            Theo ngày thanh toán; đơn cũ thiếu thời điểm thanh toán dùng ngày
            tạo. Đây là giá trị đơn, chưa trừ hoàn tiền từng sản phẩm, phí hoặc
            chi phí.
          </p>
        </section>
        <section className="panel admin-focus">
          <div className="section-title">
            <h3>Ưu tiên kiểm tra</h3>
          </div>
          {waiting.length === 0 && support.length === 0 ? (
            <div className="inbox-empty">
              <CheckCircle2 />
              <strong>Không có đơn chờ giao hoặc hỗ trợ chưa đóng</strong>
              <p>Kiểm tra các hàng đợi khác ở phía trên.</p>
            </div>
          ) : (
            <div className="admin-focus-list">
              {waiting.slice(0, 3).map((o) => (
                <button key={o.id} onClick={() => openOrder(o.id)}>
                  <span className="admin-work-icon">
                    <ClipboardList size={17} />
                  </span>
                  <span>
                    <strong>{o.number}</strong>
                    <small>Chờ giao · {date(o.paid_at || o.created_at)}</small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
              {support
                .sort(
                  (a, b) =>
                    (b.priority === "high" ? 1 : 0) -
                      (a.priority === "high" ? 1 : 0) ||
                    a.created_at.localeCompare(b.created_at),
                )
                .slice(0, 3)
                .map((t) => (
                  <button key={t.id} onClick={() => openTicket(t.id)}>
                    <span className="admin-work-icon">
                      <Headphones size={17} />
                    </span>
                    <span>
                      <strong>{t.subject}</strong>
                      <small>
                        {t.priority === "high"
                          ? "Ưu tiên cao"
                          : "Hỗ trợ chưa đóng"}{" "}
                        · {date(t.created_at)}
                      </small>
                    </span>
                    <ArrowUpRight size={16} />
                  </button>
                ))}
            </div>
          )}
        </section>
      </div>
      <section className="panel">
        <div className="section-title">
          <h3>Đơn hàng gần đây</h3>
          <button className="text-button" onClick={() => go("orders")}>
            Xem tất cả <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Đơn / thời gian</th>
                <th>Khách hàng</th>
                <th>Tổng tiền</th>
                <th>Trạng thái</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {recent.map((o) => (
                <tr key={o.id}>
                  <td>
                    <strong>{o.number}</strong>
                    <small>{date(o.created_at)}</small>
                  </td>
                  <td>
                    {data.users.find((u) => u.id === o.user_id)?.name ||
                      "Khách hàng"}
                  </td>
                  <td>{money(o.total)}</td>
                  <td>
                    <Badge status={o.status} />
                  </td>
                  <td>
                    <button
                      className="button button-outline button-small"
                      onClick={() => openOrder(o.id)}
                    >
                      Chi tiết
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!recent.length && <p className="muted">Chưa có đơn hàng.</p>}
      </section>
    </div>
  );
}
