import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createHash } from 'node:crypto';
import { createAdminOtp } from '../server/admin-otp.js';
import { sessionRefreshHandler } from '../server/session-refresh.js';
import { sendSession, sessionMaxAge } from '../server/bearer.js';
import { encrypt, AppError } from '../server/security.js';

test('real refresh response keeps admin verification only after provider and authorization accept the same session', async t => {
  const uid = '11111111-1111-4111-8111-111111111111';
  const config = { mode: 'supabase', production: false, encryption: 'b'.repeat(64) };
  const now = Date.now();
  let sid = 'original', revoked = false, refreshFailed = false, email = 'admin@example.test', authorized = 0;
  const token = () => `h.${Buffer.from(JSON.stringify({ sub: uid, session_id: sid, iat: now })).toString('base64url')}.s`;
  const adminOtp = createAdminOtp({ config, clock: () => now, makeAuthClient: () => {} });
  const key = createHash('sha256').update(config.encryption).update('admin-email-otp-v2:').update('kn_admin_verified').digest('hex');
  const proof = encrypt(JSON.stringify({ uid, sid, email, expires: now + 60000 }), key);
  const app = express();
  app.use(cookieParser());
  app.post('/refresh', sessionRefreshHandler({ config, adminOtp,
    makeAuthClient: () => ({ auth: { refreshSession: async ({ refresh_token }) => {
      assert.equal(refresh_token, 'valid-refresh');
      return refreshFailed ? { error: new Error('invalid'), data: {} } : { error: null, data: {
        user: { id: uid, email }, session: { access_token: token(), refresh_token: 'rotated-refresh' },
      } };
    } } }),
    store: { profile: async id => ({ id, role: 'admin' }) },
    operations: { authorize: async (req, jwt) => {
      authorized++; assert.equal(req.user.id, uid); assert.equal(jwt, token());
      if (revoked) throw new AppError('revoked', 403);
    } },
    setAuth: (res, session) => sendSession(res, session, { httpOnly: true, path: '/api', maxAge: sessionMaxAge }),
    clearAuth: res => { adminOtp.clear(res); res.clearCookie('kn_refresh', { path: '/api' }); },
  }));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const request = (cookie = `kn_refresh=valid-refresh; kn_admin_verified=${encodeURIComponent(proof)}`) => fetch(`http://127.0.0.1:${server.address().port}/refresh`, { method: 'POST', headers: { Cookie: cookie } });
  const same = await request();
  assert.equal(same.status, 200);
  assert.ok(same.headers.getSetCookie().some(c => c.startsWith('kn_admin_verified=') && c.includes('Max-Age=604800')));
  assert.equal(same.headers.get('X-Access-Token'), token());
  assert.equal(authorized, 1);
  for (const change of ['missing', 'session', 'email']) {
    sid = change === 'session' ? 'new-login' : 'original';
    email = change === 'email' ? 'changed@example.test' : 'admin@example.test';
    const response = await request(change === 'missing' ? 'kn_refresh=valid-refresh' : undefined);
    assert.equal(response.status, 200);
    assert.ok(!response.headers.getSetCookie().some(c => c.startsWith('kn_admin_verified=')));
  }
  revoked = true;
  const denied = await request();
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('X-Access-Token'), null);
  assert.ok(denied.headers.getSetCookie().some(c => c.startsWith('kn_admin_verified=;')));
  refreshFailed = true;
  const expired = await request();
  assert.equal(expired.status, 401);
  assert.equal(expired.headers.get('X-Access-Token'), null);
  assert.equal((await request('')).status, 401);
});
