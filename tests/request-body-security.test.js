import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib';

process.env.NODE_ENV = 'test';
process.env.APP_MODE = 'demo';
process.env.APP_ORIGIN = 'http://127.0.0.1:5173';
process.env.KAFKA_ENABLED = 'false';
process.env.REDIS_ENABLED = 'false';
process.env.TRUST_PROXY = '0';
const directory = mkdtempSync(join(tmpdir(), 'keynest-body-security-'));
process.env.DEMO_DATA_PATH = join(directory, 'store.json');
const { app, store } = await import('../server/index.js');

test('real API rejects compressed JSON/images and oversized bodies; health and ordinary login still work', async t => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Origin: process.env.APP_ORIGIN, 'X-App-Request': 'keynest', 'Content-Type': 'application/json' };
  for (const [encoding, compress] of [['gzip', gzipSync], ['deflate', deflateSync], ['br', brotliCompressSync]]) {
    const response = await fetch(base + '/api/auth/login', { method: 'POST',
      headers: { ...headers, 'Content-Encoding': encoding },
      body: Buffer.concat([compress(Buffer.from('{}')), Buffer.from('trailing-bytes')]),
    });
    assert.equal(response.status, 415, encoding);
    assert.equal((await response.json()).code, 'UNSUPPORTED_ENCODING');
    assert.equal((await fetch(base + '/api/health')).status, 200);
  }
  assert.equal((await fetch(base + '/api/auth/login', { method: 'POST', headers,
    body: JSON.stringify({ padding: 'x'.repeat(110 * 1024) }),
  })).status, 413);
  assert.equal((await fetch(base + '/api/auth/login', { method: 'POST', headers, body: '{invalid' })).status, 400);
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers,
    body: JSON.stringify({ email: 'student@keynest.local', password: 'Student123!' }),
  });
  assert.equal(login.status, 200);
  const Cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const image = await fetch(base + '/api/me/avatar', { method: 'POST',
    headers: { ...headers, Cookie, 'Content-Type': 'image/png', 'Content-Encoding': 'gzip' },
    body: gzipSync(Buffer.from('image')),
  });
  assert.equal(image.status, 415);
  assert.equal((await image.json()).code, 'UNSUPPORTED_ENCODING');
  const before = JSON.stringify(store.db.carts);
  const oversizedCollection = await fetch(base + '/api/cart', { method: 'PUT', headers: { ...headers, Cookie },
    body: JSON.stringify({ user_id: '00000000-0000-4000-8000-000000000001', items: Array.from({ length: 100 }, () => ({})) }),
  });
  assert.equal(oversizedCollection.status, 400);
  assert.equal(JSON.stringify(store.db.carts), before);
  // Exercise the mounted application policy, not just the policy fixture.
  const topup = () => fetch(base + '/api/wallet/topup', { method: 'POST',
    headers: { ...headers, Cookie }, body: '{"amount":0}',
  });
  for (let i = 0; i < 10; i++) assert.equal((await topup()).status, 400);
  const blocked = await topup();
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).code, 'RATE_LIMITED');
  assert.ok(Number(blocked.headers.get('Retry-After')) > 0);
  assert.equal((await fetch(base + '/api/health')).status, 200);
});
