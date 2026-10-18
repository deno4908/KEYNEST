import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, post, date, money } from "./api";
import { Modal, useStore } from "./App";
import { Send, MessageCircle } from 'lucide-react';
import './order-chat.css';
import { useDataRefresh } from "./useDataRefresh";

export type SellerDispute = {
  order_id: string;
  item_id: string;
  reason?: string;
  status: string;
  resolution?: string;
  can_agree?: boolean;
  amount?: number;
  created_at?: string;
  response_due_at?: string;
  needs_admin?: boolean;
  can_resolve?: boolean;
};
type Conversation = {
  viewer_role?: string;
  can_message?: boolean;
  name: string;
  seller_name: string;
  order_number: string;
  order_status: string;
  order_total: number;
  refund_amount: number;
  quantity: number;
  variant_name: string;
  can_request: boolean;
  dispute: SellerDispute | null;
  messages: { id: string; body: string; role: string; created_at: string }[];
};
const state: Record<string, string> = {
  open: "Đang chờ phản hồi",
  agreed: "Đang xử lý hoàn tiền",
  rejected: "Admin đã từ chối yêu cầu",
  refunded: "Đã hoàn tiền",
};

export function OrderChatButton({
  itemId,
  label = "Chat với người bán",
}: {
  itemId: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="button button-outline button-small order-chat-trigger"
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {open &&
        createPortal(
          <OrderChat itemId={itemId} close={() => setOpen(false)} />,
          document.body,
        )}
    </>
  );
}
export function OrderChat({
  itemId,
  close,
  admin = false,
}: {
  itemId: string;
  close: () => void;
  admin?: boolean;
}) {
  const { user } = useStore();
  const [data, setData] = useState<Conversation | null>(null),
    [error, setError] = useState(""),
    [body, setBody] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [requesting, setRequesting] = useState(false),
    [decision, setDecision] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const sequence = useRef(0);
  const readOnly = data?.can_message === undefined ? admin || user?.role === 'admin' : !data.can_message;
  const viewerRole = data?.viewer_role || (user?.role === 'seller' ? 'seller' : 'customer');
  const logRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const lastMessage = data?.messages.at(-1)?.id;
  useEffect(() => {
    if (followLatest.current && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lastMessage]);
  const load = async () => {
    const version = ++sequence.current;
    try {
      const next = await api<Conversation>(`/order-chat/${itemId}`);
      if (version === sequence.current) {
        setData(next);
      }
    } catch (e) {
      if (version === sequence.current) setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
    return () => {
      sequence.current++;
    };
  }, [itemId]);
  useDataRefresh(load, ["/order-chat/", "/admin/"], {
    intervalMs: 5000,
    enabled: !busy,
  });
  const send = async (action: string) => {
    if (busy || (action === 'message' && (readOnly || !body.trim()))) return;
    setBusy(true);
    setError("");
    sequence.current++;
    try {
      setData(
        await post(`/order-chat/${itemId}`, {
          action,
          body: action === "message" ? body : reason,
          ...(action === "message" ? { request_id: requestId } : {}),
        }),
      );
      if (action === "message") {
        followLatest.current = true;
        setBody("");
        setRequestId(crypto.randomUUID());
      } else {
        setRequesting(false);
        setDecision("");
        setReason("");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const pending =
    data?.dispute && ["open", "agreed"].includes(data.dispute.status);
  return (
    <Modal
      className="order-chat-modal"
      title={<span className="order-chat-heading">
        <span className="order-chat-heading-icon" aria-hidden="true"><MessageCircle size={22} /></span>
        <span className="order-chat-heading-copy"><span>{requesting ? 'Yêu cầu hoàn tiền' : readOnly ? 'Theo dõi cuộc trò chuyện' : viewerRole === 'seller' ? 'Chat với người mua' : data?.seller_name || 'Chat với người bán'}</span><small>{requesting ? 'Hỗ trợ xử lý đơn hàng' : 'Trao đổi về sản phẩm và đơn hàng'}</small></span>
      </span>}
      close={() => !busy && close()}
    >
      <div className="order-chat-intro"><MessageCircle size={20} /><div><strong>{data ? `${data.order_number} · ${data.name}` : 'Đang tải cuộc trò chuyện…'}</strong><p>KEYNEST có thể xem để hỗ trợ đơn hàng.</p></div></div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          {!requesting && <>
          <div
            className="order-chat-messages"
            ref={logRef}
            onScroll={() => { const el = logRef.current; if (el) followLatest.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}
            role="log"
            aria-label="Tin nhắn đơn hàng"
            aria-live="polite"
          >
            {!data.messages.length && <div className="order-chat-empty"><MessageCircle size={32} /><strong>Bắt đầu cuộc trò chuyện</strong><p>Gửi lời nhắn để trao đổi về sản phẩm và đơn hàng.</p></div>}
            {data.messages.map((m) => (
              <article key={m.id} className={!readOnly && m.role === viewerRole ? 'chat-message chat-message-own' : 'chat-message'}>
                <strong>
                  {!readOnly && m.role === viewerRole ? 'Bạn' : m.role === "seller" ? "Người bán" : "Người mua"}
                </strong>
                <p className="seller-preserve">{m.body}</p>
                <small>{date(m.created_at)}</small>
              </article>
            ))}
          </div>
          {readOnly && <p className="order-chat-readonly">Chế độ xem dành cho quản trị viên. Phản hồi khách hàng qua mục Hỗ trợ.</p>}
          {!readOnly && (
            <form
              className="order-chat-composer"
              onSubmit={(e) => {
                e.preventDefault();
                void send("message");
              }}
            >
              <textarea
                aria-label="Tin nhắn"
                disabled={busy}
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  setRequestId(crypto.randomUUID());
                }}
                required
                placeholder="Nhập tin nhắn…"
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send('message'); }
                }}
                maxLength={3000}
                rows={1}
              />
              <button className="button" aria-label="Gửi tin nhắn" disabled={busy || !body.trim()}>
                <Send size={19} />
              </button>
            </form>
          )}
          </>}
          <div className={`order-chat-tools${requesting ? ' order-chat-tools-expanded' : ''}`}>
          {data.dispute && (
            <section className="order-dispute-card">
              <div className="order-dispute-heading"><strong>{data.dispute.needs_admin ? 'Quá 48 giờ · Chờ admin' : state[data.dispute.status]}</strong><span>{money(data.dispute.amount ?? data.refund_amount)}</span></div>
              <small>{data.name} · {data.variant_name} · Số lượng: {data.quantity}</small>
              {data.dispute.reason && (
                <p className="seller-preserve">{data.dispute.reason}</p>
              )}
              {data.dispute.resolution && <p>{data.dispute.resolution}</p>}
              {pending && (
                <p>
                  Chỉ giữ tiền sản phẩm này. Hai bên đồng ý sẽ hoàn vào ví người mua.
                  {data.dispute.response_due_at && <> Hạn phản hồi: {date(data.dispute.response_due_at)}.</>}
                  {' '}Admin có thể can thiệp sớm; quá 48 giờ chưa xử lý sẽ chờ admin.
                </p>
              )}
              {pending &&
                data.dispute.can_agree &&
                data.dispute.status === "open" && (
                  <button
                    className="button button-outline"
                    disabled={busy}
                    onClick={() => void send("agree")}
                  >
                    Đồng ý hoàn {money(data.dispute.amount ?? data.refund_amount)} vào ví
                  </button>
                )}
            </section>
          )}
          {!requesting && !readOnly && !data.dispute && data.can_request && (
            <button
              className="button button-outline"
              onClick={() => setRequesting(!requesting)}
            >
              Yêu cầu hoàn tiền
            </button>
          )}
          {requesting && (
            <form
              className="order-refund-form"
              onSubmit={(e) => {
                e.preventDefault();
                void send("request");
              }}
            >
              <div className="order-refund-amount"><span>Số tiền đề nghị hoàn</span><strong>{money(data.refund_amount)}</strong><small>{data.name} · {data.variant_name} · Số lượng: {data.quantity}</small></div>
              <p className="order-refund-note">Chỉ yêu cầu hoàn sản phẩm này, theo số tiền thực trả sau giảm giá. Khi bên còn lại đồng ý, tiền tự động hoàn vào ví người mua. Yêu cầu chưa xử lý sau 48 giờ sẽ chờ admin; admin cũng có thể can thiệp sớm.</p>
              <label>
                Lý do yêu cầu
                <textarea
                  disabled={busy}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  minLength={10}
                  maxLength={2000}
                  rows={4}
                  placeholder="Mô tả vấn đề bạn gặp phải và nội dung đã trao đổi với người bán…"
                  required
                />
                <span className="order-refund-hint"><span>Tối thiểu 10 ký tự</span><span>{reason.length}/2000</span></span>
              </label>
              <div className="order-refund-actions">
                <button type="button" className="button button-outline" disabled={busy} onClick={() => setRequesting(false)}>Quay lại chat</button>
                <button className="button" disabled={busy || reason.trim().length < 10}>{busy ? 'Đang gửi…' : 'Gửi yêu cầu'}</button>
              </div>
            </form>
          )}
          {admin && data.dispute?.can_resolve && pending && (
            <form
              className="form panel"
              onSubmit={(e) => {
                e.preventDefault();
                void send(decision);
              }}
            >
              <label>
                Kết quả xử lý
                <select
                  disabled={busy}
                  value={decision}
                  onChange={(e) => setDecision(e.target.value)}
                  required
                >
                  <option value="">Chọn phương án</option>
                  <option value="refund">
                    Hoàn sản phẩm này vào ví người mua
                  </option>
                  <option value="reject">
                    Từ chối hoàn tiền, bỏ đóng băng
                  </option>
                </select>
              </label>
              {decision === "refund" && (
                <p>
                  Hoàn {money(data.dispute?.amount ?? data.refund_amount)} cho sản phẩm {data.name}. Các sản phẩm khác giữ nguyên.
                </p>
              )}
              <label>
                Lý do xử lý
                <textarea
                  disabled={busy}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  minLength={10}
                  maxLength={2000}
                  required
                />
              </label>
              <button className="button" disabled={busy || !decision}>
                Xác nhận xử lý
              </button>
            </form>
          )}
          </div>
        </>
      )}
    </Modal>
  );
}
