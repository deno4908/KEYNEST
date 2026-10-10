import { useEffect, useState } from "react";
import { Bell, ChevronDown } from "lucide-react";
import { api, post, date } from "./api";
import "./announcements.css";
type Announcement = {
  id: string;
  title: string;
  body: string;
  active: boolean;
  created_at: string;
};
export function HomeAnnouncements() {
  const [items, setItems] = useState<Announcement[]>([]);
  useEffect(() => {
    const c = new AbortController();
    void api<Announcement[]>("/announcements", { signal: c.signal })
      .then(setItems)
      .catch(() => {});
    return () => c.abort();
  }, []);
  if (!items.length) return null;
  return (
    <section
      className="container home-announcements"
      aria-label="Thông báo cửa hàng"
    >
      {items.map((a) => (
        <details key={a.id}>
          <summary>
            <span className="announcement-label">
              <Bell size={14} aria-hidden="true" />
              <span>Thông báo</span>
            </span>
            <strong>{a.title}</strong>
            <span className="announcement-toggle">
              <span className="announcement-more">Chi tiết</span>
              <ChevronDown size={15} aria-hidden="true" />
            </span>
          </summary>
          <div>
            <small>{date(a.created_at)}</small>
            <p>{a.body}</p>
          </div>
        </details>
      ))}
    </section>
  );
}
export function AnnouncementManager() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id, setId] = useState(() => crypto.randomUUID());
  async function load() {
    setItems(await api<Announcement[]>("/admin/announcements"));
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function save(
    a: Pick<Announcement, "id" | "title" | "body" | "active">,
  ) {
    setBusy(true);
    setError("");
    try {
      await post("/admin/announcements", a);
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-notifications">
      <header>
        <h2>Thông báo trang chủ</h2>
        <p>
          Công khai cho mọi người, kể cả khách chưa đăng nhập. Không đăng thông
          tin riêng của khách hàng.
        </p>
      </header>
      <form
        className="panel notification-composer"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          if (
            await save({
              id,
              title: title.trim(),
              body: body.trim(),
              active: true,
            })
          ) {
            setId(crypto.randomUUID());
            setTitle("");
            setBody("");
          }
        }}
      >
        <fieldset disabled={busy}>
          <label>
            Tiêu đề
            <input
              required
              minLength={3}
              maxLength={150}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Nội dung
            <textarea
              required
              minLength={3}
              maxLength={3000}
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <button className="button" disabled={busy}>
            {busy ? "Đang lưu…" : "Đăng trên trang chủ"}
          </button>
        </fieldset>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {items.map((a) => (
        <article className="panel notification-history" key={a.id}>
          <strong>{a.title}</strong>
          <small>
            {a.active ? "Đang hiển thị" : "Đã ẩn"} · {date(a.created_at)}
          </small>
          <p>{a.body}</p>
          <div className="announcement-admin-actions">
            <button
              className="button button-outline"
              disabled={busy}
              onClick={() =>
                void save({
                  id: a.id,
                  title: a.title,
                  body: a.body,
                  active: !a.active,
                })
              }
            >
              {a.active ? "Ẩn khỏi trang chủ" : "Hiện trên trang chủ"}
            </button>
            <button
              className="button button-outline"
              disabled={busy}
              onClick={async () => {
                if (
                  !window.confirm(`Xóa thông báo “${a.title}” khỏi trang chủ?`)
                )
                  return;
                setBusy(true);
                setError("");
                try {
                  await api(`/admin/announcements/${a.id}`, {
                    method: "DELETE",
                  });
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Xóa
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
