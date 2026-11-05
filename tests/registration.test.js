import test from 'node:test';
import assert from 'node:assert/strict';
import { registerSupabase } from '../server/registration.js';
import { accountLegal } from './helpers/legal.js';

const input = { email: 'member@example.test', name: 'Member', password: 'ExamplePass123', legal: accountLegal };
function fixture(conflicts = {}, creationError = null, loginError = null) {
  const calls = [];
  const store = {
    query: async (value) => value,
    profile: async () => ({ id: 'new-user', role: 'customer' }),
    client: {
      rpc: async () => conflicts,
      auth: { admin: { createUser: async (value) => {
        calls.push(value);
        return { data: { user: creationError ? null : { id: 'new-user' } }, error: creationError };
      } } },
    },
  };
  const auth = { auth: { signInWithPassword: async () => ({
    error: loginError, data: { session: loginError ? null : { access_token: 'test' } },
  }) } };
  return { store, auth, calls };
}
test('registration rejects duplicate email and name before creating an account', async () => {
  for (const field of ['email', 'name']) {
    const f = fixture({ [field]: true });
    await assert.rejects(registerSupabase(f.store, f.auth, input), /đã được sử dụng/);
    assert.equal(f.calls.length, 0);
  }
});
test('registration creates confirmed customer without invoking signup/email delivery', async () => {
  const f = fixture();
  const result = await registerSupabase(f.store, f.auth, input);
  assert.equal(result.user.role, 'customer');
  const { app_metadata, ...credentials } = f.calls[0];
  assert.deepEqual(credentials, {
    email: input.email, password: input.password, email_confirm: true,
    user_metadata: { name: input.name, registration_name: input.name },
  });
  assert.equal(app_metadata.legal_acceptance.version, accountLegal.version);
  assert.equal(app_metadata.legal_acceptance.account_data, true);
  assert.match(app_metadata.legal_acceptance.terms_sha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isFinite(Date.parse(app_metadata.legal_acceptance.accepted_at)));
});

test('registration never creates an Auth user without explicit current consent', async () => {
  for (const legal of [undefined, {}, { ...accountLegal, terms: false }, { ...accountLegal, account_data: false }, { ...accountLegal, version: 'old' }]) {
    const f = fixture();
    await assert.rejects(registerSupabase(f.store, f.auth, { ...input, legal }), error => [400, 409].includes(error.status));
    assert.equal(f.calls.length, 0);
  }
});
test('duplicate email returned by Auth is not reported as success', async () => {
  const f = fixture({}, { code: 'email_exists' });
  await assert.rejects(registerSupabase(f.store, f.auth, input), /Email đã được sử dụng/);
});
test('name uniqueness race is reported as conflict', async () => {
  const f = fixture({}, { code: 'unexpected_failure' });
  let count = 0;
  f.store.client.rpc = async () => ({ name: ++count > 1 });
  await assert.rejects(registerSupabase(f.store, f.auth, input), /Tên đăng ký đã được sử dụng/);
});
test('account remains usable if automatic login fails after creation', async () => {
  const f = fixture({}, null, { message: 'temporary auth failure' });
  const result = await registerSupabase(f.store, f.auth, input);
  assert.match(result.message, /Đã tạo tài khoản/);
  assert.equal(result.session, undefined);
});
