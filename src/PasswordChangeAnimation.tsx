import { Check, LockKeyhole } from 'lucide-react';
import './password-recovery.css';

export function PasswordChangeAnimation() {
  return <div className="password-change" aria-hidden="true">
    <div className="password-change-label"><span>Mật khẩu cũ</span><span>Mật khẩu mới</span></div>
    <div className="password-change-input">
      <LockKeyhole size={17} />
      <div className="password-change-dots">
        <span className="password-change-old">{Array.from({ length: 10 }, (_, i) => <i key={i} style={{ animationDelay: `${240 + i * 28}ms` }} />)}</span>
        <span className="password-change-new">{Array.from({ length: 10 }, (_, i) => <i key={i} style={{ animationDelay: `${650 + i * 42}ms` }} />)}</span>
      </div>
      <Check className="password-change-check" size={18} />
    </div>
    <p className="password-change-saved"><Check size={13} /> Đã lưu mật khẩu mới</p>
  </div>;
}
