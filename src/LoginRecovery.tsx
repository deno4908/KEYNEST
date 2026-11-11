import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ShieldCheck } from 'lucide-react';
import { ApiError, post } from './api';
import { Recaptcha } from './Recaptcha';
import { setRecoveryTicket } from './recovery-ticket';

export function LoginRecovery({ email, captcha, back, close }: {
  email: string; captcha: { enabled: boolean; site_key: string | null } | null; back: () => void; close: () => void;
}) {
  const navigate = useNavigate();
  const [challenge, setChallenge] = useState('');
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [waitUntil, setWaitUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [lockedUntil, setLockedUntil] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const resetCaptcha = () => { setToken(''); setVersion(v => v + 1); };
  const ready = !!(captcha?.enabled && captcha.site_key);
  const locked = lockedUntil > now;
  const wait = Math.max(0, Math.ceil((waitUntil - now) / 1000));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !token || !ready || locked) return;
    setBusy(true); setError('');
    try {
      const headers = { 'X-Captcha-Token': token };
      if (!challenge) {
        if (wait) return;
        const result = await post<{ challenge: string; retry_after: number }>('/auth/login-recovery/send', { email }, headers);
        setChallenge(result.challenge); setCode('');
        setWaitUntil(Date.now() + result.retry_after * 1000);
      } else {
        const result = await post<{ ticket: string }>('/auth/login-recovery/verify', { challenge, code }, headers);
        setRecoveryTicket(result.ticket);
        close();
        navigate('/reset-password');
      }
    } catch (failure) {
      setError((failure as Error).message);
      if (failure instanceof ApiError && failure.retryAfter) {
        if (failure.code === 'RECOVERY_OTP_LOCKED') setLockedUntil(Date.now() + failure.retryAfter * 1000);
        else setWaitUntil(Date.now() + failure.retryAfter * 1000);
      }
    } finally { setBusy(false); resetCaptcha(); }
  }
  return <div className="auth-form">
    <button type="button" className="auth-back" disabled={busy} onClick={back}><ArrowLeft size={16} /> Quay lại</button>
    <div className="auth-heading">
      <span className="auth-kicker">BẢO VỆ TÀI KHOẢN</span>
      <h2>Xác minh để đặt lại mật khẩu</h2>
      <p>Đăng nhập bằng mật khẩu đã tạm dừng sau nhiều lần nhập sai. Xác minh email của bạn để tiếp tục.</p>
    </div>
    <form className="auth-form" onSubmit={submit}>
      <fieldset disabled={busy || locked}>
        <div className="auth-field"><label>Email xác minh<input type="email" value={email} readOnly autoComplete="email" /></label></div>
        {challenge && <div className="auth-field"><label htmlFor="recovery-otp">Mã OTP trong email</label>
          <input id="recovery-otp" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" minLength={6} maxLength={10}
            value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="Nhập mã OTP" required autoFocus />
          <small>Mã có hiệu lực tối đa 10 phút. Không chia sẻ mã với người khác.</small>
        </div>}
        {ready ? <Recaptcha key={version} siteKey={captcha!.site_key!} onToken={setToken} />
          : <p className="form-error" role="alert">Xác minh CAPTCHA chưa sẵn sàng. Vui lòng liên hệ hỗ trợ.</p>}
        {error && <p className="form-error" role="alert">{error}{locked && ` Có thể thử lại lúc ${new Date(lockedUntil).toLocaleString('vi-VN')}.`}</p>}
        <button className="button full auth-submit" disabled={busy || locked || !ready || !token || (!challenge && wait > 0)}>
          {busy ? 'Đang kiểm tra…' : challenge ? 'Xác minh & đặt mật khẩu mới' : 'Gửi mã OTP'} <ArrowRight size={17} />
        </button>
        {challenge && <button type="button" className="text-button" disabled={busy || wait > 0} onClick={() => { setChallenge(''); setError(''); resetCaptcha(); }}>
          {wait ? `Gửi lại sau ${wait} giây` : 'Yêu cầu mã mới'}
        </button>}
      </fieldset>
      <p className="muted auth-recovery-note"><ShieldCheck size={12} /> Cần đúng OTP và CAPTCHA trước khi đặt mật khẩu mới.</p>
    </form>
  </div>;
}
