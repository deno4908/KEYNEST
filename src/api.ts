export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-App-Request": "keynest",
      ...options.headers,
    },
  });
  const body = await res.json();
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
