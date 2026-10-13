import { Check } from 'lucide-react';
import './password-recovery.css';

export function PasswordChangeAnimation() {
  return <div className="password-change" aria-hidden="true">
    <div className="password-change-label"><span>Mật khẩu cũ</span><span>Mật khẩu mới</span></div>
    <div className="password-change-input">
      <svg className="password-change-lock" width="18" height="22" viewBox="0 0 24 28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path className="password-change-shackle" d="M7 12V8a5 5 0 0 1 10 0v4" />
        <rect x="4" y="12" width="16" height="13" rx="3" />
        <path d="M12 17v3" />
      </svg>
      <div className="password-change-dots">
        <span className="password-change-old">{Array.from({ length: 10 }, (_, i) => <i key={i} style={{ animationDelay: `${380 + i * 45}ms` }} />)}</span>
        <span className="password-change-new">{Array.from({ length: 10 }, (_, i) => <i key={i} style={{ animationDelay: `${1100 + i * 85}ms` }} />)}</span>
        <b className="password-change-caret" />
      </div>
      <Check className="password-change-check" size={18} />
    </div>
    <p className="password-change-saved"><Check size={13} /> Đã lưu mật khẩu mới</p>
  </div>;
}
