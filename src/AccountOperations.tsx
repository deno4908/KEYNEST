import { useEffect, useId, useState } from "react";
import { useDataRefresh } from './useDataRefresh';
import { Link } from "react-router-dom";
import { Bell, Monitor, ShieldCheck, Smartphone, LogOut, ChevronLeft, ChevronRight } from "lucide-react";
import "./sessions.css";
import "./notification-inbox.css";
import { api, date, post } from "./api";

type Session = {
  id: string;
  user_agent: string;
  created_at: string;
  revoked_at: string | null;
  current: boolean;
};
type Notice = {
  body?: string;
  id: string;
  title: string;
  href: string;
  created_at: string;
  read_at: string | null;
};
type Inbox = {
  items: Notice[];
  page: number;
  pages: number;
  unread_count: number;
};

function deviceLabel(agent: string) {
  const browser = /Edg(?:e|A|iOS)?\//.test(agent)
    ? "Microsoft Edge"
    : /OPR\/|Opera/.test(agent)
      ? "Opera"
      : /Firefox\/|FxiOS\//.test(agent)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(agent)
          ? "Chrome"
          : /Safari\//.test(agent)
            ? "Safari"
            : "Trình duyệt";
  const os = /iPhone|iPad|iPod/.test(agent)
    ? "iOS"
    : /Android/.test(agent)
      ? "Android"
      : /Windows/.test(agent)
        ? "Windows"
        : /Macintosh|Mac OS X/.test(agent)
          ? "macOS"
          : /Linux/.test(agent)
            ? "Linux"
            : "Thiết bị không xác định";
  return {
    title: `${browser} trên ${os}`,
    mobile: /Android|iPhone|iPad|iPod|Mobile/.test(agent),
  };
}
export function SessionManager() {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const [sessions, setSessions] = useState<Session[]>([]);
  const orderedSessions = [...sessions].sort((a, b) =>
    Number(b.current) - Number(a.current) ||
    Number(!!a.revoked_at) - Number(!!b.revoked_at) ||
    b.created_at.localeCompare(a.created_at),
  );
  const visibleSessions = expanded ? orderedSessions : orderedSessions.slice(0, 3);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setError("");
    api<Session[]>("/me/sessions", { signal: c.signal })
      .then(setSessions)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [version]);
  async function revoke(id?: string) {
    setBusy(true);
    setError("");
    try {
      await post("/me/sessions/revoke", id ? { id } : { others: true });
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-operations session-manager">
      <div className="operations-heading">
        <h3>
          <ShieldCheck size={18} /> Phiên đăng nhập
        </h3>
        <button
          className="button button-outline"
          disabled={busy || !sessions.some((s) => !s.current && !s.revoked_at)}
          onClick={() => revoke()}
        >
          <LogOut size={14} /> Thu hồi các phiên khác
        </button>
      </div>
      <p className="muted">
        Quản lý thiết bị đã truy cập tài khoản. Thu hồi phiên bạn không nhận ra.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}{" "}
          <button onClick={() => setVersion((v) => v + 1)}>Thử lại</button>
        </p>
      )}
      <div id={listId} className={`session-list ${expanded ? 'is-expanded' : ''}`}>
        {visibleSessions.map((s) => (
            <div
              className={`session-device ${s.current ? "is-current" : ""} ${s.revoked_at ? "is-revoked" : ""}`}
              key={s.id}
            >
              <span className="session-device-icon">
                {deviceLabel(s.user_agent || "").mobile ? (
                  <Smartphone size={21} />
                ) : (
                  <Monitor size={21} />
                )}
              </span>
              <div className="session-device-info">
                <div className="session-device-title">
                  <strong title={s.user_agent}>
                    {deviceLabel(s.user_agent || "").title}
                  </strong>
                  {s.current ? (
                    <span className="session-badge">Phiên hiện tại</span>
                  ) : s.revoked_at ? (
                    <span className="session-badge revoked">Đã thu hồi</span>
                  ) : null}
                </div>
                <small>Ghi nhận lần đầu · {date(s.created_at)}</small>
              </div>
              {!s.current && !s.revoked_at && (
                <button
                  className="session-revoke"
                  aria-label={`Thu hồi phiên ${deviceLabel(s.user_agent || "").title}, ${date(s.created_at)}`}
                  disabled={busy}
                  onClick={() => revoke(s.id)}
                >
                  Thu hồi
                </button>
              )}
            </div>
          ))}
      </div>
      {sessions.length > 3 && <button
        type="button" className="session-expand" aria-expanded={expanded} aria-controls={listId}
        onClick={() => setExpanded(value => !value)}
      >{expanded ? 'Thu gọn danh sách' : `Xem thêm ${sessions.length - 3} phiên đăng nhập`}</button>}
      <p className="session-footnote">
        Phiên cũ có thể đã hết hạn. Tên thiết bị được nhận diện từ trình duyệt.
      </p>
    </div>
  );
}

