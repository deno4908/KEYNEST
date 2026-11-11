import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

test('real login route requires recovery on fifth failure and the next correct password; only admin can unlock and no OTP request bypasses CAPTCHA', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'keynest-login-test-'));
  Object.assign(process.env, { NODE_ENV: 'test', APP_MODE: 'demo', RECAPTCHA_ENABLED: 'false', BANK_PAYMENT_PROVIDER: 'sepay', DEMO_DATA_PATH: join(directory, 'store.json') });
  const { app, store } = await import('../server/index.js');
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'keynest-login-test-'));
    rmSync(directory, { recursive: true, force: true });
  });
  const request = async (path, body = {}, cookie = '') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173', 'X-App-Request': 'keynest', Cookie: cookie }, body: JSON.stringify(body),
    });
    return { response, body: await response.json(), cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
  };
  for (let i = 0; i < 5; i++) {
    const result = await request('/auth/login', { email: 'student@keynest.local', password: 'wrong' });
    assert.equal(result.response.status, i < 4 ? 401 : 429);
    assert.equal(result.cookie, '');
    if (i === 4) assert.equal(result.body.code, 'PASSWORD_RECOVERY_REQUIRED');
  }
  const correct = { email: 'student@keynest.local', password: 'Student123!' };
  assert.equal((await request('/auth/login', correct)).body.code, 'PASSWORD_RECOVERY_REQUIRED');
  const gate = Object.values(store.db.login_attempts)[0];
  gate.otp_blocked_until = new Date(Date.now() + 1800000).toISOString();
  store.save();
  for (const password of [correct.password, 'wrong-again']) {
    const blocked = await request('/auth/login', { ...correct, password });
    assert.equal(blocked.response.status, 429);
    assert.equal(blocked.body.code, 'RECOVERY_OTP_LOCKED');
    assert.ok(blocked.body.retry_after > 0 && blocked.body.retry_after <= 1800);
    assert.equal(Number(blocked.response.headers.get('Retry-After')), blocked.body.retry_after);
    assert.equal(blocked.cookie, '');
  }
  gate.otp_blocked_until = new Date(Date.now() - 1).toISOString();
  assert.equal((await request('/auth/login', correct)).body.code, 'PASSWORD_RECOVERY_REQUIRED', 'expiry still requires OTP with the correct password');
  const id = store.db.users.find(user => user.email === correct.email).id;
  assert.equal((await request(`/admin/customers/${id}/login-unlock`)).response.status, 401);
  const admin = await request('/auth/login', { email: 'admin@keynest.local', password: 'Admin123!' });
  assert.equal(admin.response.status, 200);
  assert.equal((await request(`/admin/customers/${id}/login-unlock`, {}, admin.cookie)).response.status, 200);
  assert.ok(store.db.audit.some(row => row.action === 'login_protection_unlocked' && row.target === id));
  assert.equal((await request('/auth/login', correct)).response.status, 200);
  assert.equal((await request('/auth/login-recovery/verify', { code: '123456', challenge: 'x'.repeat(64) })).response.status, 400);
});
