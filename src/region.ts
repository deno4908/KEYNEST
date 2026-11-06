const message = 'KEYNEST hiện chỉ hoạt động tại Việt Nam.';
let restricted = false;
let checking: Promise<boolean> | null = null;
export const isRegionRestricted = () => restricted;
export function rejectRegion() {
  restricted = true;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('keynest:region-restricted'));
  return new Error(message);
}
export function checkRegion(): Promise<boolean> {
  if (restricted) return Promise.resolve(false);
  if (checking) return checking;
  checking = (async () => {
    const response = await fetch('/api/region', { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(10000) });
    const body = await response.json();
    if (body.allowed === false || body.code === 'REGION_RESTRICTED') { rejectRegion(); return false; }
    if (!response.ok || body.allowed !== true) throw new Error('Chưa kiểm tra được khu vực truy cập. Vui lòng thử lại.');
    return true;
  })().finally(() => { checking = null; });
  return checking;
}