export function NotificationInbox({ history = false }: { history?: boolean } = {}) {
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [data, setData] = useState<Inbox | null>(null);
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useDataRefresh(() => setVersion(v => v + 1), ['/notifications/read', '/order-chat/'], { intervalMs: 10000 });
  useEffect(() => {
    const c = new AbortController();
    setError("");
    setData(null);
    api<Inbox>(`/notifications?page=${page}&page_size=3&${history ? 'read=1' : 'unread=1'}`, { signal: c.signal })
      .then(setData)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [page, version, history]);
  async function read(id?: string) {
    setBusy(true);
    setError("");
    try {
      await post("/notifications/read", id ? { id } : { all: true });
      setPage(1);
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={history ? "notification-history-list notification-inbox" : "member-panel account-operations notification-inbox"}>
      <div className="operations-heading">
        <h3>
          <Bell size={18} /> {history ? 'Đã đọc' : 'Thông báo mới'}{" "}
          {!history && data && data.unread_count > 0 ? `(${data.unread_count})` : ""}
        </h3>
        {!history && <button
          className="button button-outline"
          disabled={busy || !data?.unread_count}
          onClick={() => read()}
        >
          Đánh dấu tất cả đã đọc
        </button>}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}{" "}
          <button onClick={() => setVersion((v) => v + 1)}>Thử lại</button>
        </p>
      )}
      {!data && !error && <p className="muted">Đang tải thông báo…</p>}
      {data?.items.length === 0 && (
        <p className="muted">{history ? 'Chưa có thông báo đã đọc.' : 'Bạn đã xem hết thông báo mới.'}</p>
      )}
      <div className="inbox-list">
        {data?.items.map((n) => (
          <article
            className={`inbox-item ${!n.read_at ? "is-unread" : ""}`}
            key={n.id}
          >
            <span className="inbox-icon" aria-hidden="true">
              <Bell size={18} />
            </span>
            <div className="inbox-item-content">
              <div className="inbox-item-heading">
                {n.href === "/account" ? (
                  <h4>{n.title}</h4>
                ) : (
                  <h4>
                    <Link to={n.href}>{n.title}</Link>
                  </h4>
                )}
                {!n.read_at && (
                  <span className="inbox-unread-label">Chưa đọc</span>
                )}
              </div>
              {n.body && (n.body.length > 160 ? <details className="inbox-message-details">
                <summary>{n.body.slice(0, 160)}… <span>Đọc tiếp</span></summary>
                <p className="inbox-message">{n.body}</p>
              </details> : <p className="inbox-message">{n.body}</p>)}
              <div className="inbox-item-footer">
                <time dateTime={n.created_at}>{date(n.created_at)}</time>
                {!n.read_at && (
                  <button
                    className="inbox-read-button"
                    disabled={busy}
                    onClick={() => read(n.id)}
                  >
                    Đánh dấu đã đọc
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {data && data.pages > 1 && (
        <nav className="inbox-pagination" aria-label={history ? 'Phân trang thông báo cũ' : 'Phân trang thông báo mới'}>
          <button
            type="button" aria-label="Trang trước"
            disabled={page <= 1 || busy}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft size={15} aria-hidden="true" /> Trước
          </button>
          <span className="inbox-page-number" aria-live="polite">Trang <strong>{page}</strong><span>/ {data.pages}</span></span>
          <button
            type="button" aria-label="Trang sau"
            disabled={page >= data.pages || busy}
            onClick={() => setPage(page + 1)}
          >
            Sau <ChevronRight size={15} aria-hidden="true" />
          </button>
        </nav>
      )}
      {!history && <div className="notification-history">
        <button type="button" className="notification-history-toggle" aria-expanded={showHistory} aria-controls="notification-history-content" onClick={() => { setHistoryLoaded(true); setShowHistory(v => !v); }}>
          {showHistory ? 'Thu gọn thông báo cũ' : 'Xem thông báo cũ'} <span aria-hidden="true">{showHistory ? '−' : '+'}</span>
        </button>
        <div id="notification-history-content" className={`notification-history-collapse ${showHistory ? 'is-open' : ''}`} inert={!showHistory} aria-hidden={!showHistory}>
          <div>{historyLoaded && <NotificationInbox key={version} history />}</div>
        </div>
      </div>}
    </section>
  );
}
