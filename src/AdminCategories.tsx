import { useEffect, useState } from 'react';
import { api, post } from './api';
import { useStore } from './App';
type CategoryRow = { id: string; name: string; sort_order: number };
export function AdminCategories() {
  const { refresh } = useStore();
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<CategoryRow>({ id: '', name: '', sort_order: 4 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = () => api<CategoryRow[]>('/categories').then(setRows);
  useEffect(() => { load().catch((e) => setError(e.message)); }, []);
  return <div style={{ display: 'grid', gap: 24 }}><div><h2>Danh mục sản phẩm</h2><p className="muted">Danh mục xuất hiện trong menu, bộ lọc và form sản phẩm. Thứ tự nhỏ hơn hiển thị trước.</p></div>
    <form className="panel" style={{ display: 'grid', gap: 16 }} onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setError('');
      try {
        if (editing) await api(`/admin/categories/${encodeURIComponent(value.id)}`, { method: 'PATCH', body: JSON.stringify({ name: value.name, sort_order: value.sort_order }) });
        else await post('/admin/categories', value);
        await load(); await refresh(); setEditing(false); setValue({ id: '', name: '', sort_order: 4 });
      } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}>
      <h3>{editing ? 'Sửa danh mục' : 'Thêm danh mục'}</h3>
      <label className="field-title">Tên hiển thị<input required minLength={2} maxLength={60} value={value.name} onChange={(e) => setValue({ ...value, name: e.target.value })} placeholder="Ví dụ: Phần mềm" /></label>
      <label className="field-title">Mã danh mục<input required disabled={editing} pattern="[a-z][a-z0-9-]*" maxLength={40} value={value.id} onChange={(e) => setValue({ ...value, id: e.target.value })} placeholder="phan-mem" /></label>
      <small className="muted">Chữ thường không dấu, số và dấu gạch ngang. Mã được giữ cố định để liên kết sản phẩm không bị thay đổi.</small>
      <label className="field-title">Thứ tự<input type="number" required min={0} max={9999} value={value.sort_order} onChange={(e) => setValue({ ...value, sort_order: Number(e.target.value) })} /></label>
      <div style={{ display: 'flex', gap: 12 }}><button className="button" disabled={busy}>{busy ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Thêm danh mục'}</button>{editing && <button type="button" className="button button-outline" disabled={busy} onClick={() => { setEditing(false); setValue({ id: '', name: '', sort_order: 4 }); }}>Hủy</button>}</div>
      {error && <p role="alert" className="form-error">{error}</p>}
    </form>
    <div className="panel table-scroll"><table><thead><tr><th>Danh mục</th><th>Mã</th><th>Thứ tự</th><th>Thao tác</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.name}</td><td>{row.id}</td><td>{row.sort_order}</td><td><button className="button button-outline" disabled={busy} onClick={() => { setValue(row); setEditing(true); setError(''); }}>Sửa</button></td></tr>)}</tbody></table></div>
  </div>;
}
