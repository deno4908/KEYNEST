import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Bell,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Headphones,
  Mail,
  Package,
  RefreshCw,
  Search,
  ShoppingBag,
} from "lucide-react";
import { api, date, post } from "./api";
import { useDataRefresh } from "./useDataRefresh";
import "./notification-inbox.css";

type Notice = {
  id: string;
  title: string;
  body?: string;
  href: string;
  created_at: string;
  read_at: string | null;
  category?: string;
  category_label?: string;
};
type Inbox = {
  items: Notice[];
  page: number;
  pages: number;
  total: number;
  unread_count: number;
  snapshot_at?: string;
};
const categories = [
  ["all", "Tất cả loại"],
  ["orders", "Đơn hàng & trao đổi"],
  ["payments", "Thanh toán & số dư"],
  ["support", "Hỗ trợ"],
  ["catalog", "Sản phẩm & kiểm duyệt"],
  ["announcements", "Tin cửa hàng"],
  ["system", "Khác"],
];
const icons = {
  orders: ShoppingBag,
  payments: CreditCard,
  support: Headphones,
  catalog: Package,
  announcements: Mail,
};
type NotificationState = {
  data: Inbox | null;
  error: string;
  loading: boolean;
  version: number;
  refresh: () => Promise<void>;
  read: (id?: string, unread?: boolean, before?: string) => Promise<void>;
};
const NotificationContext = createContext<NotificationState | null>(null);
function useNotifications() {
  const state = useContext(NotificationContext);
  if (!state) throw new Error("NotificationProvider missing");
  return state;
}

