import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createOperations } from '../server/operations.js';

// JWTs here only exercise the adapter; production verifies getUser before authorize.
const token = (session, iat) => `header.${Buffer.from(JSON.stringify({session_id: session, iat})).toString('base64url')}.signature`;
function fixture() {
  const calls = [];
  const state = { status: 'ok', providerError: null };
  const store = {
    query: async pending => { const result = await pending; if (result.error) throw result.error; return result.data; },
    client: {
      from: name => {
        assert.equal(name, 'account_controls');
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({data: null}) }) }) };
      },
      rpc: async (name, args) => {
        calls.push({name, args});
        return {data: name === 'authorize_app_session' ? {status: state.status, id: 'tracked-session'} : true};
      },
      auth: { admin: { signOut: async (jwt, scope) => {
        calls.push({name: 'signOut', jwt, scope});
        return {error: state.providerError};
      } } },
    },
  };
  return {ops: createOperations(store), calls, state};
}

test('refreshed JWTs keep original session identity and revoked/missing sessions fail closed', async () => {
  const {ops, calls, state} = fixture();
  const uid = randomUUID(), sid = randomUUID();
  const req = {user: {id: uid}, get: () => 'Browser'};
  await ops.authorize(req, token(sid, 100));
  assert.equal(req.sessionId, 'tracked-session');
  state.status = 'revoked';
  await assert.rejects(ops.authorize(req, token(sid, 200)), {status: 401});
  assert.equal(calls[0].args.p_session, sid);
  assert.equal(calls[0].args.p_hash, calls[1].args.p_hash);
  state.status = 'suspended';
  await assert.rejects(ops.authorize(req, token(sid, 300)), {status: 403});
  await assert.rejects(ops.authorize(req, token('invalid-session', 400)), {status: 401});
  assert.equal(calls.length, 3);
});

test('revoke others persists cutoff before provider signout and reports provider failures', async () => {
  const {ops, calls, state} = fixture();
  const uid = randomUUID(), keep = randomUUID();
  await ops.revoke(uid, undefined, keep, 'verified-access-token');
  assert.deepEqual(calls, [
    {name: 'revoke_app_sessions', args: {p_user: uid, p_id: null, p_except: keep}},
    {name: 'signOut', jwt: 'verified-access-token', scope: 'others'},
  ]);
  state.providerError = new Error('provider unavailable');
  await assert.rejects(ops.revoke(uid, undefined, keep, 'verified-access-token'), {status: 503});
  assert.equal(calls[2].name, 'revoke_app_sessions');
  assert.equal(calls[3].name, 'signOut');
});

test('single revocation stays owner scoped without signing out unrelated provider sessions', async () => {
  const {ops, calls} = fixture();
  const uid = randomUUID(), id = randomUUID();
  await ops.revoke(uid, id, undefined, 'verified-access-token');
  assert.deepEqual(calls, [{name: 'revoke_app_sessions', args: {p_user: uid, p_id: id, p_except: null}}]);
});
