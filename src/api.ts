let accessToken: string | null = null;
let initialized = false;
let refreshing: Promise<boolean> | null = null;

function receiveToken(res: Response) {
  const token = res.headers.get('X-Access-Token');
  if (token) accessToken = token;
}

async function refreshAccess(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'X-App-Request': 'keynest' },
    });
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
): Promise<T> {
  // Public storefront requests can start while the session is being restored.
  // Private routes and every mutation still wait for authentication as before.
  const publicRead = (options.method || 'GET').toUpperCase() === 'GET' &&
    ['/config', '/products', '/categories', '/catalog', '/banners', '/promotions', '/announcements'].includes(path.split('?')[0]);
  if (!initialized && !publicRead) await refreshAccess();
  const send = () => {
    const headers = new Headers(options.headers);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    headers.set('X-App-Request', 'keynest');
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    return fetch(`/api${path}`, {
    cache: 'no-store',
    ...options,
    credentials: "same-origin",
    headers,
    });
  };
  let res = await send();
  let body = await res.json();
  if (res.status === 401 && body.code === 'AUTH_REQUIRED' && await refreshAccess()) {
    res = await send();
    body = await res.json();
  }
  receiveToken(res);
  if (path === '/auth/logout' && res.ok) accessToken = null;
  if (body.code === "ADMIN_OTP_REQUIRED" || body.admin_otp_required) {
    if (
      !["/admin-verification", "/two-factor"].includes(window.location.pathname)
    )
      window.location.assign("/admin-verification");
    throw new Error("Vui lòng xác minh OTP email dành cho admin.");
  }
  if (body.code === "MFA_REQUIRED" || body.mfa_required) {
    if (window.location.pathname !== "/two-factor")
      window.location.assign("/two-factor");
    throw new Error("Vui lòng xác minh hai bước.");
  }
  if (!res.ok) throw new Error(body.error || "Không thể kết nối.");
  if (!['GET', 'HEAD', 'OPTIONS'].includes((options.method || 'GET').toUpperCase())) {
    window.dispatchEvent(new CustomEvent('keynest:data-changed', { detail: path }));
  }
  return body;
}
export const post = <T>(
  path: string,
  body: unknown = {},
  headers: Record<string, string> = {},
) => api<T>(path, { method: "POST", body: JSON.stringify(body), headers });
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
