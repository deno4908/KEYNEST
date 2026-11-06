import { AppError } from './security.js';
export const sessionMaxAge = 7 * 86400000;

export function bearerToken(req) {
  const value = req.headers.authorization;
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^Bearer [^\s,]+$/i.test(value) || value.length > 16000)
    throw new AppError('Authorization không hợp lệ.', 401);
  return value.slice(7);
}

export async function verifyBearer(req, client) {
  const token = bearerToken(req);
  if (!token) throw new AppError('Vui lòng đăng nhập.', 401);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new AppError('Phiên đăng nhập đã hết hạn.', 401);
  return { token, user: data.user };
}

export function sendSession(res, session, cookieOptions) {
  res.clearCookie('kn_access', { ...cookieOptions, maxAge: undefined });
  res.cookie('kn_refresh', session.refresh_token, cookieOptions);
  res.setHeader('X-Access-Token', session.access_token);
  res.setHeader('Cache-Control', 'no-store');
}
