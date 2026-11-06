import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, LoaderCircle, Mail } from 'lucide-react';
import { api, post } from './api';
import { VerificationCard, VerificationCodeInput } from './VerificationCard';
import type { VerificationStage } from './VerificationCard';
import './two-factor.css';

type Status = { verified: boolean; email: string; sent: boolean; retry_after: number };

export function AdminVerification() {
  const [status, setStatus] = useState<Status>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState(0);
  const [action, setAction] = useState<'' | 'sending' | 'verifying' | 'success'>('');
  const inputRef = useRef<HTMLInputElement>(null);
  const stage: VerificationStage = status?.verified ? 'success' : action || (status ? status.sent ? 'sent' : 'ready' : 'loading');
  useEffect(() => {
    if (status?.sent && !busy) inputRef.current?.focus();
  }, [status?.sent, busy]);
  useEffect(() => {
    if (stage !== 'success') return;
    const timer = window.setTimeout(() => window.location.assign('/admin'),
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1100);
    return () => window.clearTimeout(timer);
  }, [stage]);
  useEffect(() => {
    const controller = new AbortController();
    api<Status>('/auth/admin-otp/status', { signal: controller.signal }).then(s => {
      setStatus(s); setRemaining(s.retry_after);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!remaining) return;
    const timer = window.setTimeout(() => setRemaining(r => Math.max(0, r - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [remaining]);
  async function send() {
    if (busy || remaining) return;
    setBusy(true); setAction('sending'); setError('');
    try {
      const data = await post<{ retry_after: number }>('/auth/admin-otp/send');
      setStatus(s => s ? { ...s, sent: true } : s); setRemaining(data.retry_after); setCode('');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setAction(''); }
  }
  async function verify() {
    if (busy || !/^\d{6,10}$/.test(code)) return;
    setBusy(true); setAction('verifying'); setError('');
    try {
      await post('/auth/admin-otp/verify', { code });
      setCode(''); setAction('success');
    } catch (e) { setError((e as Error).message); setBusy(false); setAction(''); }
  }
  return <div className="mfa-login-shell">
    <VerificationCard aside className="admin-verification-layout" kind="email" stage={stage}
      title={stage === 'success' ? 'Đã xác minh email' : 'Xác minh đó là bạn'}
      description={stage === 'success' ? 'Phiên đăng nhập đã sẵn sàng. Đang đưa bạn trở lại cửa hàng.' : <>
        Xác nhận bằng mã gửi tới {status ? <strong>{status.email}</strong> : 'email của tài khoản'}.
        {' '}Chỉ cần thực hiện một lần trong phiên đăng nhập này.
      </>}
      footer={<button disabled={busy} onClick={() => {
        setBusy(true);
        void post('/auth/logout').then(() => window.location.assign('/')).catch(e => { setError(e.message); setBusy(false); });
      }}><ArrowLeft size={15} />Đăng xuất</button>}>
      {!status && !error && <p role="status" className="mfa-login-hint">Đang kiểm tra phiên…</p>}
      {stage === 'success' ? <div role="status"><a className="button" href="/admin">Tiếp tục<ArrowRight size={16} /></a></div> : status && <>
        {status.sent && <form className="mfa-login-form" onSubmit={e => { e.preventDefault(); void verify(); }}>
          <label htmlFor="email-verification-code">Mã OTP trong email</label>
          <VerificationCodeInput id="email-verification-code" ref={inputRef} autoComplete="one-time-code" inputMode="numeric"
            pattern="[0-9]{6,10}" maxLength={10} required value={code} disabled={busy} placeholder="Nhập mã OTP"
            aria-invalid={!!error} aria-describedby="email-verification-help"
            onChange={e => { setCode(e.target.value.normalize('NFKC').replace(/\D/g, '').slice(0, 10)); setError(''); }} />
          <p id="email-verification-help" className="mfa-login-hint">Kiểm tra cả thư rác. Dùng mã trong email, không dùng mã Authenticator.</p>
          <button className="button" disabled={busy || code.length < 6}>
            {action === 'verifying' ? <>Đang xác minh…<LoaderCircle className="verification-spinner" size={16} /></> : <>Xác minh và tiếp tục<ArrowRight size={16} /></>}
          </button>
        </form>}
        <button type="button" className={`button ${status.sent ? 'button-outline verification-resend' : ''}`}
          disabled={busy || remaining > 0} onClick={() => void send()}>
          {action === 'sending' ? <>Đang gửi mã…<LoaderCircle className="verification-spinner" size={16} /></> :
            remaining ? `Gửi lại sau ${remaining}s` : status.sent ? 'Gửi lại mã' : <><Mail size={16} />Gửi mã xác thực</>}
        </button>
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </VerificationCard>
  </div>;
}
