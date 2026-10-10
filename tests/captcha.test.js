import test from 'node:test';
import assert from 'node:assert/strict';
import { captchaConfig, captchaGuard } from '../server/captcha.js';

const cfg = { enabled: true, siteKey: 'site', secret: 'private-secret', hostname: 'keynest.store' };
async function verify(token, result, options = {}) {
  let calls = 0, error;
  await captchaGuard(cfg, async (url, request) => {
    calls++;
    assert.equal(url, 'https://www.google.com/recaptcha/api/siteverify');
    assert.equal(request.method, 'POST');
    assert.equal(request.body.get('secret'), cfg.secret);
    assert.equal(request.body.get('response'), token);
    if (options.throw) throw new Error('network error');
    return { ok: options.ok !== false, json: async () => result };
  })({ headers: { 'x-captcha-token': token } }, {}, e => { error = e; });
  return { calls, error };
}
test('captcha requires keys when enabled and forbids public testing keys in production', () => {
  assert.equal(captchaConfig({}).enabled, false);
  assert.throws(() => captchaConfig({ RECAPTCHA_ENABLED: 'yes' }));
  assert.throws(() => captchaConfig({ RECAPTCHA_ENABLED: 'true' }));
  assert.throws(() => captchaConfig({ RECAPTCHA_ENABLED: 'true', NODE_ENV: 'production', RECAPTCHA_SITE_KEY: '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI', RECAPTCHA_SECRET_KEY: 'secret' }));
  assert.equal(captchaConfig({ APP_ORIGIN: 'https://keynest.store', RECAPTCHA_ENABLED: 'true', RECAPTCHA_SITE_KEY: 'site', RECAPTCHA_SECRET_KEY: 'secret' }).hostname, 'keynest.store');
});
test('missing/oversized/ambiguous captcha never calls provider or allows authentication', async () => {
  for (const token of [undefined, '', ' ', ['one','two'], 'x'.repeat(8193)]) {
    const result = await verify(token);
    assert.equal(result.calls, 0);
    assert.equal(result.error.status, 400);
  }
});
test('captcha verifies successful response against the configured hostname', async () => {
  assert.equal((await verify('valid', { success: true, hostname: 'keynest.store' })).error, undefined);
  for (const response of [null, { success: false }, { success: true }, { success: true, hostname: 'attacker.example' }, { success: true, hostname: 'keynest.store.attacker.example' }, { success: false, 'error-codes': ['timeout-or-duplicate'] }])
    assert.equal((await verify('invalid', response)).error.status, 400);
});
test('captcha provider failure does not bypass verification', async () => {
  assert.equal((await verify('token', {}, { throw: true })).error.status, 503);
  assert.equal((await verify('token', {}, { ok: false })).error.status, 503);
});
test('disabled captcha does not call Google', async () => {
  let passed = false;
  await captchaGuard({ ...cfg, enabled: false }, () => { throw new Error('Unexpected call'); })({ headers: {} }, {}, error => { assert.equal(error, undefined); passed = true; });
  assert.equal(passed, true);
});
