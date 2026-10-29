import { useEffect, useRef } from "react";
import { api } from "./api";
import type { Product } from "./types";

export function useLiveProducts(enabled: boolean, update: (products: Product[]) => void) {
  const latest = useRef(update);
  latest.current = update;
  useEffect(() => {
    if (!enabled) return;
    let stopped = false, connected = false, polling = false, previous = "";
    let source: EventSource | null = null;
    const controller = new AbortController();
    const accept = (rows: Product[]) => {
      if (stopped || !Array.isArray(rows)) return;
      const signature = JSON.stringify(rows);
      if (signature === previous) return;
      previous = signature;
      latest.current(rows);
      window.dispatchEvent(new CustomEvent('keynest:data-changed', { detail: '/catalog-live' }));
    };
    const poll = async () => {
      if (stopped || polling || document.visibilityState === 'hidden' || navigator.onLine === false) return;
      polling = true;
      try { accept(await api<Product[]>('/products', { signal: controller.signal })); }
      catch { /* Adding to the cart still requires a fresh successful stock check. */ }
      finally { polling = false; }
    };
    const open = () => {
      if (source || stopped || document.visibilityState === 'hidden' || navigator.onLine === false || !window.EventSource) return;
      source = new EventSource('/api/products?live=1');
      source.onmessage = event => {
        try { accept(JSON.parse(event.data)); connected = true; }
        catch { connected = false; }
      };
      source.onerror = () => { connected = false; };
      source.addEventListener('catalog-unavailable', () => { connected = false; });
    };
    const resume = () => {
      if (document.visibilityState === 'hidden' || navigator.onLine === false) {
        source?.close(); source = null; connected = false;
      } else { open(); void poll(); }
    };
    open();
    const timer = setInterval(() => { if (!connected) { open(); void poll(); } }, 5000);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      stopped = true; controller.abort(); source?.close(); clearInterval(timer);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [enabled]);
}
