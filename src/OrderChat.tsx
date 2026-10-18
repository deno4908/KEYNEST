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
};
type Conversation = {
  viewer_role?: string;
  can_message?: boolean;
  name: string;
  seller_name: string;
  order_number: string;
  order_status: string;
  order_total: number;
  can_request: boolean;
  dispute: SellerDispute | null;
  messages: { id: string; body: string; role: string; created_at: string }[];
};
const state: Record<string, string> = {
  open: "Đang chờ phản hồi",
  agreed: "Hai bên đã đồng ý · chờ admin đối soát",
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
      title={readOnly ? 'Theo dõi cuộc trò chuyện' : viewerRole === 'seller' ? 'Chat với người mua' : data?.seller_name || 'Chat với người bán'}
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
          <div className="order-chat-tools">
          {data.dispute && (
            <section className="panel">
              <strong>{state[data.dispute.status]}</strong>
              {data.dispute.reason && (
                <p className="seller-preserve">{data.dispute.reason}</p>
              )}
              {data.dispute.resolution && <p>{data.dispute.resolution}</p>}
              {pending && (
                <p>
                  Tiền của đơn đang bị giữ đến khi admin giải quyết, kể cả đã
                  qua 48 giờ. Hoàn tiền áp dụng cho toàn bộ đơn.
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
                    Đồng ý đề nghị hoàn tiền, chuyển admin
                  </button>
                )}
            </section>
          )}
          {!readOnly && !data.dispute && data.can_request && (
            <button
              className="button button-outline"
              onClick={() => setRequesting(!requesting)}
            >
              Yêu cầu hoàn tiền
            </button>
          )}
          {requesting && (
            <form
              className="form panel"
              onSubmit={(e) => {
                e.preventDefault();
                void send("request");
              }}
            >
              <p>
                Gửi đề nghị hoàn toàn bộ đơn ({money(data.order_total)}). Tiền
                người bán của đơn sẽ bị đóng băng để chờ xử lý. Với đơn có nhiều
                người bán, admin sẽ kiểm tra tất cả sản phẩm trước khi quyết
                định.
              </p>
              <label>
                Lý do
                <textarea
                  disabled={busy}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  minLength={10}
                  maxLength={2000}
                  required
                />
              </label>
              <button className="button" disabled={busy}>
                Gửi yêu cầu và giữ tiền
              </button>
            </form>
          )}
          {admin && pending && (
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
                    Hoàn toàn bộ đơn vào ví người mua
                  </option>
                  <option value="reject">
                    Từ chối hoàn tiền, bỏ đóng băng
                  </option>
                </select>
              </label>
              {decision === "refund" && (
                <p>
                  Hoàn {money(data.order_total)} cho toàn bộ đơn, gồm cả các sản
                  phẩm của người bán khác. Chỉ xác nhận sau khi đối soát đầy đủ.
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