// Key this provider by account ID; old requests and receipts cannot cross accounts.
export function NotificationProvider({
  userId,
  children,
}: {
  userId?: string;
  children: ReactNode;
}) {
  const [data, setData] = useState<Inbox | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);
  const generation = useRef(0);
  const current = useRef<{
    controller: AbortController;
    task: Promise<void>;
    again: boolean;
  } | null>(null);
  const latestData = useRef<Inbox | null>(null);
  const refresh = useCallback(async () => {
    if (!userId) return;
    if (current.current) {
      current.current.again = true;
      return current.current.task;
    }
    const epoch = generation.current;
    const controller = new AbortController();
    const run = { controller, task: Promise.resolve(), again: false };
    current.current = run;
    setLoading(true);
    run.task = (async () => {
      do {
        run.again = false;
        try {
          const result = await api<Inbox>(
            "/notifications?unread=1&page_size=8",
            { signal: controller.signal },
          );
          if (epoch !== generation.current || controller.signal.aborted) return;
          if (run.again) continue;
          latestData.current = result;
          setData(result);
          setError("");
        } catch (e) {
          if (epoch === generation.current && !controller.signal.aborted)
            setError((e as Error).message);
        }
      } while (
        run.again &&
        !controller.signal.aborted &&
        epoch === generation.current
      );
    })().finally(() => {
      if (current.current === run) {
        current.current = null;
        setLoading(false);
      }
    });
    return run.task;
  }, [userId]);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current++;
      current.current?.controller.abort();
      current.current = null;
    };
  }, [refresh]);
  useDataRefresh(
    refresh,
    [
      "/notifications/",
      "/order-chat/",
      "/admin/",
      "/seller/",
      "/tickets",
      "/orders",
    ],
    { intervalMs: 10000, enabled: !!userId },
  );
  const read = async (id?: string, unread = false, before?: string) => {
    const epoch = generation.current;
    const snapshot = before || latestData.current?.snapshot_at;
    await post(
      `/notifications/${unread ? "unread" : "read"}`,
      id ? { id } : { all: true, ...(snapshot ? { before: snapshot } : {}) },
    );
    if (epoch !== generation.current) return;
    setVersion((v) => v + 1);
    // Queue a fresh read even when a pre-mutation request is still in flight.
    await refresh();
  };
  return (
    <NotificationContext.Provider
      value={{ data, error, loading, version, refresh, read }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

function relativeTime(value: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 60000),
  );
  if (!Number.isFinite(minutes)) return "Chưa rõ thời gian";
  return minutes < 1
    ? "Vừa xong"
    : minutes < 60
      ? `${minutes} phút trước`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)} giờ trước`
        : `${Math.floor(minutes / 1440)} ngày trước`;
}
function NoticeCard({
  notice,
  compact = false,
}: {
  notice: Notice;
  compact?: boolean;
}) {
  const { read } = useNotifications();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const Icon = icons[notice.category as keyof typeof icons] || Bell;
  const safeHref =
    /^\/(?!\/)/.test(notice.href) && !/[\\\u0000-\u0020]/.test(notice.href)
      ? notice.href
      : "/notifications";
  return (
    <article className={`inbox-item ${notice.read_at ? "" : "is-unread"}`}>
      <span className="inbox-icon" aria-hidden="true">
        <Icon size={18} />
      </span>
      <div className="inbox-item-content">
        <div className="inbox-item-heading">
          <h4>
            <Link to={safeHref}>{notice.title}</Link>
          </h4>
          {!compact && !notice.read_at && (
            <span className="inbox-unread-label">Chưa đọc</span>
          )}
        </div>
        {!compact &&
          notice.body &&
          (notice.body.length > 160 ? (
            <details className="inbox-message-details">
              <summary>
                {notice.body.slice(0, 160)}… <span>Đọc tiếp</span>
              </summary>
              <p className="inbox-message">{notice.body}</p>
            </details>
          ) : (
            <p className="inbox-message">{notice.body}</p>
          ))}
        <div className="inbox-item-footer">
          <span>
            {!compact && <>{notice.category_label || "Thông báo"} · </>}
            <time dateTime={notice.created_at} title={date(notice.created_at)}>
              {relativeTime(notice.created_at)}
            </time>
          </span>
          <button
            type="button"
            className="inbox-read-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await read(notice.id, !!notice.read_at);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {notice.read_at ? "Đánh dấu chưa đọc" : "Đánh dấu đã đọc"}
          </button>
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}

export function NotificationBadge() {
  const { data, error } = useNotifications();
  if (!data?.unread_count) return null;
  return (
    <span
      className="header-chat-badge"
      role="status"
      aria-label={`${data.unread_count} thông báo chưa đọc`}
      title={
        error
          ? `${data.unread_count} chưa đọc · Chưa cập nhật được, sẽ thử lại`
          : `${data.unread_count} thông báo chưa đọc`
      }
    >
      {data.unread_count > 99 ? "99+" : data.unread_count}
    </span>
  );
}

export function NotificationInbox({
  compact = false,
  history = false,
}: { compact?: boolean; history?: boolean } = {}) {
  const notifications = useNotifications();
  const [status, setStatus] = useState(history ? "read" : "unread");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Inbox | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (compact) {
      setData(
        notifications.data
          ? {
              ...notifications.data,
              items: notifications.data.items.slice(0, 3),
            }
          : null,
      );
      setError(notifications.error);
      setLoading(notifications.loading);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      page: String(page),
      page_size: compact ? "3" : "12",
      category,
      q: search,
    });
    if (status !== "all") params.set(status, "1");
    api<Inbox>(`/notifications?${params}`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (page > Math.max(1, result.pages)) {
          setPage(Math.max(1, result.pages));
          return;
        }
        setData(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    page,
    status,
    category,
    search,
    compact,
    revision,
    notifications.version,
    notifications.data,
    compact ? notifications.loading : false,
    compact ? notifications.error : "",
  ]);
  return (
    <section
      className={`member-panel account-operations notification-inbox${compact ? " notification-preview" : ""}`}
      aria-busy={loading}
    >
      <div className="operations-heading">
        <div>
          <h3>
            <Bell size={19} /> {compact ? "Thông báo mới" : "Hộp thông báo"}
            {compact &&
              !!notifications.data?.unread_count &&
              ` (${notifications.data.unread_count})`}
          </h3>
          {!compact && (
            <p className="muted">
              {notifications.data
                ? `${notifications.data.unread_count} thông báo chưa đọc`
                : "Thông tin về đơn hàng, thanh toán và tài khoản"}
            </p>
          )}
        </div>
        <div className="inbox-heading-actions">
          {!compact && (
            <button
              type="button"
              className="icon-button"
              aria-label="Làm mới thông báo"
              disabled={loading}
              onClick={() => {
                setRevision((v) => v + 1);
                void notifications.refresh();
              }}
            >
              <RefreshCw size={16} />
            </button>
          )}
          <button
            type="button"
            className="button button-outline button-small"
            aria-label="Đánh dấu tất cả đã đọc"
            disabled={busy || !notifications.data?.unread_count}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await notifications.read(undefined, false, data?.snapshot_at);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <CheckCheck size={16} />{" "}
            {compact ? "Đọc tất cả" : "Đánh dấu tất cả đã đọc"}
          </button>
        </div>
      </div>
      {!compact && (
        <div className="inbox-tools">
          <div className="inbox-tabs" aria-label="Lọc trạng thái đọc">
            {[
              ["unread", "Chưa đọc"],
              ["all", "Tất cả"],
              ["read", "Đã đọc"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={status === id}
                onClick={() => {
                  setStatus(id);
                  setPage(1);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="inbox-search">
            <Search size={16} />
            <input
              aria-label="Tìm tiêu đề thông báo"
              value={query}
              maxLength={120}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm theo tiêu đề…"
            />
          </label>
          <select
            aria-label="Loại thông báo"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
          >
            {categories.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}{" "}
          <button
            onClick={() => {
              setRevision((v) => v + 1);
              if (compact) void notifications.refresh();
            }}
          >
            Thử lại
          </button>
        </p>
      )}
      {!data && loading && (
        <p className="muted" role="status">
          Đang tải thông báo…
        </p>
      )}
      {!compact && data && (
        <p className="inbox-result-count" role="status">
          {data.total} thông báo
          {search || category !== "all"
            ? " phù hợp bộ lọc"
            : status === "unread"
              ? " chưa đọc"
              : status === "read"
                ? " đã đọc"
                : ""}
          {loading ? " · Đang cập nhật…" : ""}
        </p>
      )}
      {data?.items.length === 0 &&
        (compact ? (
          <p className="muted inbox-empty-compact">
            Bạn đã xem hết thông báo mới
          </p>
        ) : (
          <div className="inbox-empty">
            <CheckCheck size={28} />
            <strong>
              {search || category !== "all"
                ? "Không tìm thấy thông báo phù hợp"
                : status === "unread"
                  ? "Bạn đã xem hết thông báo mới"
                  : "Chưa có thông báo"}
            </strong>
            <p>
              {search || category !== "all"
                ? "Thử từ khóa khác hoặc chọn tất cả loại."
                : "Các cập nhật mới sẽ xuất hiện tại đây."}
            </p>
          </div>
        ))}
      <div className="inbox-list">
        {data?.items.map((n) => (
          <NoticeCard key={n.id} notice={n} />
        ))}
      </div>
      {!compact && data && data.pages > 1 && (
        <nav className="inbox-pagination" aria-label="Phân trang thông báo">
          <button
            disabled={loading || page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft size={16} /> Trước
          </button>
          <span>
            Trang {page} / {data.pages}
          </span>
          <button
            disabled={loading || page >= data.pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Sau <ChevronRight size={16} />
          </button>
        </nav>
      )}
      {compact && (
        <Link className="inbox-view-all" to="/notifications">
          Xem thông báo cũ và tất cả thông báo <ChevronRight size={15} />
        </Link>
      )}
    </section>
  );
}
export function NotificationsPage() {
  return (
    <main className="container page notifications-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow orange">KEYNEST / HỘP THƯ</span>
          <h1>Thông báo của bạn.</h1>
          <p>
            Theo dõi cập nhật, tìm lại trao đổi và mở đúng công việc liên quan.
          </p>
        </div>
        <Link className="button button-outline" to="/account">
          Tài khoản
        </Link>
      </div>
      <NotificationInbox />
    </main>
  );
}
