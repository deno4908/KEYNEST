import { useEffect, useId, useState } from "react";
import { useDataRefresh } from './useDataRefresh';
import { Monitor, ShieldCheck, Smartphone, LogOut } from "lucide-react";
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

export { NotificationInbox } from './Notifications';
