import { useEffect, useRef } from "react";

// Refresh mounted views after a successful write, without resetting their forms.
export function useDataRefresh(
  refresh: () => void | Promise<unknown>,
  prefixes: string[],
  {
    intervalMs = 0,
    enabled = true,
  }: { intervalMs?: number; enabled?: boolean } = {},
) {
  const latest = useRef({ refresh, prefixes });
  latest.current = { refresh, prefixes };
  useEffect(() => {
    if (!enabled) return;
    let stopped = false,
      running = false,
      pending = false,
      dirty = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      if (stopped) return;
      if (document.visibilityState === "hidden" || navigator.onLine === false) {
        dirty = true;
        return;
      }
      if (running) {
        pending = true;
        return;
      }
      running = true;
      dirty = false;
      try {
        await latest.current.refresh();
      } catch {
        dirty = true; /* Views report their own loading errors; retry on resume. */
      } finally {
        running = false;
        if (pending && !stopped) {
          pending = false;
          void run();
        }
      }
    };
    const onChange = (event: Event) => {
      const path = (event as CustomEvent<string>).detail;
      if (!latest.current.prefixes.some((prefix) => path.startsWith(prefix)))
        return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        void run();
      }, 50);
    };
    window.addEventListener("keynest:data-changed", onChange);
    const poll = intervalMs
      ? setInterval(() => {
          void run();
        }, intervalMs)
      : undefined;
    const resume = () => {
      if (intervalMs || dirty) void run();
    };
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener("keynest:data-changed", onChange);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [intervalMs, enabled]);
}
