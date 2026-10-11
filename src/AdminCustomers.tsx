import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, money, post } from "./api";
import { Modal } from "./App";
import { UsersRound } from "lucide-react";
import "./admin-customers.css";
type Customer = {
  role: 'customer' | 'seller';
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
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
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
          `/admin/customers?page=${page}&q=${encodeURIComponent(q)}`,
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
  }, [q, page, version]);
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
        <h2>Khách hàng</h2>
        <p>Tra cứu số dư và quản lý quyền truy cập tài khoản.</p>
      </header>
      <label className="field-title">
        Tìm theo email
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
            <table>
              <thead>
                <tr>
                  <th>Khách hàng</th>
                  <th>Số dư ví</th>
                  <th>Truy cập</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id}>
                    <td>
                      {u.name}
                      <small>{u.email}</small>
                    </td>
                    <td>{money(u.balance)}</td>
                    <td>
                      {u.access?.suspended ? "Đã khóa" : "Hoạt động"}
                      {u.access?.reason && <small>{u.access.reason}</small>}
                    </td>
                    <td>
                      <button className="button button-outline" disabled={busy} onClick={async()=>{
                        setBusy(true);
                        try { await post('/admin/sellers/role',{user_id:u.id,role:u.role==='seller'?'customer':'seller'}); setVersion(v=>v+1); }
                        catch(e) { setError((e as Error).message); }
                        finally { setBusy(false); }
                      }}>{u.role==='seller'?'Thu hồi seller':'Cấp quyền seller'}</button>
                      <button
                        className="button button-outline"
                        onClick={() => {
                          setSelected(u);
                          setReason("");
                          setActionError("");
                        }}
                      >
                        {u.access?.suspended
                          ? "Mở tài khoản"
                          : "Khóa tài khoản"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.total && (
              <div className="customers-empty">
                <UsersRound size={30} strokeWidth={1.5} />
                <strong>
                  {q ? "Không tìm thấy khách hàng" : "Chưa có khách hàng"}
                </strong>
                <p>
                  {q
                    ? "Thử tìm với một địa chỉ email khác."
                    : "Các tài khoản khách hàng sẽ xuất hiện tại đây."}
                </p>
                {q && (
                  <button
                    className="button button-outline"
                    onClick={() => {
                      setQ("");
                      setPage(1);
                    }}
                  >
                    Xóa tìm kiếm
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
