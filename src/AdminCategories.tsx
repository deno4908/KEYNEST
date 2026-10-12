import { useEffect, useRef, useState } from "react";
import { Check, FolderOpen, Package, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { api, post } from "./api";
import { useDataRefresh } from './useDataRefresh';
import { useStore } from "./App";
import type { Product } from "./types";
import "./admin-categories.css";

type CategoryRow = { id: string; name: string; sort_order: number };
const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
const slug = (text: string) =>
  normalize(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .slice(0, 40)
    .replace(/-$/, "");
const byOrder = (a: CategoryRow, b: CategoryRow) =>
  a.sort_order - b.sort_order || a.id.localeCompare(b.id);
const blank = (rows: CategoryRow[]): CategoryRow => ({
  id: "",
  name: "",
  sort_order: Math.min(
    9999,
    Math.max(-1, ...rows.map((row) => row.sort_order)) + 1,
  ),
});

export function AdminCategories({
  products,
  onEditProduct,
}: {
  products: Product[];
  onEditProduct: (product: Product) => void;
}) {
  const { refresh } = useStore();
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<CategoryRow>(blank([]));
  const [manualId, setManualId] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("order");
  const [expanded, setExpanded] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  useDataRefresh(async () => {
    try { setRows(await api<CategoryRow[]>("/categories")); }
    catch (e) { setError((e as Error).message); }
  }, ['/admin/categories']);
  useEffect(() => {
    let active = true;
    api<CategoryRow[]>("/categories")
      .then((data) => {
        if (active) {
          setRows(data);
          setValue(blank(data));
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const members = (id: string) =>
    products.filter((product) => product.category === id);
  const emptyCount = rows.filter((row) => !members(row.id).length).length;
  const visible = rows
    .filter(
      (row) =>
        normalize(`${row.name} ${row.id}`).includes(normalize(query.trim())) &&
        (filter === "all" ||
          (filter === "empty"
            ? members(row.id).length === 0
            : members(row.id).length > 0)),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name, "vi")
        : sort === "count"
          ? members(b.id).length - members(a.id).length || byOrder(a, b)
          : byOrder(a, b),
    );
  const preview = [
    ...rows.filter((row) => !editing || row.id !== value.id),
    ...(value.name.trim() ? [{ ...value, name: value.name.trim() }] : []),
  ].sort(byOrder);
  function start(row?: CategoryRow) {
    setEditing(Boolean(row));
    setValue(row ? { ...row } : blank(rows));
    setManualId(false);
    setError("");
    setMessage("");
    nameInput.current?.focus();
  }
  async function remove(row: CategoryRow) {
    if (!window.confirm(`Xóa danh mục “${row.name}”? Thao tác này không thể hoàn tác.`)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/admin/categories/${encodeURIComponent(row.id)}`, { method: "DELETE" });
      const updated = rows.filter(r => r.id !== row.id);
      setRows(updated);
      if (value.id === row.id) { setEditing(false); setManualId(false); setValue(blank(updated)); }
      if (expanded === row.id) setExpanded(null);
      setMessage(`Đã xóa danh mục “${row.name}”.`);
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <div className="category-manager">
      <div className="admin-section-heading">
        <div>
          <h2>Danh mục sản phẩm</h2>
          <p>Tổ chức sản phẩm và quản lý thứ tự hiển thị trên cửa hàng.</p>
        </div>
        <button
          className="button"
          disabled={busy || loading}
          onClick={() => start()}
        >
          <Plus size={16} /> Thêm danh mục
        </button>
      </div>
      <div className="admin-metrics">
        <button
          className={filter === "all" ? "selected" : ""}
          onClick={() => setFilter("all")}
        >
          <span>Tất cả danh mục</span>
          <strong>{loading ? "—" : rows.length}</strong>
        </button>
        <button
          className={filter === "used" ? "selected" : ""}
          onClick={() => setFilter("used")}
        >
          <span>Có sản phẩm</span>
          <strong>{loading ? "—" : rows.length - emptyCount}</strong>
        </button>
        <button
          className={filter === "empty" ? "selected" : ""}
          onClick={() => setFilter("empty")}
        >
          <span>Danh mục trống</span>
          <strong>{loading ? "—" : emptyCount}</strong>
        </button>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="category-success">
          <Check size={16} />
          {message}
        </p>
      )}
      <div className="category-workspace">
        <section
          className="panel category-library"
          aria-label="Danh sách danh mục"
        >
          <div className="category-panel-heading">
            <div>
              <h3>Danh sách danh mục</h3>
              <p>
                {visible.length} / {rows.length} danh mục · Tính cả sản phẩm đã
                ẩn
              </p>
            </div>
            <FolderOpen size={21} />
          </div>
          <div className="admin-tools">
            <label>
              <Search size={17} />
              <input
                aria-label="Tìm danh mục"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tìm tên hoặc mã danh mục…"
              />
            </label>
            <select
              aria-label="Sắp xếp danh mục"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="order">Thứ tự hiển thị</option>
              <option value="name">Tên A–Z</option>
              <option value="count">Nhiều sản phẩm nhất</option>
            </select>
          </div>
          <div className="category-list">
            {loading ? (
              <p className="admin-empty-line">Đang tải danh mục…</p>
            ) : visible.length === 0 ? (
              <div className="admin-empty-line">
                <FolderOpen size={28} />
                <p>
                  {rows.length
                    ? "Không có danh mục phù hợp."
                    : "Chưa có danh mục. Tạo danh mục đầu tiên bằng biểu mẫu."}
                </p>
                {rows.length > 0 && (
                  <button
                    className="button button-outline"
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                    }}
                  >
                    Xóa bộ lọc
                  </button>
                )}
              </div>
            ) : (
              visible.map((row) => {
                const items = members(row.id);
                const activeCount = items.filter(
                  (product) => product.active,
                ).length;
                return (
                  <article
                    key={row.id}
                    className={`category-item${editing && value.id === row.id ? " is-editing" : ""}`}
                  >
                    <div className="category-item-main">
                      <span className="category-icon">
                        <FolderOpen size={21} />
                      </span>
                      <div className="category-identity">
                        <h4>{row.name}</h4>
                        <code>{row.id}</code>
                      </div>
                      <span className="category-order" title="Thứ tự hiển thị">
                        #{row.sort_order}
                      </span>
                      <button
                        className="category-edit"
                        aria-label={`Sửa ${row.name}`}
                        disabled={busy}
                        onClick={() => start(row)}
                      >
                        <Pencil size={15} />
                        <span>Sửa</span>
                      </button>
                      <button className="category-edit admin-delete-button" aria-label={`Xóa ${row.name}`} disabled={busy} onClick={() => void remove(row)}>
                        <Trash2 size={15} /><span>Xóa</span>
                      </button>
                    </div>
                    <div className="category-item-footer">
                      <button
                        disabled={!items.length}
                        aria-expanded={expanded === row.id}
                        onClick={() =>
                          setExpanded(expanded === row.id ? null : row.id)
                        }
                      >
                        <Package size={14} />
                        {items.length} sản phẩm{" "}
                        {items.length > 0 && (
                          <span>
                            {expanded === row.id ? "· Thu gọn" : "· Xem"}
                          </span>
                        )}
                      </button>
                      <span>
                        {activeCount} đang bán · {items.length - activeCount} đã
                        ẩn
                      </span>
                    </div>
                    {expanded === row.id && (
                      <div className="category-products">
                        {items.map((product) => (
                          <button
                            key={product.id}
                            onClick={() => onEditProduct(product)}
                            disabled={busy}
                          >
                            <span>
                              {product.name}
                              <small>
                                {product.active ? "Đang bán" : "Đã ẩn"}
                              </small>
                            </span>
                            <Pencil size={14} />
                          </button>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </div>
        </section>
        <form
          className="panel category-editor"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setMessage("");
            const input = { ...value, name: value.name.trim() };
            if (input.name.length < 2) {
              setError("Tên danh mục cần ít nhất 2 ký tự.");
              return;
            }
            if (
              !editing &&
              (["all", "constructor", "prototype"].includes(input.id) ||
                rows.some((row) => row.id === input.id))
            ) {
              setError("Mã danh mục đã được sử dụng. Hãy chọn mã khác.");
              return;
            }
            setBusy(true);
            try {
              if (editing)
                await api(`/admin/categories/${encodeURIComponent(input.id)}`, {
                  method: "PATCH",
                  body: JSON.stringify({
                    name: input.name,
                    sort_order: input.sort_order,
                  }),
                });
              else await post("/admin/categories", input);
              const updated = [
                ...rows.filter((row) => row.id !== input.id),
                input,
              ].sort(byOrder);
              setRows(updated);
              setEditing(false);
              setManualId(false);
              setValue(blank(updated));
              setMessage(`Đã lưu danh mục “${input.name}”.`);
              try {
                await refresh();
              } catch {
                setError(
                  "Danh mục đã lưu. Tải lại trang để cập nhật dữ liệu cửa hàng.",
                );
              }
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="category-panel-heading">
            <div>
              <span className="category-eyebrow">
                {editing ? "CHỈNH SỬA" : "TẠO MỚI"}
              </span>
              <h3>
                {editing ? value.name || "Sửa danh mục" : "Thêm danh mục"}
              </h3>
            </div>
            {editing ? <Pencil size={20} /> : <Plus size={20} />}
          </div>
          <fieldset disabled={busy || loading}>
            <label className="field-title">
              Tên hiển thị
              <input
                ref={nameInput}
                required
                minLength={2}
                maxLength={60}
                value={value.name}
                onChange={(e) =>
                  setValue({
                    ...value,
                    name: e.target.value,
                    id: !editing && !manualId ? slug(e.target.value) : value.id,
                  })
                }
                placeholder="Ví dụ: Phần mềm"
              />
            </label>
            <label className="field-title">
              Mã danh mục
              <input
                required
                disabled={editing}
                pattern="[a-z][a-z0-9-]*"
                maxLength={40}
                value={value.id}
                onChange={(e) => {
                  setManualId(true);
                  setValue({ ...value, id: e.target.value });
                }}
                placeholder="phan-mem"
              />
            </label>
            <small className="muted">
              {editing
                ? "Mã được giữ cố định để liên kết sản phẩm không thay đổi."
                : "Tự gợi ý từ tên. Bạn có thể sửa trước khi tạo; dùng chữ thường không dấu, số và dấu gạch ngang."}
            </small>
            <label className="field-title">
              Thứ tự hiển thị
              <input
                type="number"
                required
                min={0}
                max={9999}
                step={1}
                value={value.sort_order}
                onChange={(e) =>
                  setValue({ ...value, sort_order: Number(e.target.value) })
                }
              />
            </label>
            <small className="muted">
              Số nhỏ hơn hiển thị trước. Nếu trùng thứ tự, danh mục được xếp
              theo mã.
            </small>
            <div className="category-preview">
              <span>Xem trước thứ tự menu</span>
              <div>
                {preview.map((row, index) => (
                  <span
                    key={`${row.id}-${index}`}
                    className={
                      value.name.trim() && row.id === value.id ? "selected" : ""
                    }
                  >
                    {row.name}
                  </span>
                ))}
              </div>
              <small>Thay đổi được áp dụng sau khi lưu.</small>
            </div>
            <div className="category-form-actions">
              <button className="button" type="submit">
                {busy ? "Đang lưu…" : editing ? "Lưu thay đổi" : "Tạo danh mục"}
              </button>
              <button
                type="button"
                className="button button-outline"
                onClick={() => start()}
              >
                {editing ? "Hủy" : "Làm mới"}
              </button>
            </div>
          </fieldset>
        </form>
      </div>
    </div>
  );
}
