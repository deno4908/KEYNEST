import { useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowRight,
  Clock3,
  Headphones,
  MessageSquare,
  Search,
  Send,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { Badge, Modal, useStore } from "./App";
import { api, date, money, post } from "./api";
import { Avatar } from "./Avatar";
import type { Overview, Ticket } from "./types";

const priorities = { low: "Thấp", normal: "Bình thường", high: "Ưu tiên cao" };
export function TicketHistory({
  ticket,
  name = "Khách hàng",
  avatar,
}: {
  ticket: Ticket;
  name?: string;
  avatar?: string | null;
}) {
  const { user } = useStore();
  const avatarUrl = avatar || (user?.id === ticket.user_id ? user.avatar_url : null);
  const messages =
    ticket.messages ||
    (ticket.reply
      ? [{ id: "legacy", role: "admin", body: ticket.reply, created_at: null }]
      : []);
  return (
    <div className="ticket-thread">
      <article className="thread-message customer">
        <Avatar className="thread-avatar" name={name} url={avatarUrl} />
        <div className="thread-bubble">
          <header>
            <strong>{name}</strong>
            <time>{date(ticket.created_at)}</time>
          </header>
          <p>{ticket.message}</p>
        </div>
      </article>
      {messages.map((m) => (
        <article className={`thread-message ${m.role}`} key={m.id}>
          {m.role === "admin" ? <span className="thread-avatar thread-brand" aria-label="KEYNEST">//</span> : <Avatar className="thread-avatar" name={m.role === 'seller' ? 'Người bán' : name} url={m.role === 'seller' ? null : avatarUrl} />}
          <div className="thread-bubble">
            <header>
              <strong>{m.role === "admin" ? "KEYNEST hỗ trợ" : m.role === 'seller' ? 'Người bán' : name}</strong>
              <time>
                {m.created_at ? date(m.created_at) : "Phản hồi trước đây"}
              </time>
            </header>
            <p>{m.body}</p>
          </div>
        </article>
      ))}
    </div>
  );
}
export function CustomerTicketCard({
  ticket,
  refresh,
}: {
  ticket: Ticket;
  refresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false),
    [body, setBody] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function reply(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post(`/tickets/${ticket.id}/messages`, { body: body.trim() });
      setBody("");
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="support-ticket customer-ticket">
      <div>
        <strong>{ticket.subject}</strong>
        <Badge status={ticket.status} />
      </div>
      <small>{date(ticket.created_at)}</small>
      <p className="pre-wrap">{ticket.message}</p>
      {!expanded && ticket.reply && (
        <div className="ticket-reply">
          <strong>KEYNEST phản hồi</strong>
          <p className="pre-wrap">{ticket.reply}</p>
        </div>
      )}
      <button
        type="button"
        className="text-button"
        onClick={() => setExpanded(!expanded)}
      >
        <MessageSquare size={15} />
        {expanded
          ? "Thu gọn trao đổi"
          : `Xem trao đổi & trả lời (${(ticket.messages?.length || (ticket.reply ? 1 : 0)) + 1})`}
      </button>
      {expanded && (
        <>
          <TicketHistory ticket={ticket} name="Bạn" />
          <form className="ticket-customer-reply" onSubmit={reply}>
            <label>
              Trả lời cửa hàng
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                minLength={3}
                maxLength={3000}
                required
                placeholder="Bổ sung thông tin hoặc trả lời hướng dẫn…"
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button
              className="button button-small"
              disabled={busy || body.trim().length < 3}
            >
              <Send size={14} />
              {busy ? "Đang gửi…" : "Gửi trả lời"}
            </button>
          </form>
        </>
      )}
    </article>
  );
}
export function SupportManager({
  data,
  onSelect,
}: {
  data: Overview;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [kind, setKind] = useState("all");
  const rows = data.tickets
    .filter(
      (t) =>
        (status === "all" || t.status === status) &&
        (kind === "all" || (t.kind || "support") === kind) &&
        `${t.subject} ${t.message} ${data.users.find((u) => u.id === t.user_id)?.email}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    )
    .sort((a, b) =>
      (b.updated_at || b.created_at).localeCompare(
        a.updated_at || a.created_at,
      ),
    );
  return (
    <div className="admin-support">
      <div className="admin-section-heading">
        <div>
          <h2>Hỗ trợ khách hàng</h2>
          <p>Trao đổi với khách, kiểm tra bảo hành và theo dõi từng yêu cầu.</p>
        </div>
        <Headphones size={26} />
      </div>
      <div className="admin-metrics">
        {[
          ["open", "Chờ phản hồi"],
          ["in_progress", "Đang xử lý"],
          ["closed", "Đã xử lý"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={status === id ? "selected" : ""}
            onClick={() => setStatus(status === id ? "all" : id)}
          >
            <span>{label}</span>
            <strong>
              {data.tickets.filter((t) => t.status === id).length}
            </strong>
          </button>
        ))}
      </div>
      <div className="admin-tools">
        <label>
          <Search size={16} />
          <input
            aria-label="Tìm yêu cầu hỗ trợ"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tiêu đề, email hoặc nội dung…"
          />
        </label>
        <select
          aria-label="Trạng thái yêu cầu"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">Tất cả trạng thái</option>
          <option value="open">Chờ phản hồi</option>
          <option value="in_progress">Đang xử lý</option>
          <option value="closed">Đã xử lý</option>
        </select>
        <select
          aria-label="Loại yêu cầu"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="all">Tất cả yêu cầu</option>
          <option value="support">Hỗ trợ</option>
          <option value="warranty">Bảo hành</option>
        </select>
      </div>
      <div className="support-inbox">
        {rows.map((t) => {
          const customer = data.users.find((u) => u.id === t.user_id);
          return (
            <article
              className={`inbox-ticket ${t.priority === "high" ? "priority-high" : ""}`}
              key={t.id}
            >
              <Avatar
                className="inbox-avatar"
                name={customer?.name || "Khách hàng"}
                url={customer?.avatar_url}
              />
              <div className="inbox-ticket-main">
                <div className="inbox-ticket-labels">
                  <span>
                    {t.kind === "warranty" ? (
                      <>
                        <ShieldCheck size={12} />
                        Bảo hành
                      </>
                    ) : (
                      <>
                        <MessageSquare size={12} />
                        Hỗ trợ
                      </>
                    )}
                  </span>
                  <small>#{t.id.slice(0, 8).toUpperCase()}</small>
                  {t.priority === "high" && <b>Ưu tiên cao</b>}
                </div>
                <button
                  className="inbox-subject"
                  onClick={() => onSelect(t.id)}
                >
                  {t.subject}
                </button>
                <p>{t.messages?.at(-1)?.body || t.reply || t.message}</p>
                <div className="inbox-customer">
                  <strong>{customer?.name || "Khách hàng"}</strong>
                  <span>{customer?.email}</span>
                </div>
              </div>
              <div className="inbox-ticket-end">
                <Badge status={t.status} />
                <time>{date(t.updated_at || t.created_at)}</time>
                <button
                  className="button button-outline button-small"
                  onClick={() => onSelect(t.id)}
                >
                  {t.status === "closed" ? "Xem trao đổi" : "Phản hồi"}
                  <ArrowRight size={14} />
                </button>
              </div>
            </article>
          );
        })}
        {!rows.length && (
          <div className="admin-empty-line">
            <MessageSquare size={26} />
            <p>Không có yêu cầu phù hợp.</p>
          </div>
        )}
      </div>
    </div>
  );
}
export function TicketDialog({
  ticket,
  data,
  close,
  saved,
  onOrder,
}: {
  ticket: Ticket;
  data: Overview;
  close: () => void;
  saved: () => Promise<void>;
  onOrder: (id: string) => void;
}) {
  const { notify } = useStore();
  const customer = data.users.find((u) => u.id === ticket.user_id),
    order = data.orders.find((o) => o.id === ticket.order_id);
  const [reply, setReply] = useState(""),
    [status, setStatus] = useState("closed"),
    [priority, setPriority] = useState(ticket.priority || "normal"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post(`/admin/tickets/${ticket.id}/reply`, {
        reply: reply.trim(),
        status,
        priority,
      });
      setReply("");
      await saved();
      notify("Đã gửi phản hồi cho khách hàng.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`Yêu cầu #${ticket.id.slice(0, 8).toUpperCase()}`}
      close={close}
      wide
      className="admin-dialog support-dialog"
    >
      <div className="support-dialog-heading">
        <h2>{ticket.subject}</h2>
        <Badge status={ticket.status} />
        <button type="button" className="button button-outline button-small" disabled={busy} onClick={async () => {
          if (!window.confirm('Xóa yêu cầu này khỏi danh sách hỗ trợ? Lịch sử vẫn được lưu để đối soát bảo hành.')) return;
          setBusy(true);
          try {
            await api(`/admin/tickets/${ticket.id}`, { method: 'DELETE' });
            await saved();
            close();
            notify('Đã xóa yêu cầu hỗ trợ.');
          } catch (e) { setError((e as Error).message); }
          finally { setBusy(false); }
        }}>Xóa yêu cầu</button>
      </div>
      <div className="support-dialog-layout">
        <div className="support-conversation">
          <TicketHistory
            ticket={ticket}
            name={customer?.name || "Khách hàng"}
            avatar={customer?.avatar_url}
          />
          <form className="support-reply-form" onSubmit={submit}>
            <div className="support-reply-title">
              <h3>Phản hồi khách hàng</h3>
              <select
                aria-label="Mẫu phản hồi nhanh"
                value=""
                onChange={(e) => setReply(e.target.value)}
              >
                <option value="">Chèn mẫu trả lời</option>
                <option value="Cửa hàng đã tiếp nhận yêu cầu. Bạn vui lòng bổ sung thời điểm gặp lỗi và nội dung thông báo lỗi để bên mình kiểm tra.">
                  Yêu cầu bổ sung thông tin
                </option>
                <option value="Cửa hàng đang kiểm tra sản phẩm trong đơn. Bên mình sẽ phản hồi tại đây khi có kết quả.">
                  Đang kiểm tra
                </option>
                <option value="Cửa hàng đã xử lý yêu cầu. Bạn vui lòng kiểm tra lại sản phẩm và phản hồi nếu vẫn gặp vấn đề.">
                  Đã xử lý
                </option>
              </select>
            </div>
            <label className="reply-composer">
              Nội dung phản hồi
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                minLength={3}
                maxLength={3000}
                required
                placeholder="Nhập hướng dẫn hoặc kết quả xử lý cho khách…"
              />
            </label>
            <small>
              {reply.length}/3.000 ký tự · Nội dung này sẽ hiển thị cho khách.
            </small>
            <div className="form-grid">
              <label>
                Trạng thái sau phản hồi
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="closed">Đã xử lý</option>
                  <option value="in_progress">Tiếp tục xử lý</option>
                  <option value="open">Chờ trao đổi thêm</option>
                </select>
              </label>
              <label>
                Mức ưu tiên
                <select
                  value={priority}
                  onChange={(e) =>
                    setPriority(e.target.value as typeof priority)
                  }
                >
                  {Object.entries(priorities).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="admin-dialog-footer">
              <button
                className="button"
                disabled={busy || reply.trim().length < 3}
              >
                <Send size={15} />
                {busy ? "Đang gửi…" : "Gửi phản hồi"}
              </button>
            </div>
          </form>
        </div>
        <aside className="support-context">
          <section>
            <h3>
              <UserRound size={15} />
              Khách hàng
            </h3>
            <strong>{customer?.name || "Khách hàng"}</strong>
            <p>{customer?.email}</p>
            <dl>
              <div>
                <dt>Số dư ví</dt>
                <dd>{money(customer?.balance || 0)}</dd>
              </div>
              <div>
                <dt>Đơn đã mua</dt>
                <dd>
                  {
                    data.orders.filter(
                      (o) =>
                        o.user_id === ticket.user_id &&
                        ["completed", "processing", "refunded"].includes(
                          o.status,
                        ),
                    ).length
                  }
                </dd>
              </div>
            </dl>
          </section>
          <section>
            <h3>
              <Clock3 size={15} />
              Thông tin yêu cầu
            </h3>
            <dl>
              <div>
                <dt>Loại</dt>
                <dd>{ticket.kind === "warranty" ? "Bảo hành" : "Hỗ trợ"}</dd>
              </div>
              <div>
                <dt>Gửi lúc</dt>
                <dd>{date(ticket.created_at)}</dd>
              </div>
              <div>
                <dt>Ưu tiên</dt>
                <dd>{priorities[ticket.priority || "normal"]}</dd>
              </div>
            </dl>
          </section>
          {order && (
            <section>
              <h3>
                <ShieldCheck size={15} />
                Đơn cần bảo hành
              </h3>
              <strong>{order.number}</strong>
              <p>
                {money(order.total)} · {order.items.length} sản phẩm
              </p>
              {order.items.map((i) => {
                const selected =
                  i.key_ids?.flatMap((id, n) =>
                    ticket.warranty_key_ids?.includes(id) ? [n + 1] : [],
                  ) || [];
                return (
                  <div className="support-order-line" key={i.id}>
                    <strong>{i.name}</strong>
                    <small>
                      {i.variant_name} ×{i.quantity}
                    </small>
                    {selected.length > 0 && (
                      <small>Mã cần kiểm tra: {selected.join(", ")}</small>
                    )}
                  </div>
                );
              })}
              <button
                className="button button-outline button-small"
                onClick={() => onOrder(order.id)}
              >
                Xem đơn & xử lý bảo hành
                <ArrowRight size={14} />
              </button>
            </section>
          )}
        </aside>
      </div>
    </Modal>
  );
}
