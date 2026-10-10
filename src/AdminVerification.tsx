import { useEffect, useState } from "react";
import { Mail, ArrowRight, ArrowLeft } from "lucide-react";
import { api, post } from "./api";
import "./two-factor.css";
type Status = {
  verified: boolean;
  email: string;
  sent: boolean;
  retry_after: number;
};
export function AdminVerification() {
  const [status, setStatus] = useState<Status>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<Status>("/auth/admin-otp/status", { signal: controller.signal })
      .then((s) => {
        setStatus(s);
        setRemaining(s.retry_after);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!remaining) return;
    const timer = window.setTimeout(
      () => setRemaining((r) => Math.max(0, r - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [remaining]);
  async function send() {
    if (busy || remaining) return;
    setBusy(true);
    setError("");
    try {
      const data = await post<{ retry_after: number }>("/auth/admin-otp/send");
      setStatus((s) => (s ? { ...s, sent: true } : s));
      setRemaining(data.retry_after);
      setCode("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const clean = (value: string) =>
    value.normalize("NFKC").replace(/\D/g, "").slice(0, 10);
  return (
    <div className="mfa-login-shell">
      <section className="mfa-login-card" aria-labelledby="admin-otp-title">
        <div className="mfa-login-brand">
          <span>//</span> KEYNEST{" "}
          <span className="mfa-login-step">QUẢN TRỊ</span>
        </div>
        <div className="mfa-login-icon">
          <Mail size={27} />
        </div>
        <h1 id="admin-otp-title">Xác minh email admin</h1>
        <p className="mfa-login-description">
          Mỗi phiên đăng nhập quản trị cần xác minh bằng mã gửi tới email của
          tài khoản.
          {status && (
            <>
              {" "}
              Email nhận mã: <strong>{status.email}</strong>.
            </>
          )}
        </p>
        {!status && !error && <p role="status">Đang kiểm tra phiên…</p>}
        {status?.verified ? (
          <a className="button" href="/admin">
            Vào trang quản trị
            <ArrowRight size={16} />
          </a>
        ) : (
          status && (
            <>
              {status.sent && (
                <form
                  className="mfa-login-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (busy || !/^\d{6,10}$/.test(code)) return;
                    setBusy(true);
                    setError("");
                    try {
                      await post("/auth/admin-otp/verify", { code });
                      window.location.assign("/admin");
                    } catch (err) {
                      setError((err as Error).message);
                      setBusy(false);
                    }
                  }}
                >
                  <label htmlFor="admin-email-code">Mã OTP trong email</label>
                  <input
                    id="admin-email-code"
                    className="mfa-login-code"
                    style={{ letterSpacing: 4, fontSize: 24 }}
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    pattern="[0-9]{6,10}"
                    maxLength={10}
                    required
                    value={code}
                    disabled={busy}
                    aria-invalid={!!error}
                    onChange={(e) => {
                      setCode(clean(e.target.value));
                      setError("");
                    }}
                    onPaste={(e) => {
                      e.preventDefault();
                      setCode(clean(e.clipboardData.getData("text")));
                      setError("");
                    }}
                  />
                  <p className="mfa-login-hint">
                    Dùng mã email, không dùng mã từ ứng dụng Authenticator. Kiểm
                    tra cả thư rác nếu chưa thấy email.
                  </p>
                  <button className="button" disabled={busy || code.length < 6}>
                    {busy ? "Đang xác minh…" : "Xác minh và vào quản trị"}
                    <ArrowRight size={16} />
                  </button>
                </form>
              )}
              <button
                type="button"
                className={`button ${status.sent ? "button-outline" : ""}`}
                style={{ marginTop: status.sent ? 12 : 0 }}
                disabled={busy || remaining > 0}
                onClick={() => void send()}
              >
                {remaining
                  ? `Gửi lại sau ${remaining}s`
                  : status.sent
                    ? "Gửi lại mã"
                    : "Gửi mã xác thực"}
              </button>
            </>
          )
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="mfa-login-footer">
          <button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void post("/auth/logout")
                .then(() => window.location.assign("/"))
                .catch((e) => {
                  setError(e.message);
                  setBusy(false);
                });
            }}
          >
            <ArrowLeft size={15} />
            Đăng xuất
          </button>
        </div>
      </section>
    </div>
  );
}
