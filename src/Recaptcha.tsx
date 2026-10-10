import { useEffect, useRef, useState } from 'react';
import './recaptcha.css';

type CaptchaApi = {
  ready: (callback: () => void) => void;
  render: (element: HTMLElement, options: Record<string, unknown>) => number;
  reset: (id: number) => void;
};
declare global { interface Window { grecaptcha?: CaptchaApi } }
let scriptPromise: Promise<CaptchaApi> | null = null;
function loadCaptcha() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<CaptchaApi>((resolve, reject) => {
    const script = document.createElement('script');
    const timer = window.setTimeout(() => fail(), 15000);
    function fail() {
      window.clearTimeout(timer);
      script.remove();
      reject(new Error('Không tải được reCAPTCHA. Kiểm tra kết nối hoặc tiện ích chặn nội dung rồi thử lại.'));
    }
    script.src = 'https://www.google.com/recaptcha/api.js?render=explicit&hl=vi';
    script.async = true;
    script.onerror = fail;
    script.onload = () => {
      if (!window.grecaptcha) return fail();
      window.grecaptcha.ready(() => {
        window.clearTimeout(timer);
        resolve(window.grecaptcha!);
      });
    };
    document.head.append(script);
  }).catch(error => { scriptPromise = null; throw error; });
  return scriptPromise;
}

export function Recaptcha({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  callback.current = onToken;
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let id: number | undefined;
    let api: CaptchaApi | undefined;
    setLoading(true);
    setError('');
    callback.current('');
    // Own each rendered node so StrictMode/unmount cannot leave a stale widget.
    const element = document.createElement('div');
    container.current?.append(element);
    loadCaptcha().then(loaded => {
      if (!active) return;
      api = loaded;
      id = loaded.render(element, {
        sitekey: siteKey, theme: 'dark',
        size: (container.current?.clientWidth || 304) < 304 ? 'compact' : 'normal',
        callback: (token: string) => { if (active) { setError(''); callback.current(token); } },
        'expired-callback': () => { if (active) { callback.current(''); setError('Xác minh đã hết hạn. Vui lòng chọn lại.'); } },
        'error-callback': () => { if (active) { callback.current(''); setError('Không xác minh được. Vui lòng thử lại.'); } },
      });
      setLoading(false);
    }).catch(error => { if (active) { setError(error.message); setLoading(false); } });
    return () => {
      active = false;
      if (id !== undefined) api?.reset(id);
      element.remove();
    };
  }, [siteKey, attempt]);
  return <div className="auth-captcha">
    <div ref={container} />
    {loading && <p role="status">Đang tải xác minh chống spam…</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt(n => n + 1)}>Thử lại reCAPTCHA</button></div>}
  </div>;
}
