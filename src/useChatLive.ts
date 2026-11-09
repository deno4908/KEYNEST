import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { publishDataChange } from './dataChanges';

type Pending = { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

// History arrives on subscription/reconnection; subsequent snapshots are pushed
// only after changes. Timers reconnect/ping the transport, never poll chat APIs.
export function useChatLive<T>(topic: string | null, owner: string | undefined,
  receive: (data: T) => void, report: (message: string) => void) {
  const [connected, setConnected] = useState(false);
  const latest = useRef({ receive, report });
  latest.current = { receive, report };
  const transport = useRef<{ ws: WebSocket; pending: Map<string, Pending> } | null>(null);
  useEffect(() => {
    setConnected(false);
    if (!topic || !owner) return;
    let stopped = false, connecting = false, attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let handshake: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const failPending = (message: string) => {
      for (const request of transport.current?.pending.values() || []) {
        clearTimeout(request.timer);
        request.reject(new Error(message));
      }
      transport.current?.pending.clear();
    };
    const schedule = () => {
      clearTimeout(retry);
      if (stopped) return;
      retry = setTimeout(() => void open(), Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)) + Math.random() * 500);
    };
    const open = async () => {
      if (stopped || connecting || transport.current) return;
      if (navigator.onLine === false) { schedule(); return; }
      connecting = true;
      controller = new AbortController();
      try {
        const { ticket } = await api<{ ticket: string }>('/chat/live-ticket', {
          method: 'POST', body: JSON.stringify({ topic }), signal: controller.signal,
        });
        if (stopped) return;
        const url = new URL('/api/chat/live', window.location.href);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(url, ['keynest-chat', `ticket.${ticket}`]);
        const pending = new Map<string, Pending>();
        transport.current = { ws, pending };
        handshake = setTimeout(() => ws.close(), 15000);
        ws.onmessage = event => {
          if (stopped || transport.current?.ws !== ws) return;
          try {
            const message = JSON.parse(event.data);
            if (message.type === 'snapshot') {
              clearTimeout(handshake);
              attempt = 0;
              setConnected(true);
              latest.current.receive(message.data as T);
            } else if (message.type === 'result' || message.type === 'error') {
              const request = pending.get(message.id);
              if (request) {
                clearTimeout(request.timer);
                pending.delete(message.id);
                if (message.type === 'error') request.reject(new Error(message.error));
                else {
                  request.resolve();
                  publishDataChange(topic.startsWith('order:') ? `/order-chat/${topic.slice(6)}` : topic === 'tickets' ? '/tickets' : '/seller/support/');
                }
              } else if (message.type === 'error') latest.current.report(message.error);
            }
          } catch { latest.current.report('Không thể đọc cập nhật chat. Vui lòng mở lại cuộc trò chuyện.'); }
        };
        ws.onerror = () => { /* onclose reconnects; drafts stay in the component. */ };
        ws.onclose = () => {
          if (stopped || transport.current?.ws !== ws) return;
          clearTimeout(handshake);
          setConnected(false);
          failPending('Kết nối bị ngắt trước khi nhận xác nhận. Kiểm tra tin nhắn sau khi kết nối lại.');
          transport.current = null;
          schedule();
        };
      } catch (error) {
        if (!stopped) { latest.current.report((error as Error).message); schedule(); }
      } finally { connecting = false; }
    };
    const resume = () => {
      if (document.hidden) return;
      if (!transport.current) { clearTimeout(retry); void open(); }
    };
    const sessionChanged = (event: Event) => {
      if ((event as CustomEvent<string>).detail === '/auth/logout') {
        stopped = true;
        controller?.abort();
        clearTimeout(retry);
        clearTimeout(handshake);
        failPending('Bạn đã đăng xuất.');
        transport.current?.ws.close();
        transport.current = null;
        setConnected(false);
      }
    };
    void open();
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('keynest:data-changed', sessionChanged);
    document.addEventListener('visibilitychange', resume);
    return () => {
      stopped = true;
      controller?.abort();
      clearTimeout(retry); clearTimeout(handshake);
      failPending('Cuộc trò chuyện đã đóng.');
      transport.current?.ws.close();
      transport.current = null;
      window.removeEventListener('online', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('keynest:data-changed', sessionChanged);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [topic, owner]);
  const send = useCallback((input: unknown) => new Promise<void>((resolve, reject) => {
    const current = transport.current;
    if (!current || current.ws.readyState !== WebSocket.OPEN) {
      reject(new Error('Chat đang kết nối lại. Vui lòng chờ rồi gửi tin nhắn.'));
      return;
    }
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      current.pending.delete(id);
      reject(new Error('Chưa nhận được xác nhận. Kiểm tra cuộc trò chuyện trước khi gửi lại.'));
    }, 20000);
    current.pending.set(id, { resolve, reject, timer });
    try { current.ws.send(JSON.stringify({ id, input })); }
    catch {
      clearTimeout(timer);
      current.pending.delete(id);
      reject(new Error('Không thể gửi tin nhắn. Vui lòng chờ kết nối lại.'));
    }
  }), []);
  return { connected, send };
}
