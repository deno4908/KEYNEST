import { useEffect, useRef, useState } from "react";
import { Send, Bell } from "lucide-react";
import { api, post, date } from "./api";
import "./admin-notifications.css";
import { AnnouncementManager } from "./Announcements";
type Campaign = {
  id: string;
  title: string;
  body: string;
  email: string | null;
  recipients: number;
  created_at: string;
};
export function AdminNotifications() {
  const [items, setItems] = useState<Campaign[]>([]);
  const [target, setTarget] = useState("one");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pending = useRef({ signature: "", id: "" });
  async function load() {
    setItems(await api<Campaign[]>("/admin/notifications"));
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  return (
    <div className="admin-notifications">
      <AnnouncementManager />
      <header>
        <h2>Thông báo</h2>
        <p>Gửi thông tin đến hộp thông báo trong tài khoản của khách hàng.</p>
      </header>
      <form
        className="panel notification-composer"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || (target === "all" && !confirmed)) return;
          const payload = {
            title: title.trim(),
            body: body.trim(),
            ...(target === "one" ? { email: email.trim() } : {}),
          };
          const signature = JSON.stringify(payload);
          if (pending.current.signature !== signature)
            pending.current = { signature, id: crypto.randomUUID() };
          setBusy(true);
          setError("");
          setMessage("");
          try {
            const result = await post<{ recipients: number }>(
              "/admin/notifications",
              { ...payload, id: pending.current.id },
            );
            setMessage(`Đã gửi thông báo tới ${result.recipients} tài khoản.`);
            setTitle("");
            setBody("");
            setConfirmed(false);
            pending.current = { signature: "", id: "" };
            await load();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <label>
            Người nhận
            <select
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                setConfirmed(false);
              }}
            >
              <option value="one">Một khách hàng</option>
              <option value="all">Toàn bộ khách hàng hiện có</option>
            </select>
          </label>
          {target === "one" && (
            <label>
              Email khách hàng
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email của tài khoản nhận thông báo"
              />
            </label>
          )}
          <label>
            Tiêu đề
            <input
              required
              minLength={3}
              maxLength={150}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ví dụ: Lịch bảo trì cửa hàng"
            />
          </label>
          <label>
            Nội dung
            <textarea
              required
              minLength={3}
              maxLength={3000}
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Nhập nội dung cần thông báo…"
            />
          </label>
          {target === "all" && (
            <label className="notification-confirm">
              <input
                type="checkbox"
                required
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Tôi xác nhận gửi đến toàn bộ tài khoản khách hàng hiện có.
            </label>
          )}
          <button
            className="button"
            disabled={
              busy ||
              title.trim().length < 3 ||
              body.trim().length < 3 ||
              (target === "all" && !confirmed)
            }
          >
            <Send size={16} />
            {busy ? "Đang gửi…" : "Gửi thông báo"}
          </button>
        </fieldset>
      </form>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <div className="notification-auto-note">
        <Bell size={20} />
        <p>
          Khi phản hồi hoặc đánh dấu yêu cầu hỗ trợ/bảo hành là đã xử lý, khách
          hàng nhận thông báo tự động trong tài khoản. Không gửi email hay tin
          nhắn Discord/Facebook.
        </p>
      </div>
      <h3>Lịch sử gửi gần đây</h3>
      {!items.length && (
        <p className="muted">Chưa có thông báo được gửi từ mục này.</p>
      )}
      {items.map((item) => (
        <article className="panel notification-history" key={item.id}>
          <strong>{item.title}</strong>
          <small>
            {item.email || "Toàn bộ khách hàng"} · {item.recipients} người nhận
            · {date(item.created_at)}
          </small>
          <p>{item.body}</p>
          <button
            className="button button-outline"
            disabled={busy}
            onClick={async () => {
              if (
                !window.confirm(
                  `Xóa “${item.title}” khỏi lịch sử gửi và hộp thông báo của tất cả người nhận?`,
                )
              )
                return;
              setBusy(true);
              setError("");
              try {
                await api(`/admin/notifications/${item.id}`, {
                  method: "DELETE",
                });
                await load();
                setMessage("Đã xóa thông báo khỏi hộp thư người nhận.");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Xóa thông báo đã gửi
          </button>
        </article>
      ))}
    </div>
  );
}
