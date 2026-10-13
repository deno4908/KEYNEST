import test from 'node:test';
import assert from 'node:assert/strict';
import { CompactEncrypt, importJWK } from 'jose';
import { createPasswordTransport } from '../server/password-transport.js';

async function seal(transport, path, body, header = {}) {
  const { jwk, kid, timestamp } = transport.publicKey();
  return new CompactEncrypt(new TextEncoder().encode(JSON.stringify({ path, body, iat: timestamp })))
    .setProtectedHeader({ alg: 'ECDH-ES', enc: 'A256GCM', typ: 'keynest-password+jwe', kid, ...header })
    .encrypt(await importJWK(jwk, 'ECDH-ES'));
}

test('password requests use randomized JWE, survive replicas and contain no cleartext passwords', async () => {
  const transport = createPasswordTransport('ab'.repeat(32));
  const replica = createPasswordTransport('ab'.repeat(32));
  const body = { email: 'demo@example.test', password: 'ExamplePassword123!' };
  const first = await seal(transport, '/auth/login', body), second = await seal(transport, '/auth/login', body);
  assert.notEqual(first, second);
  assert.equal(first.includes(body.password), false);
  assert.equal('d' in transport.publicKey().jwk, false);
  assert.deepEqual(await replica.open(first, '/auth/login'), body);
  const unicode = { password: '密'.repeat(128), current_password: 'OldPassword123!', password_confirmation: '密'.repeat(128) };
  assert.deepEqual(await replica.open(await seal(transport,'/me/password',unicode), '/me/password'), unicode);
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
