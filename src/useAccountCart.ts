import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { CartItem } from './types';

type SavedCart = { user_id: string; items: CartItem[] };
function guestCart(): CartItem[] {
  try {
    const rows = JSON.parse(localStorage.getItem('kn-cart') || '[]');
    const seen = new Set<string>();
    return Array.isArray(rows) ? rows.filter(row => {
      if (!row || typeof row.variant_id !== 'string' || seen.has(row.variant_id) ||
        !Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 10) return false;
      seen.add(row.variant_id);
      return true;
    }).slice(0, 20) : [];
  } catch { return []; }
}

export function useAccountCart(userId: string | undefined, sessionReady: boolean, notify: (message: string, error?: boolean) => void) {
  const owner = userId || '';
  const active = useRef(owner);
  active.current = owner;
  const notice = useRef(notify);
  notice.current = notify;
  const [state, setState] = useState({ owner: '', items: [] as CartItem[], ready: false, error: '' });
  const [reload, setReload] = useState(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const revision = useRef(0);
  const generation = useRef(0);
  const writeError = useRef<Error | null>(null);
  useEffect(() => {
    if (!sessionReady) return;
    const epoch = ++generation.current;
    let alive = true;
    setState({ owner, items: [], ready: false, error: '' });
    const load = async () => {
      await queue.current;
      if (!alive) return;
      try {
        const result = owner ? await api<SavedCart>('/cart') : null;
        if (result && result.user_id !== owner) throw new Error('Tài khoản đã thay đổi. Vui lòng tải lại giỏ hàng.');
        if (alive && generation.current === epoch) {
          writeError.current = null;
          setState({ owner, items: result?.items || guestCart(), ready: true, error: '' });
        }
      } catch (error) {
        if (alive) setState({ owner, items: [], ready: false, error: (error as Error).message });
      }
    };
    void load();
    return () => { alive = false; };
  }, [owner, sessionReady, reload]);

  const ready = sessionReady && state.owner === owner && state.ready;
  function setCart(items: CartItem[]) {
    if (!ready || active.current !== owner) return;
    const version = ++revision.current;
    const epoch = generation.current;
    setState({ owner, items, ready: true, error: '' });
    if (!owner) {
      try { localStorage.setItem('kn-cart', JSON.stringify(items)); }
      catch { notice.current('Không lưu được giỏ hàng trên trình duyệt.', true); }
      return;
    }
    queue.current = queue.current.then(async () => {
      if (active.current !== owner || generation.current !== epoch) return;
      try {
        const result = await api<SavedCart>('/cart', { method: 'PUT', body: JSON.stringify({ user_id: owner, items }) });
        if (result.user_id !== owner) throw new Error('Tài khoản đã thay đổi.');
        if (revision.current === version) writeError.current = null;
      } catch {
        if (active.current !== owner || generation.current !== epoch) return;
        notice.current('Chưa lưu được giỏ hàng. Vui lòng tải lại và thử lại.', true);
        if (revision.current === version) {
          writeError.current = new Error('Chưa lưu được giỏ hàng vào tài khoản. Vui lòng tải lại và thử lại.');
          setState({ owner, items, ready: false, error: writeError.current.message });
        }
      }
    });
  }
  return {
    cart: state.owner === owner && sessionReady ? state.items : [],
    cartReady: ready,
    cartError: state.owner === owner ? state.error : '',
    retryCart: () => setReload(value => value + 1),
    setCart,
    flushCart: async () => {
      await queue.current;
      if (active.current !== owner) throw new Error('Tài khoản đã thay đổi. Vui lòng tải lại giỏ hàng.');
      if (writeError.current) throw writeError.current;
    },
  };
}
