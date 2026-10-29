import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { useDataRefresh } from './useDataRefresh';

// Mount with the account ID as key, so counts never carry across accounts.
export function UnreadChatBadge({ admin = false }: { admin?: boolean }) {
  const [count, setCount] = useState(0);
  const active = useRef(false);
  const sequence = useRef(0);
  const load = async () => {
    const version = ++sequence.current;
    const data = await api<{ unread_count: number; unread_order_count?: number; unread_chat_count: number }>('/notifications?page_size=1');
    if (active.current && version === sequence.current) setCount(admin ? data.unread_count : data.unread_order_count ?? data.unread_chat_count ?? 0);
  };
  useEffect(() => {
    active.current = true;
    void load().catch(() => {});
    return () => { active.current = false; sequence.current++; };
  }, [admin]);
  useDataRefresh(load, ['/notifications/read', '/order-chat/', '/admin/', '/tickets', '/orders'], { intervalMs: 10000 });
  return count > 0 ? <span className="header-chat-badge" aria-label={`${count} thông báo chưa đọc`} role="status">{count > 99 ? '99+' : count}</span> : null;
}
