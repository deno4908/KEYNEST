import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode, Ref } from 'react';
import { Check, Mail, ShieldCheck, Smartphone } from 'lucide-react';
import './verification.css';

export type VerificationStage = 'loading' | 'ready' | 'sending' | 'sent' | 'verifying' | 'success';

export function VerificationCard({ title, description, kind, stage, children, footer, aside = false, className = '' }: {
  title: string; description: ReactNode; kind: 'email' | 'authenticator'; stage: VerificationStage;
  children: ReactNode; footer?: ReactNode; aside?: boolean; className?: string;
}) {
  const id = useId();
  const Icon = kind === 'email' ? Mail : Smartphone;
  return <div className={`verification-layout ${aside ? 'has-aside' : ''} ${className}`} data-stage={stage}>
    {aside && <aside className="verification-aside">
      <span className="verification-game auth-art-background auth-art-background-login" aria-hidden="true" />
      <span className="verification-wordmark"><b>//</b> KEYNEST</span>
      <div className="verification-aside-copy"><span className="verification-kicker">AN TÂM KHI ĐĂNG NHẬP</span><h2>Một bước nhỏ.<br />Thêm một lớp bảo vệ.</h2><p>Xác minh danh tính để giữ tài khoản và giao dịch của bạn an toàn.</p></div>
      <span className="verification-aside-note"><ShieldCheck size={14} />Bảo vệ xuyên suốt phiên đăng nhập</span>
    </aside>}
    <section className="mfa-login-card verification-card" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}>
      <div className="verification-top"><span className="verification-wordmark"><b>//</b> KEYNEST</span><span className="verification-kicker">XÁC MINH TÀI KHOẢN</span></div>
      <div className="verification-progress" aria-label="Tiến trình đăng nhập"><span><Check size={12} />Đăng nhập</span><i /><span aria-current="step">{stage === 'success' ? <Check size={12} /> : <span className="verification-step-number">2</span>}Xác minh</span></div>
      <div className="verification-emblem" aria-hidden="true">
        <span className="verification-orbit" /><span className="verification-signal" />
        <div className="verification-emblem-icon"><Icon size={33} strokeWidth={1.6} /></div>
        <span className="verification-paper"><i /><i /><i /></span>
        <span className="verification-check"><Check size={32} strokeWidth={2} /></span>
        <span className="verification-badge"><ShieldCheck size={16} strokeWidth={1.8} /></span>
      </div>
      <div className="verification-copy"><h1 id={`${id}-title`}>{title}</h1><p id={`${id}-description`} className="mfa-login-description">{description}</p></div>
      <div className="verification-content" aria-live="polite">{children}</div>
      {footer && <div className="mfa-login-footer verification-footer">{footer}</div>}
    </section>
  </div>;
}

export function VerificationCodeInput({ ref, ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <div className="verification-code-field" data-invalid={props['aria-invalid'] === true}>
    <input {...props} ref={ref} className="mfa-login-code" spellCheck={false} />
    <span aria-hidden="true" />
  </div>;
}
