import { OrderChat, type SellerDispute } from "./OrderChat";
import { useEffect, useState } from "react";
import { useDataRefresh } from "./useDataRefresh";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { Store, ExternalLink, ShieldCheck, ArrowRight } from "lucide-react";
import { api, post, money, date } from "./api";
import { Loading, Modal, useStore } from "./App";
import type { Product, User, OrderItem } from "./types";
import { SELLER_TERMS_VERSION, sellerTerms } from "../shared/seller-terms.js";
import "./seller.css";

export type Withdrawal = {
  id: string;
  user_id: string;
  amount: number;
  bank: string;
  account_number: string;
  account_name: string;
  status: string;
  reason: string;
  reference: string;
  created_at: string;
};
export type Sale = OrderItem & {
  seller_frozen?: boolean;
  seller_gross?: number;
  seller_fee?: number;
  seller_net?: number;
  seller_reversed_at?: string;
  order: {
    number: string;
    status: string;
    created_at: string;
    customer_note: string;
  };
};
export type SellerData = {
  profile: User;
  products: Product[];
  sales: Sale[];
  withdrawals: Withdrawal[];
  fee_bps: number;
  held?: number;
  disputes?: SellerDispute[];
  ledger?: import("./types").Ledger[];
};
const withdrawalStatus: Record<string, string> = {
  pending: "Chờ duyệt",
  paid: "Đã chuyển tiền",
  rejected: "Từ chối",
  cancelled: "Đã hủy để đối soát",
};
export function SellerContact({
  seller,
}: {
  seller: NonNullable<Product["seller"]>;
}) {
  return (
    <div className="seller-contact">
      <span className="seller-avatar">
        <Store size={22} />
      </span>
      <div>
        <small>Người bán</small>
        <strong>{seller.name}</strong>
      </div>
    </div>
  );
}
export function ProfileForm({
  profile,
  fee,
  saved,
}: {
  profile: User;
  fee: number;
  saved: () => Promise<void>;
}) {
  const { setUser } = useStore();
  const accepted =
    profile.seller_terms_version === SELLER_TERMS_VERSION &&
    !!profile.seller_terms_accepted_at;
  const [shopName, setShopName] = useState(profile.seller_name || profile.name);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const user = await post<User>(
        accepted ? "/seller/profile/name" : "/seller/profile",
        accepted
          ? { name: f.get("name") }
          : {
              name: f.get("name"),
              accepted: f.get("accepted") === "on",
              terms_version: SELLER_TERMS_VERSION,
              fee_bps: fee,
            },
      );
      setUser(user);
      await saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form panel seller-profile" onSubmit={submit}>
      <div className="seller-profile-heading">
        <span className="seller-profile-icon">
          <Store size={27} />
        </span>
        <div>
          <span className="eyebrow orange">HỒ SƠ NGƯỜI BÁN</span>
          <h2>
            {accepted ? "Hồ sơ gian hàng" : "Thiết lập gian hàng của bạn"}
          </h2>
          <p className="muted">
            {accepted ? 'Cập nhật tên hiển thị và xem điều khoản của gian hàng.' : 'Hoàn thiện thông tin và xem điều khoản trước khi bắt đầu bán hàng trên KEYNEST.'}
          </p>
        </div>
      </div>
      <div className="seller-setup-layout">
        <div className="seller-setup-main">
          <section className="seller-setup-section">
            <h3>
              <span>01</span> Thông tin gian hàng
            </h3>
            <label>
              Tên người bán / gian hàng
              <input
                name="name"
                required
                minLength={2}
                maxLength={80}
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
              />
            </label>
            <small>Tên này xuất hiện trên các sản phẩm bạn đăng bán.</small>
          </section>
          <section className="seller-setup-section">
            <h3>
              <span>02</span> Quyền lợi & trách nhiệm
            </h3>
            <div className="seller-terms">
              <h3>Điều khoản người bán</h3>
              <p>
                Phí hiện tại: <strong>{fee / 100}%</strong> trên giá trị sản
                phẩm sau giảm giá. Ví dụ bán 100.000đ, phí {money(fee * 10)},
                nhận {money(100000 - fee * 10)}.
              </p>
              {sellerTerms.map(([title, body]) => (
                <section key={title}>
                  <h4>{title}</h4>
                  <p>{body}</p>
                </section>
              ))}
            </div>
          </section>
        </div>
        <aside className="seller-setup-aside">
          <span className="eyebrow orange">HỒ SƠ HIỂN THỊ</span>
          <div className="seller-shop-preview">
            <Store size={28} />
            <strong>{shopName.trim() || "Tên gian hàng của bạn"}</strong>
            <span>Người bán trên KEYNEST</span>
          </div>
          <div className="seller-fee-preview">
            <span>Phí nền tảng</span>
            <strong>
              {fee / 100}
              <small>%</small>
            </strong>
            <p>Áp dụng trên giá trị sản phẩm sau giảm giá.</p>
            <dl>
              <div>
                <dt>Ví dụ bán</dt>
                <dd>{money(100000)}</dd>
              </div>
              <div>
                <dt>Phí website</dt>
                <dd>−{money(fee * 10)}</dd>
              </div>
              <div>
                <dt>Bạn nhận</dt>
                <dd>{money(100000 - fee * 10)}</dd>
              </div>
            </dl>
          </div>
          <p className="seller-setup-tip">
            <ShieldCheck size={18} />
            Bạn chịu trách nhiệm về chất lượng, giao hàng và bảo hành sản phẩm
            của mình.
          </p>
        </aside>
      </div>
      <div className="seller-setup-footer">
        {accepted ? (
          <p className="muted">
            Đã chấp nhận điều khoản ngày{" "}
            {date(profile.seller_terms_accepted_at!)}.
          </p>
        ) : (
          <label className="checkbox">
            <input type="checkbox" name="accepted" required />
            Tôi đã đọc và đồng ý với điều khoản người bán.
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button" disabled={busy}>
          {busy
            ? "Đang lưu…"
            : accepted
              ? "Lưu tên gian hàng"
              : "Đồng ý và lưu hồ sơ"}
          <ArrowRight size={16} />
        </button>
      </div>
    </form>
  );
}

export function WithdrawalList({
  withdrawals,
  review,
}: {
  withdrawals: Withdrawal[];
  review?: (w: Withdrawal) => void;
}) {
  return (
    <div className="seller-withdraw-list">
      {!withdrawals.length && (
        <p className="muted">Chưa có yêu cầu rút tiền.</p>
      )}
      {withdrawals.map((w) => (
        <article className="panel" key={w.id}>
          <div className="section-title">
            <strong>{money(w.amount)}</strong>
            <span>{withdrawalStatus[w.status] || w.status}</span>
          </div>
          <p>
            {w.bank} · {w.account_number} · {w.account_name}
          </p>
          <small>
            {date(w.created_at)} · {w.id.slice(0, 8)}
          </small>
          {w.reason && <p>{w.reason}</p>}
          {w.reference && <p>Mã chuyển khoản: {w.reference}</p>}
          {review && w.status === "pending" && (
            <button className="button button-outline" onClick={() => review(w)}>
              Xử lý yêu cầu
            </button>
          )}
        </article>
      ))}
    </div>
  );
}
export function AdminSellers() {
  const [chat, setChat] = useState<string | null>(null);
  const { notify } = useStore();
  const [data, setData] = useState<{
      disputes: SellerDispute[];
      sellers: User[];
      withdrawals: Withdrawal[];
      fee_bps: number;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState<Withdrawal | null>(null);
  const load = async () => {
    try {
      setData(await api("/admin/sellers"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useDataRefresh(load, ["/admin/", "/seller/", "/order-chat/"], {
    intervalMs: 5000,
  });
  async function fee(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await post("/admin/sellers/fee", {
        fee_bps: Math.round(Number(f.get("fee")) * 100),
      });
      await load();
      notify("Đã cập nhật phí cho đơn mới.");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function resolve(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await post(`/admin/sellers/withdrawals/${review!.id}`, {
        status: f.get("status"),
        reason: f.get("reason"),
        reference: f.get("reference"),
      });
      setReview(null);
      await load();
      notify("Đã xử lý yêu cầu.");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="seller-page">
      <h2>Người bán & rút tiền</h2>
      <p className="muted">Cấp hoặc thu hồi quyền seller tại mục Khách hàng.</p>
      {error && (
        <p role="alert">
          {error}
          <button onClick={load}>Thử lại</button>
        </p>
      )}
      {!data ? (
        !error && <Loading />
      ) : (
        <>
          <section>
            {data.disputes?.map((d) => (
              <article className="panel seller-support-card" key={d.item_id}>
                <strong>Yêu cầu hoàn tiền sản phẩm · {d.status === 'refunded' ? 'Đã hoàn tiền' : d.status === 'rejected' ? 'Đã từ chối' : 'Đang chờ'}</strong>
                {d.amount != null && <p>Số tiền: {money(d.amount)}</p>}
                {d.created_at && <small>Gửi lúc {date(d.created_at)}{['open','agreed'].includes(d.status) && ` · ${Date.now()-Date.parse(d.created_at)>=48*3600000 ? 'Quá 48 giờ' : 'Có thể can thiệp sớm'}`}</small>}
                <p>{d.reason}</p>
                <button
                  className="button button-outline"
                  onClick={() => setChat(d.item_id)}
                >
                  Xem và xử lý hoàn tiền
                </button>
              </article>
            ))}
          </section>
          <form className="panel form" onSubmit={fee}>
            <label>
              Phí nền tảng (%)
              <input
                name="fee"
                type="number"
                min={0}
                max={100}
                step={0.01}
                defaultValue={data.fee_bps / 100}
                required
              />
            </label>
            <small className="muted">
              Chỉ áp dụng cho đơn mới, không thay đổi phí đã lưu trên đơn cũ.
            </small>
            <button className="button" disabled={busy}>
              Lưu mức phí
            </button>
          </form>
          <div className="panel table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Người bán</th>
                  <th>Ví / cần bù trừ</th>
                  <th>Điều khoản</th>
                </tr>
              </thead>
              <tbody>
                {data.sellers.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {s.seller_name || s.name}
                      <p>{s.email}</p>
                    </td>

                    <td>
                      {money(s.balance)}
                      <p>{money(s.seller_debt || 0)}</p>
                    </td>
                    <td>
                      {s.seller_terms_accepted_at
                        ? date(s.seller_terms_accepted_at)
                        : "Chưa đồng ý"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Yêu cầu rút tiền</h3>
          <WithdrawalList withdrawals={data.withdrawals} review={setReview} />
        </>
      )}
      {chat && <OrderChat itemId={chat} close={() => setChat(null)} admin />}
      {review && (
        <Modal
          title="Xử lý rút tiền"
          close={() => {
            if (!busy) setReview(null);
          }}
        >
          <form className="form" onSubmit={resolve}>
            <strong>
              {money(review.amount)} · {review.account_name}
            </strong>
            <p>
              {review.bank} · {review.account_number}
            </p>
            <p>
              Chỉ xác nhận đã chuyển sau khi chuyển khoản thực tế thành công.
              Nút này ghi nhận kết quả, không tự chuyển tiền ngân hàng.
            </p>
            <label>
              Kết quả
              <select name="status">
                <option value="paid">Đã chuyển tiền</option>
                <option value="rejected">Từ chối và trả lại ví</option>
              </select>
            </label>
            <label>
              Mã giao dịch chuyển khoản
              <input name="reference" maxLength={200} />
            </label>
            <label>
              Ghi chú / lý do
              <textarea name="reason" required minLength={3} maxLength={1000} />
            </label>
            <button className="button" disabled={busy}>
              Xác nhận xử lý
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
