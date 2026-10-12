import { useState } from "react";
import type { FormEvent } from "react";
import { Copy, Pencil, Plus, Search, TicketPercent, Pin, Trash2 } from "lucide-react";
import { Badge, Modal, useStore } from "./App";
import { api, categories, date, money, post } from "./api";
import type { Coupon, Product } from "./types";

export const couponValue = (c: Coupon) =>
  c.discount_type === "fixed" ? money(c.fixed_amount || 0) : `${c.percent}%`;
function couponState(c: Coupon) {
  if (!c.active) return "Đã tắt";
  if (c.expires_at && Date.parse(c.expires_at) <= Date.now()) return "Hết hạn";
  if (c.starts_at && Date.parse(c.starts_at) > Date.now()) return "Sắp bắt đầu";
  if (
    c.total_limit &&
    (c.used_count || 0) + (c.reserved_count || 0) >= c.total_limit
  )
    return "Hết lượt";
  return "Đang dùng";
}
const emptyCoupon: Coupon = {
  code: "",
  percent: 10,
  max_discount: 100000,
  active: true,
  expires_at: null,
  discount_type: "percent",
  fixed_amount: 20000,
  min_subtotal: 0,
  total_limit: null,
  per_user_limit: null,
  starts_at: null,
  category: "all",
  product_ids: [],
  first_order_only: false,
};
export function CouponManager({
  coupons,
  products,
  saved,
}: {
  coupons: Coupon[];
  products: Product[];
  saved: () => Promise<void>;
}) {
  const { notify } = useStore();
  const [pinBusy, setPinBusy] = useState(false);
  const [editing, setEditing] = useState<Coupon | null>(null),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all");
  const rows = [...coupons]
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))
    .filter(
      (c) =>
        c.code.includes(query.trim().toUpperCase()) &&
        (filter === "all" || couponState(c) === filter),
    );
  return (
    <div className="admin-coupons">
      <div className="admin-section-heading">
        <div>
          <h2>Mã giảm giá</h2>
          <p>
            Quản lý điều kiện, ngân sách và lượt dùng của từng chương trình.
          </p>
        </div>
        <button
          className="button button-small"
          onClick={() => setEditing({ ...emptyCoupon })}
        >
          <Plus size={16} />
          Thêm mã
        </button>
      </div>
      <div className="admin-metrics">
        <div>
          <span>Tổng số mã</span>
          <strong>{coupons.length}</strong>
        </div>
        <div>
          <span>Đang áp dụng</span>
          <strong>
            {coupons.filter((c) => couponState(c) === "Đang dùng").length}
          </strong>
        </div>
        <div>
          <span>Lượt đã dùng</span>
          <strong>
            {coupons.reduce((n, c) => n + (c.used_count || 0), 0)}
          </strong>
        </div>
      </div>
      <div className="admin-tools">
        <label>
          <Search size={16} />
          <input
            aria-label="Tìm mã giảm giá"
            placeholder="Tìm mã giảm giá…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="Trạng thái mã giảm giá"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          {[
            "all",
            "Đang dùng",
            "Sắp bắt đầu",
            "Hết lượt",
            "Hết hạn",
            "Đã tắt",
          ].map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "Tất cả trạng thái" : s}
            </option>
          ))}
        </select>
      </div>
      <div className="panel table-scroll">
        <table className="admin-coupon-table">
          <thead>
            <tr>
              <th>Mã / mức giảm</th>
              <th>Điều kiện</th>
              <th>Lượt sử dụng</th>
              <th>Hiệu lực</th>
              <th>Trạng thái</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.code}>
                <td>
                  <strong className="mono">{c.code}</strong>
                  <small>
                    Giảm {couponValue(c)}
                    {c.discount_type !== "fixed"
                      ? ` · Tối đa ${money(c.max_discount)}`
                      : ""}
                  </small>
                </td>
                <td>
                  <span>Đơn từ {money(c.min_subtotal || 0)}</span>
                  <small>
                    {categories[c.category || "all"]}
                    {c.product_ids?.length
                      ? ` · ${c.product_ids.length} sản phẩm`
                      : ""}
                    {c.first_order_only ? " · Khách mua lần đầu" : ""}
                  </small>
                </td>
                <td>
                  <strong>
                    {c.used_count || 0} / {c.total_limit || "∞"}
                  </strong>
                  <small>
                    {c.reserved_count || 0} lượt đang giữ ·{" "}
                    {c.per_user_limit
                      ? `${c.per_user_limit} lần/khách`
                      : "Không giới hạn/khách"}
                  </small>
                </td>
                <td>
                  <span>
                    {c.starts_at ? date(c.starts_at) : "Áp dụng ngay"}
                  </span>
                  <small>
                    {c.expires_at
                      ? `Đến ${date(c.expires_at)}`
                      : "Không hết hạn"}
                  </small>
                </td>
                <td>
                  <Badge status={couponState(c)} />
                </td>
                <td>
                  <div className="admin-row-actions">
                    <button
                      className="icon-button"
                      disabled={pinBusy}
                      aria-pressed={!!c.pinned}
                      aria-label={`${c.pinned ? "Bỏ ghim" : "Ghim"} mã ${c.code}`}
                      title={c.pinned ? "Bỏ ghim mã" : "Ghim lên đầu ưu đãi"}
                      style={{ color: c.pinned ? "#efa777" : undefined }}
                      onClick={async () => {
                        setPinBusy(true);
                        try {
                          await post(
                            `/admin/coupons/${encodeURIComponent(c.code)}/pin`,
                            { pinned: !c.pinned },
                          );
                          await saved();
                          notify(
                            c.pinned
                              ? "Đã bỏ ghim mã."
                              : "Đã ghim mã giảm giá.",
                          );
                        } catch (e) {
                          notify((e as Error).message, true);
                        } finally {
                          setPinBusy(false);
                        }
                      }}
                    >
                      <Pin
                        size={15}
                        fill={c.pinned ? "currentColor" : "none"}
                      />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Sao chép mã ${c.code}`}
                      onClick={() =>
                        navigator.clipboard
                          .writeText(c.code)
                          .then(() => notify("Đã sao chép mã."))
                          .catch(() => notify("Không thể sao chép.", true))
                      }
                    >
                      <Copy size={15} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Sửa mã giảm giá"
                      onClick={() => setEditing(c)}
                    >
                      <Pencil size={15} />
                    </button>
                    <button className="button button-outline button-small admin-delete-button" aria-label={`Xóa mã ${c.code}`} disabled={pinBusy} onClick={async () => {
                      if (!window.confirm(`Xóa mã giảm giá ${c.code}? Thao tác này không thể hoàn tác.`)) return;
                      setPinBusy(true);
                      try {
                        await api(`/admin/coupons/${encodeURIComponent(c.code)}`, { method: "DELETE" });
                        await saved(); notify("Đã xóa mã giảm giá.");
                      } catch (e) { notify((e as Error).message, true); }
                      finally { setPinBusy(false); }
                    }}><Trash2 size={15} />Xóa</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="admin-empty-line">Không có mã giảm giá phù hợp.</p>
        )}
      </div>
      {editing && (
        <CouponEditor
          value={editing}
          products={products}
          close={() => setEditing(null)}
          saved={async () => {
            await saved();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
function localDate(value?: string | null) {
  return value
    ? new Date(Date.parse(value) - new Date(value).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";
}
function CouponEditor({
  value,
  products,
  close,
  saved,
}: {
  value: Coupon;
  products: Product[];
  close: () => void;
  saved: () => Promise<void>;
}) {
  const { notify } = useStore();
  const [kind, setKind] = useState(value.discount_type || "percent"),
    [scope, setScope] = useState(value.product_ids || []),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [totalLimit, setTotalLimit] = useState(
      value.total_limit?.toString() || "",
    ),
    [userLimit, setUserLimit] = useState(
      value.per_user_limit?.toString() || "",
    );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      await post("/admin/coupons", {
        code: String(f.get("code")).trim().toUpperCase(),
        discount_type: kind,
        percent: kind === "percent" ? Number(f.get("percent")) : 1,
        fixed_amount: kind === "fixed" ? Number(f.get("fixed_amount")) : 0,
        max_discount:
          kind === "percent" ? Number(f.get("max_discount")) : 100000000,
        min_subtotal: Number(f.get("min_subtotal")),
        total_limit: totalLimit ? Number(totalLimit) : null,
        per_user_limit: userLimit ? Number(userLimit) : null,
        starts_at: f.get("starts_at")
          ? new Date(String(f.get("starts_at"))).toISOString()
          : null,
        expires_at: f.get("expires_at")
          ? new Date(String(f.get("expires_at"))).toISOString()
          : null,
        category: f.get("category"),
        product_ids: scope,
        first_order_only: f.get("first_order_only") === "on",
        active: f.get("active") === "on",
      });
      await saved();
      notify("Đã lưu mã giảm giá.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={value.code ? `Chỉnh sửa ${value.code}` : "Tạo mã giảm giá"}
      close={close}
      wide
      className="admin-dialog coupon-editor"
    >
      <form className="form admin-editor-form" onSubmit={submit}>
        <div className="admin-dialog-intro">
          <TicketPercent size={23} />
          <div>
            <strong>Thiết lập ưu đãi</strong>
            <p>
              Lượt của đơn chờ thanh toán được giữ đến khi đơn hết hạn hoặc bị
              hủy.
            </p>
          </div>
        </div>
        <div className="form-grid">
          <label>
            Mã
            <input
              name="code"
              defaultValue={value.code}
              readOnly={!!value.code}
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9_-]+"
              required
              placeholder="VD: GAMEWEEKEND"
            />
          </label>
          <label>
            Loại giảm giá
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as "percent" | "fixed")}
            >
              <option value="percent">Theo phần trăm (%)</option>
              <option value="fixed">Số tiền cố định (VND)</option>
            </select>
          </label>
          {kind === "percent" ? (
            <>
              <label>
                Phần trăm giảm
                <input
                  name="percent"
                  type="number"
                  min={1}
                  max={90}
                  defaultValue={value.percent}
                  required
                />
              </label>
              <label>
                Số tiền giảm tối đa (VND)
                <input
                  name="max_discount"
                  type="number"
                  min={1000}
                  max={100000000}
                  defaultValue={value.max_discount}
                  required
                />
              </label>
            </>
          ) : (
            <label>
              Số tiền giảm (VND)
              <input
                name="fixed_amount"
                type="number"
                min={1000}
                max={100000000}
                defaultValue={value.fixed_amount || 20000}
                required
              />
            </label>
          )}
          <label>
            Đơn tối thiểu (VND)
            <input
              name="min_subtotal"
              type="number"
              min={0}
              max={100000000}
              defaultValue={value.min_subtotal || 0}
              required
            />
          </label>
          <label>
            Nhóm sản phẩm
            <select name="category" defaultValue={value.category || "all"}>
              {Object.entries(categories).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset className="admin-form-section">
          <legend>Giới hạn sử dụng</legend>
          <div className="coupon-presets">
            <button
              type="button"
              onClick={() => {
                setTotalLimit("1");
                setUserLimit("1");
              }}
            >
              Một lượt duy nhất
            </button>
            <button
              type="button"
              onClick={() => {
                setTotalLimit("");
                setUserLimit("1");
              }}
            >
              Mỗi khách một lần
            </button>
            <button
              type="button"
              onClick={() => {
                setTotalLimit("");
                setUserLimit("");
              }}
            >
              Không giới hạn
            </button>
          </div>
          <div className="form-grid">
            <label>
              Tổng lượt toàn cửa hàng
              <input
                type="number"
                min={1}
                max={1000000}
                value={totalLimit}
                onChange={(e) => setTotalLimit(e.target.value)}
                placeholder="Không giới hạn"
              />
            </label>
            <label>
              Lượt tối đa mỗi tài khoản
              <input
                type="number"
                min={1}
                max={1000000}
                value={userLimit}
                onChange={(e) => setUserLimit(e.target.value)}
                placeholder="Không giới hạn"
              />
            </label>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              name="first_order_only"
              defaultChecked={value.first_order_only}
            />
            Chỉ dành cho đơn đầu tiên
          </label>
          <small>
            Đơn đã hoàn tiền vẫn tính là một lượt sử dụng. Mã giảm tối đa đến
            khi tổng đơn còn 1.000đ.
          </small>
        </fieldset>
        <div className="form-grid">
          <label>
            Bắt đầu (giờ địa phương)
            <input
              type="datetime-local"
              name="starts_at"
              defaultValue={localDate(value.starts_at)}
            />
          </label>
          <label>
            Hết hạn (giờ địa phương)
            <input
              type="datetime-local"
              name="expires_at"
              defaultValue={localDate(value.expires_at)}
            />
          </label>
        </div>
        <details className="coupon-product-scope">
          <summary>
            Giới hạn sản phẩm cụ thể{" "}
            {scope.length ? `(${scope.length} đã chọn)` : "(tùy chọn)"}
          </summary>
          <small>
            Bỏ trống để áp dụng cho tất cả sản phẩm thuộc nhóm đã chọn.
          </small>
          <div>
            {products.map((p) => (
              <label className="checkbox" key={p.id}>
                <input
                  type="checkbox"
                  checked={scope.includes(p.id)}
                  onChange={(e) =>
                    setScope((ids) =>
                      e.target.checked
                        ? [...ids, p.id]
                        : ids.filter((id) => id !== p.id),
                    )
                  }
                />
                {p.name}
              </label>
            ))}
          </div>
        </details>
        <label className="checkbox">
          <input type="checkbox" name="active" defaultChecked={value.active} />
          Đang dùng
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="admin-dialog-footer">
          <button
            type="button"
            className="button button-outline"
            onClick={close}
          >
            Hủy
          </button>
          <button className="button" disabled={busy}>
            {busy ? "Đang lưu…" : "Lưu mã giảm giá"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
