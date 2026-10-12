import { useEffect, useId, useRef, useState } from "react";
import { ShieldCheck, Smartphone } from "lucide-react";
import "./two-factor.css";
import { api, post } from "./api";
import { Modal, useStore } from "./App";
import "./oauth-transition.css";
type Status = { required: boolean; factors: { id: string; name: string }[] };
export function TwoFactor({ challenge = false }: { challenge?: boolean }) {
  const { mode } = useStore();
  const [status, setStatus] = useState<Status>();
  const [enrollment, setEnrollment] = useState<{
    id: string;
    secret: string;
    qr: string;
  }>();
  const [factor, setFactor] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [removing, setRemoving] = useState(false);
  const codeId = useId();
  const codeRef = useRef<HTMLInputElement>(null);
  const cancelling = useRef(false);
  useEffect(() => {
    if (challenge && status?.required && !busy) codeRef.current?.focus();
  }, [challenge, status?.required, busy]);
  async function cancelChallenge() {
    if (busy || cancelling.current) return;
    cancelling.current = true;
    setBusy(true);
    try {
      await post("/auth/logout");
      window.location.assign("/");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      cancelling.current = false;
    }
  }
  const cleanCode = (value: string) =>
    value.normalize("NFKC").replace(/\D/g, "").slice(0, 6);
  async function load() {
    const data = await api<Status>("/auth/mfa/status");
    setStatus(data);
    setFactor(data.factors[0]?.id || "");
  }
  useEffect(() => {
    if (mode === "supabase") void load().catch((e) => setError(e.message));
  }, [mode]);
  async function enroll() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setEnrollment(await post("/auth/mfa/enroll"));
      setRemoving(false);
      setCode("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    if (busy || !/^\d{6}$/.test(code)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await post("/auth/mfa/verify", {
        factor_id: enrollment?.id || factor,
        code,
        remove: !challenge && !enrollment,
      });
      if (challenge) {
        window.location.assign("/account");
        return;
      }
      setMessage(
        enrollment ? "Đã bật xác thực hai bước." : "Đã gỡ thiết bị xác thực.",
      );
      setEnrollment(undefined);
      setRemoving(false);
      setCode("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (challenge)
    return (
      <Modal title="Xác thực hai bước" close={() => void cancelChallenge()} className="mfa-challenge-dialog">
        <section className="mfa-login-card" aria-labelledby={`${codeId}-title`}>
          <div className="mfa-login-icon" aria-hidden="true">
            <ShieldCheck size={32} strokeWidth={1.8} />
          </div>
          <h1 id={`${codeId}-title`}>
            {status && !status.required
              ? "Bạn đã được xác minh"
              : "Xác minh đó là bạn"}
          </h1>
          <p className="mfa-login-description">
            {status && !status.required
              ? "Phiên đăng nhập đã sẵn sàng. Tiếp tục để truy cập tài khoản của bạn."
              : "Mở ứng dụng Authenticator và nhập mã xác thực để tiếp tục đăng nhập."}
          </p>
          {!status && !error && (
            <p role="status" className="mfa-login-description">
              Đang kiểm tra phiên đăng nhập…
            </p>
          )}
          {status?.required && (
            <form
              className="mfa-login-form"
              onSubmit={(e) => {
                e.preventDefault();
                void verify();
              }}
            >
              {status.factors.length > 1 ? (
                <label className="field-title">
                  Thiết bị xác thực
                  <select
                    value={factor}
                    disabled={busy}
                    onChange={(e) => {
                      setFactor(e.target.value);
                      setCode("");
                      setError("");
                    }}
                  >
                    {status.factors.map((f, i) => (
                      <option key={f.id} value={f.id}>
                        {/^KEYNEST \d+$/.test(f.name)
                          ? `Authenticator ${i + 1}`
                          : f.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="mfa-login-device">
                  Ứng dụng Authenticator
                </div>
              )}
              <label htmlFor={codeId}>Mã xác thực</label>
              <input
                id={codeId}
                ref={codeRef}
                className="mfa-login-code"
                type="text"
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="000000"
                required
                spellCheck={false}
                aria-invalid={!!error}
                aria-describedby={`${codeId}-help${error ? ` ${codeId}-error` : ""}`}
                value={code}
                disabled={busy}
                onChange={(e) => {
                  setCode(cleanCode(e.target.value));
                  setError("");
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  setCode(cleanCode(e.clipboardData.getData("text")));
                  setError("");
                }}
              />
              <p id={`${codeId}-help`} className="mfa-login-hint">
                Mã gồm 6 chữ số. Bạn có thể dán mã trực tiếp.
              </p>
              {error && (
                <p id={`${codeId}-error`} className="form-error" role="alert">
                  {error}
                </p>
              )}
              <button
                className="button"
                disabled={busy || code.length !== 6 || !factor}
              >
                {busy ? "Đang xác minh…" : "Xác minh và tiếp tục"}
              </button>
            </form>
          )}
          {!status?.required && error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {status && !status.required && (
            <a className="button" href="/account">
              Vào tài khoản
            </a>
          )}
          <details className="mfa-login-help">
            <summary>Không lấy được mã xác thực?</summary>
            <p>
              Kiểm tra giờ trên điện thoại đã đặt tự động và chờ mã mới. Nếu đã
              thêm thiết bị dự phòng, hãy chọn thiết bị đó để xác minh.
            </p>
          </details>
          <div className="mfa-login-footer">
            <button
              type="button"
              disabled={busy}
              onClick={() => void cancelChallenge()}
            >
              Đăng nhập bằng tài khoản khác
            </button>
          </div>
        </section>
      </Modal>
    );
  return (
    <section
      className={
        challenge
          ? "container panel two-factor two-factor-page"
          : "member-security-row two-factor"
      }
    >
      <span className="member-security-icon">
        <ShieldCheck size={22} />
      </span>
      <div className="two-factor-content">
        <div className="two-factor-summary">
          <header className="two-factor-heading">
            <h3>
              {challenge ? "Xác minh đăng nhập" : "Xác thực hai bước (2FA)"}
            </h3>
            <p>
              {challenge
                ? "Nhập mã 6 chữ số từ ứng dụng Authenticator."
                : "Bảo vệ đăng nhập email, Google và Discord."}
            </p>
          </header>
          <div className="two-factor-summary-actions">
            {status && !enrollment && !challenge && (
              <p
                className={`two-factor-status ${status.factors.length ? "is-enabled" : ""}`}
              >
                {status.factors.length
                  ? `Đang bật · ${status.factors.length} thiết bị`
                  : "Chưa bật"}
              </p>
            )}
            {!enrollment && status && !challenge && (
              <button
                type="button"
                className="button button-outline two-factor-add"
                disabled={busy}
                onClick={() => void enroll()}
              >
                {status.factors.length ? "Thêm thiết bị dự phòng" : "Bật 2FA"}
              </button>
            )}
          </div>
        </div>
        {mode === "demo" ? (
          <p>Tính năng này cần Supabase Auth.</p>
        ) : (
          <div
            className={enrollment ? "two-factor-setup" : "two-factor-details"}
          >
            {enrollment && (
              <div className="two-factor-scan">
                <span className="two-factor-step">01 · QUÉT MÃ QR</span>
                <img
                  className="two-factor-qr"
                  src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(enrollment.qr)}`}
                  alt="Mã QR thiết lập Authenticator"
                />
                <details className="two-factor-manual">
                  <summary>Không quét được mã QR?</summary>
                  <p>Nhập khóa này vào ứng dụng Authenticator:</p>
                  <code>{enrollment.secret}</code>
                </details>
              </div>
            )}
            {!enrollment && !!status?.factors.length && (
              <div className="two-factor-device">
                <Smartphone size={20} aria-hidden="true" />
                <label className="field-title">
                  Ứng dụng xác thực
                  <select
                    value={factor}
                    disabled={busy}
                    onChange={(e) => {
                      setFactor(e.target.value);
                      setCode("");
                      setError("");
                      setRemoving(false);
                    }}
                  >
                    {status.factors.map((f, index) => (
                      <option key={f.id} value={f.id}>
                        {/^KEYNEST \d+$/.test(f.name)
                          ? `Authenticator ${index + 1}`
                          : f.name}
                      </option>
                    ))}
                  </select>
                </label>
                {!challenge && !removing && (
                  <button
                    type="button"
                    className="two-factor-remove"
                    disabled={busy}
                    onClick={() => {
                      setRemoving(true);
                      setMessage("");
                      setCode("");
                    }}
                  >
                    Gỡ thiết bị
                  </button>
                )}
              </div>
            )}
            {(enrollment ||
              (!!status?.factors.length && (challenge || removing))) && (
              <form
                className="two-factor-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void verify();
                }}
              >
                {enrollment && (
                  <div className="two-factor-instructions">
                    <span className="two-factor-step">
                      02 · XÁC NHẬN THIẾT LẬP
                    </span>
                    <h4>Kết nối ứng dụng xác thực</h4>
                    <p>
                      Mở Google Authenticator hoặc ứng dụng TOTP, chọn thêm tài
                      khoản và quét mã bên cạnh.
                    </p>
                  </div>
                )}
                <label className="field-title" htmlFor={codeId}>
                  {!challenge && !enrollment
                    ? "Nhập mã hiện tại để gỡ thiết bị"
                    : "Mã xác thực"}
                </label>
                <input
                  id={codeId}
                  className="two-factor-code"
                  type="text"
                  placeholder="000000"
                  spellCheck={false}
                  aria-describedby={`${codeId}-hint`}
                  aria-invalid={!!error}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={code}
                  disabled={busy}
                  onChange={(e) => {
                    setCode(cleanCode(e.target.value));
                    setError("");
                  }}
                  onPaste={(e) => {
                    e.preventDefault();
                    setCode(cleanCode(e.clipboardData.getData("text")));
                    setError("");
                  }}
                />
                <p id={`${codeId}-hint`} className="two-factor-hint">
                  Nhập 6 chữ số từ ứng dụng. Bạn có thể dán cả mã vào ô này.
                </p>
                {enrollment && (
                  <p className="two-factor-recovery-note">
                    Lưu khóa thiết lập ở nơi an toàn để khôi phục khi đổi điện
                    thoại. Không chia sẻ mã QR hoặc khóa này.
                  </p>
                )}
                <div className="two-factor-actions">
                  <button
                    className="button"
                    disabled={busy || code.length !== 6}
                  >
                    {busy
                      ? "Đang xác minh…"
                      : enrollment
                        ? "Xác nhận bật 2FA"
                        : challenge
                          ? "Xác minh"
                          : "Gỡ thiết bị"}
                  </button>
                  {(enrollment || removing) && (
                    <button
                      type="button"
                      className="button button-outline"
                      disabled={busy}
                      onClick={() => {
                        setEnrollment(undefined);
                        setCode("");
                        setRemoving(false);
                        setError("");
                      }}
                    >
                      Hủy
                    </button>
                  )}
                </div>
              </form>
            )}
            {challenge && status && !status.required && (
              <a href="/account">Tiếp tục đến tài khoản</a>
            )}
            {challenge && (
              <button
                type="button"
                className="button button-outline"
                disabled={busy}
                onClick={() => {
                  void post("/auth/logout")
                    .then(() => window.location.assign("/"))
                    .catch((e) => setError(e.message));
                }}
              >
                Đăng xuất
              </button>
            )}
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
      </div>
    </section>
  );
}
