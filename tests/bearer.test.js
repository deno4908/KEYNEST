import test from 'node:test';
import assert from 'node:assert/strict';
import { bearerToken, verifyBearer, sendSession } from '../server/bearer.js';

test('Bearer parser rejects ambiguous headers and never reads access cookies', () => {
  assert.equal(bearerToken({ headers: {}, cookies: { kn_access: 'old' } }), null);
  assert.equal(bearerToken({ headers: { authorization: 'bearer valid.token' } }), 'valid.token');
  for (const value of ['', 'Basic abc', 'Bearer ', 'Bearer a,b', 'Bearer a b', ['Bearer a'], 'Bearer ' + 'a'.repeat(16000)])
    assert.throws(() => bearerToken({ headers: { authorization: value } }), { status: 401 });
});
test('Bearer signature verification is required even when a refresh cookie exists', async () => {
  let received;
  const client = { auth: { getUser: async token => {
    received = token;
    return token === 'valid' ? { data: { user: { id: 'owner' } }, error: null } : { data: {}, error: {} };
  } } };
  const req = { headers: { authorization: 'Bearer valid' } };
  assert.equal((await verifyBearer(req, client)).user.id, 'owner');
  assert.equal(received, 'valid');
  await assert.rejects(verifyBearer({ headers: { authorization: 'Bearer forged' }, cookies: { kn_refresh: 'valid-refresh' } }, client), { status: 401 });
  await assert.rejects(verifyBearer({ headers: {}, cookies: { kn_access: 'valid' } }, client), { status: 401 });
});
test('session delivery keeps refresh HttpOnly and sends access only in a noncacheable response header', () => {
  const cookies = [], cleared = [], headers = {};
  const res = { cookie: (...args) => cookies.push(args), clearCookie: (...args) => cleared.push(args), setHeader: (k,v) => { headers[k] = v; } };
  sendSession(res, { access_token: 'access', refresh_token: 'refresh' }, { httpOnly: true, secure: true, sameSite: 'lax', path: '/api' });
  assert.equal(cookies.length, 1);
  assert.equal(cookies[0][0], 'kn_refresh');
  assert.equal(cookies[0][2].httpOnly, true);
  assert.equal(cleared[0][0], 'kn_access');
  assert.equal(headers['X-Access-Token'], 'access');
  assert.equal(headers['Cache-Control'], 'no-store');
});
