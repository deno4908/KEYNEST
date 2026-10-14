import { useEffect, useRef, useState } from "react";
import {
  Mail,
  ArrowRight,
  ArrowLeft,
  Check,
  LoaderCircle,
  LockKeyhole,
} from "lucide-react";
import { api, post } from "./api";
import "./two-factor.css";
import "./admin-verification.css";
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
  const [action, setAction] = useState<
    "" | "sending" | "verifying" | "success"
  >("");
  const inputRef = useRef<HTMLInputElement>(null);
  const stage = status?.verified
    ? "success"
    : action || (status?.sent ? "sent" : "ready");
  useEffect(() => {
    if (status?.sent && !busy) inputRef.current?.focus();
  }, [status?.sent, busy]);
  useEffect(() => {
    if (action !== "success") return;
    const timer = window.setTimeout(
      () => window.location.assign("/admin"),
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1100,
    );
    return () => window.clearTimeout(timer);
  }, [action]);
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
    setAction("sending");
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
      setAction("");
    }
  }
  const clean = (value: string) =>
    value.normalize("NFKC").replace(/\D/g, "").slice(0, 10);
  return (
    <div className="mfa-login-shell admin-verification-shell">
      <div className="admin-verification-layout" data-stage={stage}>
        <aside className="auth-art admin-verification-art" data-mode="login">
          <span
            className="auth-art-background auth-art-background-login"
            aria-hidden="true"
          />
          <span className="auth-brand">
            <span>//</span> KEYNEST
          </span>
          <div className="auth-art-copy">
            <span className="auth-kicker">DÀNH CHO QUẢN TRỊ VIÊN</span>
            <h2>Chỉ còn một bước.</h2>
            <p>Xác nhận email để tiếp tục quản lý cửa hàng.</p>
          </div>
          <span className="admin-verification-art-note">
            <LockKeyhole size={15} /> Xác minh riêng cho phiên đăng nhập này
          </span>
        </aside>
        <section className="mfa-login-card" aria-labelledby="admin-otp-title">
          <div className="mfa-login-brand">
            <span>//</span> KEYNEST{" "}
            <span className="mfa-login-step">QUẢN TRỊ</span>
          </div>
          <div className="admin-otp-progress" aria-label="Tiến trình đăng nhập">
            <span>
              <Check size={13} /> Tài khoản
            </span>
            <i aria-hidden="true" />
            <span aria-current="step">
              {stage === "success" ? <Check size={13} /> : "02"} Xác minh email
            </span>
          </div>
          <div className="admin-otp-motion" aria-hidden="true">
            <div className="admin-otp-envelope">
              <Mail size={30} />
            </div>
            <div className="admin-otp-paper">
              <span />
              <span />
              <span />
            </div>
            <div className="admin-otp-confirm">
              <Check size={26} />
            </div>
          </div>
          <h1 id="admin-otp-title">
            {stage === "success" ? "Đã xác minh email" : "Xác minh email admin"}
          </h1>
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
          {stage === "success" ? (
            <div className="admin-otp-success" role="status">
              <p>Phiên quản trị đã sẵn sàng.</p>
              <a className="button" href="/admin">
                Vào trang quản trị
                <ArrowRight size={16} />
              </a>
            </div>
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
                      setAction("verifying");
                      setError("");
                      try {
                        await post("/auth/admin-otp/verify", { code });
                        setCode("");
                        setAction("success");
                      } catch (err) {
                        setError((err as Error).message);
                        setBusy(false);
                        setAction("");
                      }
                    }}
                  >
                    <label htmlFor="admin-email-code">Mã OTP trong email</label>
                    <input
                      id="admin-email-code"
                      ref={inputRef}
                      className="mfa-login-code"
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      pattern="[0-9]{6,10}"
                      maxLength={10}
                      required
                      value={code}
                      disabled={busy}
                      aria-invalid={!!error}
                      aria-describedby="admin-otp-help"
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
                    <p id="admin-otp-help" className="mfa-login-hint">
                      Dùng mã email, không dùng mã từ ứng dụng Authenticator.
                      Kiểm tra cả thư rác nếu chưa thấy email.
                    </p>
                    <button
                      className="button"
                      disabled={busy || code.length < 6}
                    >
                      {action === "verifying"
                        ? "Đang xác minh…"
                        : "Xác minh và vào quản trị"}
                      {action === "verifying" ? (
                        <LoaderCircle
                          className="admin-otp-spinner"
                          size={16}
                          aria-hidden="true"
                        />
                      ) : (
                        <ArrowRight size={16} />
                      )}
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
                  {action === "sending"
                    ? "Đang gửi mã…"
                    : remaining
                      ? `Gửi lại sau ${remaining}s`
                      : status.sent
                        ? "Gửi lại mã"
                        : "Gửi mã xác thực"}
                  {action === "sending" && (
                    <LoaderCircle
                      className="admin-otp-spinner"
                      size={16}
                      aria-hidden="true"
                    />
                  )}
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
    </div>
  );
}
