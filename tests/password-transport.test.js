import test from 'node:test';
import assert from 'node:assert/strict';
import { CompactEncrypt, importJWK } from 'jose';
import { createPasswordTransport } from '../server/password-transport.js';
import { createMemoryNonceStore, createSupabaseNonceStore } from '../server/request-nonces.js';

async function seal(transport, path, body, header = {}) {
  const { jwk, kid, timestamp, nonce } = transport.publicKey();
  return new CompactEncrypt(new TextEncoder().encode(JSON.stringify({ path, body, iat: timestamp, nonce })))
    .setProtectedHeader({ alg: 'ECDH-ES', enc: 'A256GCM', typ: 'keynest-password+jwe', kid, ...header })
    .encrypt(await importJWK(jwk, 'ECDH-ES'));
}

test('password requests use randomized JWE, survive replicas and contain no cleartext passwords', async () => {
  const nonceStore = createMemoryNonceStore();
  const transport = createPasswordTransport('ab'.repeat(32), undefined, { nonceStore });
  const replica = createPasswordTransport('ab'.repeat(32), undefined, { nonceStore });
  const body = { email: 'demo@example.test', password: 'ExamplePassword123!' };
  const first = await seal(transport, '/auth/login', body), second = await seal(transport, '/auth/login', body);
  assert.notEqual(first, second);
  assert.equal(first.includes(body.password), false);
  assert.equal('d' in transport.publicKey().jwk, false);
  assert.deepEqual(await replica.open(first, '/auth/login'), body);
  await assert.rejects(transport.open(first, '/auth/login'), e => e.status === 409);
  const unicode = { password: '密'.repeat(128), current_password: 'OldPassword123!', password_confirmation: '密'.repeat(128) };
  assert.deepEqual(await replica.open(await seal(transport,'/me/password',unicode), '/me/password'), unicode);
});

test('only one simultaneous redemption across replicas succeeds, including re-encryption', async () => {
  const nonceStore = createMemoryNonceStore();
  const a = createPasswordTransport('ab'.repeat(32), undefined, { nonceStore });
  const b = createPasswordTransport('ab'.repeat(32), undefined, { nonceStore });
  const challenge = a.publicKey();
  const issuer = { publicKey: () => challenge };
  const first = await seal(issuer, '/auth/login', { password: 'ExamplePassword123!' });
  const second = await seal(issuer, '/auth/login', { password: 'ExamplePassword123!' });
  const results = await Promise.allSettled([a.open(first, '/auth/login'), b.open(second, '/auth/login')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
});

test('forged nonce timestamps and missing nonce cannot bypass server issuance', async () => {
  const transport = createPasswordTransport('ab'.repeat(32));
  const challenge = transport.publicKey();
  for (const nonce of [undefined, challenge.nonce.replace(/^[a-f0-9]/, c => c === 'a' ? 'b' : 'a')]) {
    const encrypted = await seal({ publicKey: () => ({ ...challenge, nonce }) }, '/auth/login', {});
    await assert.rejects(transport.open(encrypted, '/auth/login'), e => e.status === 400);
  }
  const timestamp = challenge.timestamp + 1;
  const encrypted = await seal({ publicKey: () => ({ ...challenge, timestamp,
    nonce: challenge.nonce.replace(String(challenge.timestamp), String(timestamp)) }) }, '/auth/login', {});
  await assert.rejects(transport.open(encrypted, '/auth/login'), e => e.status === 400);
});

test('production rejects plaintext on case and trailing-slash variants; nonce storage fails closed', async () => {
  for (const failure of ['database error', 'network error', 'invalid response']) {
    const nonceStore = createSupabaseNonceStore({ client: { async rpc() {
      if (failure === 'network error') throw new Error('offline');
      return failure === 'database error' ? { error: { code: 'missing_migration' } } : { data: null };
    } } });
    const transport = createPasswordTransport('ab'.repeat(32), undefined, { nonceStore, requireEncrypted: true });
    await assert.rejects(transport.open(await seal(transport, '/auth/reset', {}), '/auth/reset'), e => e.status === 503);
    for (const path of ['/auth/login', '/AUTH/REGISTER/', '/auth/reset/', '/ME/password']) {
      let error;
      await transport.middleware({ method: 'POST', path, body: { password: 'ExamplePassword123!' } }, {}, e => { error = e; });
      assert.equal(error.status, 400, path);
    }
  }
});

test('expired, modified, wrong-route, wrong-key and mixed requests are rejected', async () => {
  let now = Date.now();
  const transport = createPasswordTransport('ab'.repeat(32), () => now);
  const body = { password: 'ExamplePassword123!' };
  const encrypted = await seal(transport, '/auth/reset', body);
  await assert.rejects(transport.open(encrypted, '/auth/login'), e => e.status === 400);
  await assert.rejects(createPasswordTransport('cd'.repeat(32)).open(encrypted, '/auth/reset'), e => e.status === 400);
  const parts = encrypted.split('.');
  parts[3] = (parts[3][0] === 'a' ? 'b' : 'a') + parts[3].slice(1);
  await assert.rejects(transport.open(parts.join('.'), '/auth/reset'), e => e.status === 400);
  await assert.rejects(transport.open(await seal(transport, '/auth/reset', body, { kid: 'wrong' }), '/auth/reset'), e => e.status === 400);
  let error;
  await transport.middleware({ method: 'POST', path: '/auth/reset', body: { encrypted_credentials: encrypted, password: 'Cleartext123!' } }, {}, e => { error = e; });
  assert.equal(error.status, 400);
  now += 120001;
  await assert.rejects(transport.open(encrypted, '/auth/reset'), e => e.status === 400);
});
