import { rejectRegion } from './region';
import { publishDataChange } from './dataChanges';
let accessToken: string | null = null;
let initialized = false;
let refreshing: Promise<boolean> | null = null;
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public retryAfter?: number) { super(message); }
}

function receiveToken(res: Response) {
  const token = res.headers.get('X-Access-Token');
  if (token) accessToken = token;
}

function redirectTo(path: string) {
  if (typeof window !== 'undefined' && window.location.pathname !== path) {
    window.location.assign(path);
  }
}

async function refreshAccess(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'X-App-Request': 'keynest' },
    });
    if (res.status === 403 && (await res.clone().json().catch(() => ({}))).code === 'REGION_RESTRICTED') {
      accessToken = null;
      throw rejectRegion();
    }
    if (!res.ok && res.status !== 401) throw new Error('Không thể khôi phục phiên đăng nhập. Vui lòng thử lại.');
    accessToken = null;
    receiveToken(res);
    initialized = true;
    return res.ok;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
  prepareBody?: () => Promise<string>,
): Promise<T> {
  // Public storefront requests can start while the session is being restored.
  // Private routes and every mutation still wait for authentication as before.
  const publicRead = (options.method || 'GET').toUpperCase() === 'GET' &&
    ['/config', '/products', '/categories', '/catalog', '/banners', '/promotions', '/announcements'].includes(path.split('?')[0]);
  const recovery = ['/auth/reset/verify', '/auth/reset', '/auth/login-recovery/send', '/auth/login-recovery/verify'].includes(path);
  if (!initialized && !publicRead && !recovery) await refreshAccess();
  const send = async () => {
    const headers = new Headers(options.headers);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    headers.set('X-App-Request', 'keynest');
    if (accessToken && !recovery) headers.set('Authorization', `Bearer ${accessToken}`);
    return fetch(`/api${path}`, {
    cache: 'no-store',
    ...options,
    ...(prepareBody ? { body: await prepareBody() } : {}),
    credentials: "same-origin",
    headers,
    });
  };
  let res = await send();
  let body = await res.json();
  if (body.code === 'REGION_RESTRICTED') { accessToken = null; throw rejectRegion(); }
  if (!recovery && res.status === 401 && body.code === 'AUTH_REQUIRED' && await refreshAccess()) {
    res = await send();
    body = await res.json();
    if (body.code === 'REGION_RESTRICTED') { accessToken = null; throw rejectRegion(); }
  }
  receiveToken(res);
  if (path === '/auth/logout' && res.ok) accessToken = null;
  if (path === '/auth/login' && (body.code === 'ADMIN_OTP_REQUIRED' || body.admin_otp_required || body.code === 'MFA_REQUIRED' || body.mfa_required)) {
    // Cosmetic only: the welcome still requires an authenticated /me response.
    try { sessionStorage.setItem('kn-oauth-welcome', JSON.stringify({ provider: 'email', expires: Date.now() + 600000 })); } catch { /* Optional storage. */ }
  }
  if (body.code === "ADMIN_OTP_REQUIRED" || body.admin_otp_required) {
    if (
      typeof window !== 'undefined' &&
      !["/admin-verification", "/two-factor"].includes(window.location.pathname)
    )
      redirectTo("/admin-verification");
    throw new Error("Vui lòng xác minh OTP email dành cho admin.");
  }
  if (body.code === "MFA_REQUIRED" || body.mfa_required) {
    redirectTo("/two-factor");
    throw new Error("Vui lòng xác minh hai bước.");
  }
  if (!res.ok) throw new ApiError(body.error || "Không thể kết nối.", res.status, body.code, body.retry_after);
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes((options.method || 'GET').toUpperCase()) &&
    typeof window !== 'undefined' &&
    typeof CustomEvent !== 'undefined'
  ) {
    publishDataChange(path);
  }
  return body;
}
export const post = async <T>(
  path: string,
  body: unknown = {},
  headers: Record<string, string> = {},
) => {
  if (['/auth/login', '/auth/register', '/auth/reset', '/me/password'].includes(path) &&
      body && typeof body === 'object' && 'password' in body) {
    const { protectPasswordRequest } = await import('./password-transport');
    // A retry after session refresh is a new request with a fresh nonce.
    return api<T>(path, { method: 'POST', headers }, async () => JSON.stringify(await protectPasswordRequest(path, body)));
  }
  return api<T>(path, { method: "POST", body: JSON.stringify(body), headers });
};
export const money = (n: number) =>
  new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(n);
export const date = (d: string) =>
  new Date(d).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
export const categories: Record<string, string> = {
  all: "Tất cả",
  game: "Game key",
  gift: "Gift card",
  topup: "Nạp game",
  mmo: "MMO & Proxy",
};
export function updateCategories(rows: { id: string; name: string }[]) {
  for (const key of Object.keys(categories)) delete categories[key];
  categories.all = 'Tất cả';
  for (const row of rows) if (/^[a-z][a-z0-9-]*$/.test(row.id) && !['all','constructor','prototype'].includes(row.id)) categories[row.id] = row.name;
}
export const statuses: Record<string, string> = {
  pending: "Chờ thanh toán",
  paid: "Đã thanh toán",
  processing: "Đang xử lý",
  completed: "Hoàn thành",
  expired: "Hết hạn",
  cancelled: "Đã hủy",
  refunded: "Đã hoàn tiền",
  in_progress: "Đang xử lý",
  open: "Đang chờ",
  closed: "Đã phản hồi",
};
