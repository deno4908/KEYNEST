import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useDataRefresh } from './useDataRefresh';
import { api, money, post } from "./api";
import { Modal } from "./App";
import {
  UsersRound,
  Store,
  ShieldCheck,
  LockKeyhole,
  UnlockKeyhole,
  RefreshCw,
  Wallet,
  Search,
} from "lucide-react";
import "./admin-customers.css";
type Customer = {
  role: "customer" | "seller";
  id: string;
  name: string;
  email: string;
  balance: number;
  access: { suspended: boolean; reason: string } | null;
};
type Result = { items: Customer[]; total: number; pages: number };
export function AdminCustomers() {
  const [data, setData] = useState<Result | null>(null);
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  useDataRefresh(() => setVersion(v => v + 1), ['/admin/customers/', '/admin/sellers/']);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    setError("");
    setData(null);
    const timer = setTimeout(
      () =>
        api<Result>(
          `/admin/customers?page=${page}&q=${encodeURIComponent(q)}${role ? `&role=${role}` : ""}`,
          { signal: c.signal },
        )
          .then(setData)
          .catch((e) => {
            if (!c.signal.aborted) setError(e.message);
          }),
      180,
    );
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [q, role, page, version]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setActionError("");
    try {
      await post(`/admin/customers/${selected.id}/access`, {
        suspended: !selected.access?.suspended,
        reason,
      });
      setSelected(null);
      setNotice("Đã cập nhật quyền truy cập tài khoản.");
      setVersion((v) => v + 1);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="admin-customers">
      <header className="customers-heading">
        <div>
          <span className="customers-eyebrow">QUẢN LÝ TÀI KHOẢN</span>
          <h2>Khách hàng</h2>
          <p>
            Tra cứu tài khoản, quản lý người bán và kiểm soát quyền truy cập.
          </p>
        </div>
        <button
          className="button button-outline"
          disabled={busy}
          onClick={() => setVersion((v) => v + 1)}
        >
          <RefreshCw size={15} /> Làm mới
        </button>
      </header>
      <div className="customers-toolbar">
        <div className="customers-filters" aria-label="Lọc theo vai trò">
          {[
            ["", "Tất cả"],
            ["customer", "Khách mua hàng"],
            ["seller", "Người bán"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={role === value}
              onClick={() => {
                setRole(value);
                setPage(1);
              }}
            >
              {value === "seller" ? (
                <Store size={16} />
              ) : (
                <UsersRound size={16} />
              )}
              {label}
            </button>
          ))}
        </div>
        <label className="field-title">
          <span>
            <Search size={14} /> Tìm theo email
          </span>
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Email khách hàng…"
          />
        </label>
      </div>
      {notice && (
        <p className="customers-notice" role="status">
          <ShieldCheck size={16} />
          {notice}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}{" "}
          <button onClick={() => setVersion((v) => v + 1)}>Thử lại</button>
        </p>
      )}
      {!data && !error && <p className="muted">Đang tải khách hàng…</p>}
      {data && (
        <>
          <div className="panel table-scroll customers-table">
            <div className="customers-list-heading">
              <strong>
                Danh sách tài khoản <span>{data.total}</span>
              </strong>
              <small>
                {role === "seller"
                  ? "Người bán trên KEYNEST"
                  : role === "customer"
                    ? "Tài khoản mua hàng"
                    : "Khách mua hàng & người bán"}
              </small>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Khách hàng</th>
                  <th>Vai trò</th>
                  <th>Số dư ví</th>
                  <th>Truy cập</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="customer-identity">
                        <span
                          className={`customer-avatar ${u.role === "seller" ? "is-seller" : ""}`}
                          aria-hidden="true"
                        >
                          {(u.name || u.email)
                            .trim()
                            .split(/\s+/)
                            .slice(-2)
                            .map((part) => part[0])
                            .join("")
                            .toUpperCase()}
                        </span>
                        <div>
                          <strong>{u.name || "Chưa đặt tên"}</strong>
                          <small>{u.email}</small>
                        </div>
                      </div>
                    </td>
                    <td data-label="Vai trò">
                      <span
                        className={`customer-role ${u.role === "seller" ? "is-seller" : ""}`}
                      >
                        {u.role === "seller" ? (
                          <Store size={13} />
                        ) : (
                          <UsersRound size={13} />
                        )}
                        {u.role === "seller" ? "Người bán" : "Khách hàng"}
                      </span>
                    </td>
                    <td data-label="Số dư ví">
                      <span className="customer-balance">
                        <Wallet size={14} />
                        {money(u.balance)}
                      </span>
                    </td>
                    <td data-label="Truy cập">
                      <span
                        className={`customer-status ${u.access?.suspended ? "is-locked" : ""}`}
                      >
                        <i />
                        {u.access?.suspended ? "Đã khóa" : "Hoạt động"}
                      </span>
                      {u.access?.reason && (
                        <small className="customer-reason">
                          {u.access?.suspended
                            ? "Lý do khóa: "
                            : "Ghi chú gần nhất: "}
                          {u.access.reason}
                        </small>
                      )}
                    </td>
                    <td>
                      <div className="customer-actions">
                        <button
                          className="button button-outline"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            setError("");
                            try {
                              await post("/admin/sellers/role", {
                                user_id: u.id,
                                role:
                                  u.role === "seller" ? "customer" : "seller",
                              });
                              setVersion((v) => v + 1);
                            } catch (e) {
                              setError((e as Error).message);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          <Store size={14} />
                          {u.role === "seller"
                            ? "Thu hồi seller"
                            : "Cấp quyền seller"}
                        </button>
                        <button
                          className={`button button-outline ${u.access?.suspended ? "" : "customer-lock"}`}
                          disabled={busy}
                          onClick={() => {
                            setSelected(u);
                            setReason("");
                            setActionError("");
                          }}
                        >
                          {u.access?.suspended ? (
                            <UnlockKeyhole size={14} />
                          ) : (
                            <LockKeyhole size={14} />
                          )}
                          {u.access?.suspended
                            ? "Mở tài khoản"
                            : "Khóa tài khoản"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.total && (
              <div className="customers-empty">
                <UsersRound size={30} strokeWidth={1.5} />
                <strong>
                  {q || role
                    ? "Không có tài khoản phù hợp"
                    : "Chưa có khách hàng"}
                </strong>
                <p>
                  {q
                    ? "Thử tìm với một địa chỉ email khác."
                    : "Các tài khoản khách hàng sẽ xuất hiện tại đây."}
                </p>
                {(q || role) && (
                  <button
                    className="button button-outline"
                    onClick={() => {
                      setQ("");
                      setRole("");
                      setPage(1);
                    }}
                  >
                    Xóa bộ lọc
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="customers-pagination">
            <button
              className="button button-outline"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Trước
            </button>
            <span>
              {data.total} khách · Trang {page} / {Math.max(1, data.pages)}
            </span>
            <button
              className="button button-outline"
              disabled={page >= data.pages}
              onClick={() => setPage(page + 1)}
            >
              Sau
            </button>
          </div>
        </>
      )}
      {selected && (
        <Modal
          title={selected.access?.suspended ? "Mở tài khoản" : "Khóa tài khoản"}
          close={() => {
            if (!busy) setSelected(null);
          }}
        >
          <form className="customer-access-form" onSubmit={submit}>
            <p>{selected.email}</p>
            <p className="muted">
              Khóa tài khoản sẽ chặn truy cập và thu hồi các phiên đã ghi nhận.
              Lịch sử đơn hàng và số dư được giữ lại.
            </p>
            <label className="field-title">
              Lý do
              <textarea
                required
                minLength={10}
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {actionError && (
              <p className="form-error" role="alert">
                {actionError}
              </p>
            )}
            <button
              className="button"
              disabled={busy || reason.trim().length < 10}
            >
              {busy ? "Đang lưu…" : "Lưu thay đổi"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
