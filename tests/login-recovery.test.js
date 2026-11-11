import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { loginRecoveryRouter } from '../server/login-recovery.js';

test('OTP verification and sending fail closed without CAPTCHA, even when CAPTCHA is disabled; valid CAPTCHA is checked before OTP consumption', async t => {
  let calls = 0, verified = 0, sent = 0;
  const captcha = { enabled: true, hostname: 'keynest.store', secret: 'test-secret' };
  const app = express(); app.use(express.json());
  const seen = new Set();
  app.use('/api/auth/login-recovery', loginRecoveryRouter({ config: { mode: 'supabase', captcha },
    recovery: { requestOtp: async () => { sent++; return { challenge: 'challenge' }; }, redeemOtp: async () => { verified++; return { ticket: 'reset-only-ticket' }; } },
    fetcher: async (_url, request) => {
      calls++; const token = request.body.get('response');
      const success = token.startsWith('valid-') && !seen.has(token); seen.add(token);
      return { ok: true, json: async () => ({ success, hostname: captcha.hostname }) };
    },
  }));
  app.use((error, req, res, next) => res.status(error.status || 400).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (path, token, body) => fetch(`http://127.0.0.1:${server.address().port}/api/auth/login-recovery/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Captcha-Token': token } : {}) }, body: JSON.stringify(body),
  });
  const input = { challenge: 'a'.repeat(64), code: '123456' };
  assert.equal((await request('verify', null, input)).status, 400);
  assert.equal(calls, 0); assert.equal(verified, 0);
  assert.equal((await request('verify', 'invalid', input)).status, 400); assert.equal(verified, 0);
  assert.equal((await request('send', 'valid-send', { email: 'user@example.com' })).status, 200); assert.equal(sent, 1);
  assert.equal((await request('verify', 'valid-send', input)).status, 400); assert.equal(verified, 0);
  const response = await request('verify', 'valid-verify', input);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ticket: 'reset-only-ticket' });
  assert.equal(response.headers.has('set-cookie'), false); assert.equal(verified, 1);
  captcha.enabled = false;
  assert.equal((await request('verify', 'valid-disabled', input)).status, 503); assert.equal(verified, 1);
});
