import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import "./oauth-transition.css";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  Package,
  Wallet,
} from "lucide-react";
import { Modal, useStore } from "./App";
import { api, ApiError, post } from "./api";
import { LoginRecovery } from './LoginRecovery';
import type { User } from "./types";
import { GoogleIcon, DiscordIcon } from "./AuthProviders";
import { Recaptcha } from './Recaptcha';
import { showEmailWelcome } from './OAuthWelcome';
import { LegalConsent } from './LegalConsent';
import { LEGAL_VERSION } from '../shared/legal-content.js';
import { checkRegion } from './region';

export function AuthModal({ close }: { close: () => void }) {
  const { mode, setUser } = useStore();
  const [tab, setTab] = useState<"login" | "register" | "forgot">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedData, setAcceptedData] = useState(false);
  const legal = { version: LEGAL_VERSION, terms: acceptedTerms, account_data: acceptedData };
  const [message, setMessage] = useState("");
  const [captcha, setCaptcha] = useState<{ enabled: boolean; site_key: string | null } | null>(null);
  const [captchaConfigError, setCaptchaConfigError] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaVersion, setCaptchaVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<{ captcha: { enabled: boolean; site_key: string | null } }>('/config', { signal: controller.signal })
      .then(data => {
        if (!data.captcha || (data.captcha.enabled && !data.captcha.site_key)) throw new Error('Cấu hình xác minh chưa sẵn sàng. Vui lòng tải lại trang.');
        setCaptcha(data.captcha);
      }).catch(error => { if (!controller.signal.aborted) setCaptchaConfigError(error.message); });
    return () => controller.abort();
  }, []);
  const captchaBlocked = !captcha || (captcha.enabled && !captchaToken);
  const resetCaptcha = () => { setCaptchaToken(''); setCaptchaVersion(n => n + 1); };
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [confirmationTouched, setConfirmationTouched] = useState(false);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const clearPasswords = () => {
    setPassword('');
    setConfirmation('');
    setVisible(false);
    setConfirmationVisible(false);
    setConfirmationTouched(false);
    passwordRef.current?.focus();
  };
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageHeight, setStageHeight] = useState<number>();
  const [direction, setDirection] = useState("forward");
  const [oauthBusy, setOAuthBusy] = useState("");
  const layoutRef = useRef<HTMLDivElement>(null);
  const oauthRequest = useRef<AbortController | null>(null);
  const [flight, setFlight] = useState({ x: 0, y: 0 });
  useEffect(() => () => oauthRequest.current?.abort(), []);
  const mismatch = confirmationTouched && confirmation !== password;
  useLayoutEffect(() => {
    const content = stageRef.current;
    if (!content) return;
    const measure = () =>
      setStageHeight(content.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [tab, message, recoveryEmail]);
  const changeTab = (next: typeof tab) => {
    if (busy || tab === next) return;
    setDirection(next === "login" ? "backward" : "forward");
    setTab(next);
    setAcceptedTerms(false);
    setAcceptedData(false);
    resetCaptcha();
    setError("");
    setMessage("");
    setVisible(false);
    setConfirmationVisible(false);
    setConfirmationTouched(false);
    setConfirmation("");
  };
  async function socialLogin(
    provider: "google" | "discord",
    button: HTMLButtonElement,
  ) {
    if (busy || oauthRequest.current) return;
    if (tab === 'register' && (!acceptedTerms || !acceptedData)) {
      setError('Vui lòng xác nhận điều khoản và xử lý dữ liệu trước khi tiếp tục.');
      return;
    }
    const source = button.querySelector("svg")?.getBoundingClientRect();
    const target = layoutRef.current?.getBoundingClientRect();
    if (source && target)
      setFlight({
        x: source.left + source.width / 2 - (target.left + target.width / 2),
        y: source.top + source.height / 2 - (target.top + target.height / 2),
      });
    const controller = new AbortController();
    oauthRequest.current = controller;
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? 0
      : 720;
    setBusy(true);
    setOAuthBusy(provider);
    setError("");
    try {
      if (!await checkRegion()) return;
      const [{ url }] = await Promise.all([
        api<{ url: string }>(`/auth/oauth/${provider}`, {
          method: "POST",
          body: JSON.stringify(tab === 'register' ? { intent: 'register', legal } : { intent: 'login' }),
          signal: controller.signal,
        }),
        new Promise((resolve) => window.setTimeout(resolve, duration)),
      ]);
      if (controller.signal.aborted) return;
      window.location.assign(url);
    } catch (e) {
      if (controller.signal.aborted) return;
      setError((e as Error).message);
      resetCaptcha();
      setBusy(false);
      setOAuthBusy("");
      oauthRequest.current = null;
      button.focus();
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || captchaBlocked) return;
    if (tab === 'register' && (!acceptedTerms || !acceptedData)) {
      setError('Vui lòng xác nhận điều khoản và xử lý dữ liệu trước khi tiếp tục.');
      return;
    }
    if (tab === "register" && password !== confirmation) {
      setError('Mật khẩu nhập lại chưa khớp. Vui lòng nhập lại mật khẩu.');
      clearPasswords();
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (!await checkRegion()) return;
      if (tab === "forgot") {
        const result = await post<{ message: string }>("/auth/forgot", {
          email: email.trim(),
        }, captchaToken ? { 'X-Captcha-Token': captchaToken } : {});
        setMessage(result.message);
      } else if (tab === "register") {
        const result = await post<{ user?: User; message?: string }>(
          "/auth/register",
          { email: email.trim(), password, name: name.trim(), legal },
          captchaToken ? { 'X-Captcha-Token': captchaToken } : {},
        );
        if (result.user) {
          setUser(result.user);
          close();
          showEmailWelcome(true);
        } else
          setMessage(result.message || "Đã tạo tài khoản. Hãy đăng nhập bằng email và mật khẩu.");
      } else {
        setUser(
          await post<User>("/auth/login", { email: email.trim(), password }, captchaToken ? { 'X-Captcha-Token': captchaToken } : {}),
        );
        close();
        showEmailWelcome();
      }
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.code === 'PASSWORD_RECOVERY_REQUIRED') {
        setRecoveryEmail(email.trim().toLowerCase());
        setStageHeight(undefined);
      }
      if (tab === 'login' || tab === 'register') clearPasswords();
    } finally {
      setBusy(false);
      resetCaptcha();
    }
  }
  const title =
    tab === "register"
      ? "Tạo tài khoản"
      : tab === "forgot"
        ? "Quên mật khẩu?"
        : "Chào mừng trở lại.";
  const registering = tab === "register";
  return (
    <Modal
      title={title}
      close={close}
      className={`auth-dialog ${oauthBusy ? "auth-oauth-pending" : ""}`}
    >
      <div ref={layoutRef} className="auth-layout" inert={!!oauthBusy}>
        <aside
          className="auth-art"
          data-mode={registering ? "register" : "login"}
        >
          <span
            className="auth-art-background auth-art-background-login"
            aria-hidden="true"
          />
          <span
            className="auth-art-background auth-art-background-register"
            aria-hidden="true"
          />
          <span className="auth-brand">
            <span>//</span> KEYNEST
          </span>
          <div
            className="auth-art-copy"
            key={registering ? "register" : "login"}
          >
            <span className="auth-kicker">
              {registering ? "JOIN THE NEXT CHAPTER" : "YOUR NEXT ADVENTURE"}
            </span>
            <h2>
              {registering ? "Bắt đầu" : "Game mới."}
              <br />
              {registering ? "cuộc chơi mới." : "Trải nghiệm mới."}
            </h2>
            <p>
              {registering
                ? "Tạo tài khoản của bạn."
                : "Chọn tựa game tiếp theo."}
              <br />
              {registering
                ? "Sẵn sàng cho tựa game tiếp theo."
                : "Phần còn lại, để KEYNEST."}
            </p>
            <div className="auth-benefits">
              <span>
                <KeyRound size={16} />{" "}
                {registering
                  ? "Lưu và tra cứu key đã mua"
                  : "Nhận key trong đơn hàng"}
              </span>
              <span>
                <Wallet size={16} />{" "}
                {registering
                  ? "Quản lý số dư và lịch sử ví"
                  : "Ví & chuyển khoản ngân hàng"}
              </span>
              <span>
                <Package size={16} />{" "}
                {registering
                  ? "Theo dõi đơn hàng tại một nơi"
                  : "Theo dõi mọi giao dịch"}
              </span>
            </div>
          </div>
          <span className="auth-art-caption">
            {registering
              ? "CYBERPUNK 2077 · PC / STEAM"
              : "ELDEN RING · PC / STEAM"}
          </span>
        </aside>
        <div className="auth-content">
          <div className="auth-mobile-brand">
            <span>//</span> KEYNEST
          </div>
          {recoveryEmail ? <LoginRecovery email={recoveryEmail} captcha={captcha} close={close} back={() => { setRecoveryEmail(null); setError(''); resetCaptcha(); }} /> : <>
          {tab !== "forgot" && (
            <div
              className="auth-tabs"
              data-active={tab}
              aria-label="Chọn đăng nhập hoặc đăng ký"
            >
              <button
                type="button"
                aria-pressed={tab === "login"}
                disabled={busy}
                onClick={() => changeTab("login")}
              >
                Đăng nhập
              </button>
              <button
                type="button"
                aria-pressed={tab === "register"}
                disabled={busy}
                onClick={() => changeTab("register")}
              >
                Đăng ký
              </button>
            </div>
          )}
          {tab === "forgot" && (
            <button
              className="auth-back"
              onClick={() => changeTab("login")}
              disabled={busy}
            >
              <ArrowLeft size={16} /> Quay lại đăng nhập
            </button>
          )}
          <div className="auth-stage" style={{ height: stageHeight }}>
            <div
              ref={stageRef}
              key={tab}
              className={`auth-stage-inner auth-slide-${direction}`}
            >
              <div className="auth-heading">
                <span className="auth-kicker">TÀI KHOẢN KEYNEST</span>
                <h2>{title}</h2>
                <p>
                  {tab === "register"
                    ? "Lưu đơn hàng, quản lý ví và bắt đầu khám phá."
                    : tab === "forgot"
                      ? "Nhập email đăng ký để nhận hướng dẫn đặt lại mật khẩu."
                      : "Đăng nhập để tiếp tục với thư viện của bạn."}
                </p>
              </div>
              {tab !== "forgot" && !message && (
                <>
                  <div className="auth-social">
                    <button
                      type="button"
                      aria-label="Đăng nhập bằng Google"
                      disabled={busy || (registering && (!acceptedTerms || !acceptedData))}
                      onClick={(e) => socialLogin("google", e.currentTarget)}
                    >
                      <GoogleIcon />
                      <span>
                        {oauthBusy === "google" ? "Đang kết nối…" : "Google"}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label="Đăng nhập bằng Discord"
                      disabled={busy || (registering && (!acceptedTerms || !acceptedData))}
                      onClick={(e) => socialLogin("discord", e.currentTarget)}
                    >
                      <DiscordIcon />
                      <span>
                        {oauthBusy === "discord" ? "Đang kết nối…" : "Discord"}
                      </span>
                    </button>
                  </div>
                  <div className="auth-divider">
                    <span>hoặc tiếp tục với email</span>
                  </div>
                </>
              )}
              {message ? (
                <div className={`auth-confirmation ${tab === 'register' ? 'auth-registration-confirmation' : ''}`} role="status">
                  <Mail size={32} />
                  <h3>
                    {tab === "register"
                      ? "Xác nhận tài khoản"
                      : "Hướng dẫn khôi phục"}
                  </h3>
                  <p>{message}</p>
                  <button
                    className="button button-outline full"
                    onClick={() => changeTab("login")}
                  >
                    Quay lại đăng nhập
                  </button>
                </div>
              ) : (
                <form className="auth-form" onSubmit={submit}>
                  <fieldset disabled={busy}>
                    {tab === "register" && (
                      <div className="auth-field">
                        <label htmlFor="auth-name">Tên của bạn</label>
                        <input
                          id="auth-name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          required
                          minLength={2}
                          maxLength={80}
                          autoComplete="name"
                          placeholder="Nhập tên hiển thị"
                        />
                      </div>
                    )}
                    <div className="auth-field">
                      <label htmlFor="auth-email">Email</label>
                      <input
                        data-initial-focus
                        id="auth-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                        placeholder="ban@example.com"
                      />
                    </div>
                    {tab !== "forgot" && (
                      <div className="auth-field">
                        <div className="auth-label-row">
                          <label htmlFor="auth-password">Mật khẩu</label>
                          {tab === "login" && (
                            <button
                              type="button"
                              onClick={() => changeTab("forgot")}
                            >
                              Quên mật khẩu?
                            </button>
                          )}
                        </div>
                        <div className="password-control">
                          <input
                            id="auth-password"
                            ref={passwordRef}
                            type={visible ? "text" : "password"}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            minLength={tab === "register" ? 10 : 1}
                            maxLength={128}
                            autoComplete={
                              tab === "register"
                                ? "new-password"
                                : "current-password"
                            }
                            placeholder="Nhập mật khẩu"
                            aria-describedby={
                              tab === "register" ? "password-rules" : undefined
                            }
                          />
                          <button
                            type="button"
                            aria-label={
                              visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"
                            }
                            aria-pressed={visible}
                            onClick={() => setVisible(!visible)}
                          >
                            {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                          </button>
                        </div>
                        {tab === "register" && (
                          <div id="password-rules" className="password-rules">
                            {[
                              [password.length >= 10, "10 ký tự trở lên"],
                              [
                                /[A-Z]/.test(password) &&
                                  /[a-z]/.test(password),
                                "Chữ hoa & thường",
                              ],
                              [/\d/.test(password), "Có chữ số"],
                            ].map(([ok, label]) => (
                              <span
                                key={String(label)}
                                className={ok ? "met" : ""}
                              >
                                <Check size={12} />
                                {label}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {tab === "register" && (
                      <div className="auth-field">
                        <label htmlFor="auth-confirm-password">
                          Nhập lại mật khẩu
                        </label>
                        <div className="password-control">
                          <input
                            ref={confirmationRef}
                            id="auth-confirm-password"
                            type={confirmationVisible ? "text" : "password"}
                            value={confirmation}
                            onChange={(e) => setConfirmation(e.target.value)}
                            onBlur={() => setConfirmationTouched(true)}
                            required
                            maxLength={128}
                            autoComplete="new-password"
                            placeholder="Nhập lại mật khẩu của bạn"
                            aria-invalid={mismatch || undefined}
                            aria-describedby={
                              mismatch ? "confirmation-error" : undefined
                            }
                          />
                          <button
                            type="button"
                            aria-label={
                              confirmationVisible
                                ? "Ẩn mật khẩu nhập lại"
                                : "Hiện mật khẩu nhập lại"
                            }
                            aria-pressed={confirmationVisible}
                            onClick={() =>
                              setConfirmationVisible(!confirmationVisible)
                            }
                          >
                            {confirmationVisible ? (
                              <EyeOff size={18} />
                            ) : (
                              <Eye size={18} />
                            )}
                          </button>
                        </div>
                        {mismatch && (
                          <p
                            id="confirmation-error"
                            className="confirmation-error"
                            role="alert"
                          >
                            Mật khẩu nhập lại chưa khớp.
                          </p>
                        )}
                      </div>
                    )}
                    {registering && <>
                      <LegalConsent terms={acceptedTerms} data={acceptedData} account onTerms={setAcceptedTerms} onData={setAcceptedData} />
                    </>}
                    <>
                      {captchaConfigError && <p className="form-error" role="alert">{captchaConfigError}</p>}
                      {!captcha && !captchaConfigError && <p role="status">Đang tải cấu hình đăng nhập…</p>}
                      {captcha?.enabled && captcha.site_key && <Recaptcha key={`${tab}-${captchaVersion}`} siteKey={captcha.site_key} onToken={setCaptchaToken} />}
                    </>
                    {error && (
                      <p className="form-error" role="alert">
                        {error}
                      </p>
                    )}
                    <button className="button full auth-submit" disabled={busy || captchaBlocked || (registering && (!acceptedTerms || !acceptedData))}>
                      {busy
                        ? "Đang xử lý…"
                        : tab === "register"
                          ? "Tạo tài khoản"
                          : tab === "forgot"
                            ? "Gửi hướng dẫn"
                            : "Đăng nhập"}
                      <ArrowRight size={18} />
                    </button>
                  </fieldset>
                </form>
              )}
              {mode === "demo" && tab === "login" && (
                <div className="auth-demo">
                  <div>
                    <span>DÙNG THỬ CỬA HÀNG</span>
                    <small>Điền nhanh tài khoản demo</small>
                  </div>
                  <div>
                    <button
                      disabled={busy}
                      onClick={() => {
                        setEmail("student@keynest.local");
                        setPassword("Student123!");
                        setError("");
                      }}
                    >
                      Khách hàng <ArrowRight size={14} aria-hidden="true" />
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        setEmail("admin@keynest.local");
                        setPassword("Admin123!");
                        setError("");
                      }}
                    >
                      Quản trị viên <ArrowRight size={14} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )}
              <p className="auth-footnote">
                Game key · Gift card · Nạp game · MMO
              </p>
            </div>
          </div>
          </>}
        </div>
      </div>
      {oauthBusy && (
        <div
          className="oauth-transition"
          role="status"
          aria-live="polite"
          style={
            {
              "--flight-x": `${flight.x}px`,
              "--flight-y": `${flight.y}px`,
            } as CSSProperties
          }
        >
          <div className="oauth-flight-icon">
            {oauthBusy === "google" ? <GoogleIcon /> : <DiscordIcon />}
          </div>
          <div className="oauth-transition-caption">
            <strong>
              Tiếp tục với {oauthBusy === "google" ? "Google" : "Discord"}
            </strong>
            <span>Đang chuyển đến trang đăng nhập…</span>
            <i aria-hidden="true" />
          </div>
        </div>
      )}
    </Modal>
  );
}

export function OAuthErrorPage() {
  const { login } = useStore();
  return (
    <div className="container page">
      <section className="oauth-error panel">
        <KeyRound size={32} />
        <h1>Chưa thể đăng nhập</h1>
        <p>
          Yêu cầu có thể đã hết hạn, bị hủy hoặc nhà cung cấp chưa được cấu
          hình. Hãy thử lại hoặc đăng nhập bằng email.
        </p>
        <button className="button" onClick={login}>
          Quay lại đăng nhập
          <ArrowRight size={17} />
        </button>
      </section>
    </div>
  );
}
