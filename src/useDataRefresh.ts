import { useEffect, useRef } from 'react';

// Refresh mounted views after a successful write, without resetting their forms.
export function useDataRefresh(refresh: () => void | Promise<unknown>, prefixes: string[]) {
  const latest = useRef({ refresh, prefixes });
  latest.current = { refresh, prefixes };
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChange = (event: Event) => {
      const path = (event as CustomEvent<string>).detail;
      if (!latest.current.prefixes.some(prefix => path.startsWith(prefix))) return;
      clearTimeout(timer);
      timer = setTimeout(() => { void latest.current.refresh(); }, 50);
    };
    window.addEventListener('keynest:data-changed', onChange);
    return () => { clearTimeout(timer); window.removeEventListener('keynest:data-changed', onChange); };
  }, []);
}
