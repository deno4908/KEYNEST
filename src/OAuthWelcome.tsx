import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeftRight, CheckCircle2 } from 'lucide-react';
import { Modal, useStore } from './App';
import { Avatar } from './Avatar';
import { GoogleIcon, DiscordIcon } from './AuthProviders';
import './oauth-welcome.css';

const storageKey = 'kn-oauth-welcome';
// Cosmetic marker only. The authenticated /me response controls the greeting.
function pendingWelcome(): 'google' | 'discord' | null {
  const provider = new URLSearchParams(window.location.search).get('welcome');
  try {
    if (window.location.pathname === '/auth/error') {
      sessionStorage.removeItem(storageKey);
      return null;
    }
    if (window.location.pathname === '/account' && (provider === 'google' || provider === 'discord')) {
      sessionStorage.setItem(storageKey, JSON.stringify({ provider, expires: Date.now() + 600000 }));
      return provider;
    }
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (saved?.expires > Date.now() && ['google', 'discord'].includes(saved.provider)) return saved.provider;
    sessionStorage.removeItem(storageKey);
  } catch { /* Storage may be disabled; the callback URL can still show the greeting. */ }
  return window.location.pathname === '/account' && (provider === 'google' || provider === 'discord') ? provider : null;
}

export function OAuthWelcome() {
  const { user } = useStore();
  const [provider, setProvider] = useState(pendingWelcome);
  const [remaining, setRemaining] = useState(10);
  const location = useLocation();
  const navigate = useNavigate();
  const visible = !!user && !!provider && !['/two-factor', '/admin-verification', '/auth/error'].includes(location.pathname);
  useEffect(() => {
    if (!visible) return;
    try { sessionStorage.removeItem(storageKey); } catch { /* Optional storage. */ }
    // Remove the cosmetic marker so refreshing cannot replay the animation.
    const params = new URLSearchParams(location.search);
    if (params.has('welcome')) {
      params.delete('welcome');
      navigate({ pathname: location.pathname, search: params.toString(), hash: location.hash }, { replace: true });
    }
  }, [visible, location.pathname, location.search, location.hash, navigate]);
  useEffect(() => {
    if (!visible) return;
    const deadline = Date.now() + 10000;
    setRemaining(10);
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(seconds);
      if (!seconds) setProvider(null);
    };
    const timer = window.setInterval(tick, 250);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [visible]);
  if (!visible || !user) return null;
  return <Modal title="Đăng nhập thành công" className="oauth-welcome" close={() => setProvider(null)}>
    <div className="oauth-welcome-body">
    <div className="oauth-welcome-connection" aria-hidden="true">
      <span className={`oauth-welcome-provider ${provider}`}>{provider === 'google' ? <GoogleIcon /> : <DiscordIcon />}</span>
      <ArrowLeftRight className="oauth-welcome-arrows" size={28} />
      <Avatar className="oauth-welcome-avatar" name={user.name} url={user.avatar_url} />
    </div>
    <div className="oauth-welcome-copy" role="status">
      <span className="oauth-welcome-confirmed"><CheckCircle2 size={17} /> Đăng nhập thành công</span>
      <h2>Xin chào, <strong>{user.name}</strong></h2>
      <p>Chào mừng bạn đến với KEYNEST.</p>
    </div>
    <button className="button oauth-welcome-continue" onClick={() => setProvider(null)}>Tiếp tục vào cửa hàng <span className="oauth-welcome-countdown">{remaining}s</span></button>
    </div>
  </Modal>;
}
