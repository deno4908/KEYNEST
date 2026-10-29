import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { EventEmitter } from 'node:events';
import { createCatalogLive } from '../server/catalog-live.js';

test('catalog SSE sends initial data, changed snapshots and errors without overlapping shared loads', async () => {
  let rows = [{ id: 'public-product', variants: [{ id: 'variant', stock: 1 }] }];
  let fail = false, active = 0, maximum = 0;
  const live = createCatalogLive(async () => {
    maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    if (fail) throw new Error('private database error');
    return rows;
  }, { intervalMs: 30, heartbeatMs: 40 });
  const app = express();
  app.get('/products', (req, res) => live.subscribe(req, res));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const controllers = [];
  async function connect() {
    const controller = new AbortController(); controllers.push(controller);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/products`, { signal: controller.signal });
    assert.match(response.headers.get('Content-Type'), /text\/event-stream/);
    assert.equal(response.headers.get('X-Accel-Buffering'), 'no');
    const reader = response.body.getReader();
    let buffer = '';
    return async needle => {
      while (!buffer.includes(needle)) {
        const result = await reader.read();
        assert.equal(result.done, false);
        buffer += new TextDecoder().decode(result.value);
      }
      const result = buffer; buffer = ''; return result;
    };
  }
  try {
    const [a,b] = await Promise.all([connect(),connect()]);
    assert.match(await a('data:'), /"stock":1/);
    assert.match(await b('data:'), /"stock":1/);
    rows = [{ id: 'public-product', variants: [{ id: 'variant', stock: 0 }] }];
    await Promise.all([live.refresh(),live.refresh()]);
    assert.match(await a('"stock":0'), /"stock":0/);
    assert.match(await b('"stock":0'), /"stock":0/);
    fail = true;
    await live.refresh();
    const unavailable = await a('catalog-unavailable');
    assert.ok(!unavailable.includes('private database error'));
    assert.equal(maximum, 1);
  } finally {
    controllers.forEach(controller => controller.abort());
    live.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('unchanged catalog polls and additional tabs reuse data, but revisions and forced mutations reload', async () => {
  let revision = 'first', loads = 0, stock = 2;
  const live = createCatalogLive(async () => { loads++; return [{ stock }]; }, {
    version: async () => revision, intervalMs: 60000,
  });
  function subscribe() {
    const response = new EventEmitter();
    response.set = response.flushHeaders = () => {};
    response.output = '';
    response.write = text => { response.output += text; };
    response.end = () => response.emit('close');
    live.subscribe({ method: 'GET' }, response);
    return response;
  }
  try {
    const a = subscribe();
    await live.refresh({ force: false });
    assert.equal(loads, 1);
    const b = subscribe();
    for (let n = 0; n < 20; n++) await live.refresh({ force: false });
    assert.equal(loads, 1, 'only fingerprints transfer while the catalog is unchanged');
    assert.match(b.output, /"stock":2/);
    stock = 0; revision = 'second';
    await live.refresh({ force: false });
    assert.equal(loads, 2);
    assert.match(a.output, /"stock":0/);
    assert.match(b.output, /"stock":0/);
    stock = 1; // A successful local mutation bypasses an unchanged fingerprint.
    await live.refresh();
    assert.equal(loads, 3);
    assert.match(a.output, /"stock":1/);
    a.end(); b.end();
    await live.refresh();
    assert.equal(loads, 3, 'no Supabase reads without connected clients');
  } finally { live.close(); }
});

test('missing version RPC falls back to fresh full reads instead of freezing stock', async () => {
  let loads = 0;
  const live = createCatalogLive(async () => [{ stock: ++loads }], { version: async () => null });
  const res = new EventEmitter();
  res.set = res.flushHeaders = res.write = () => {};
  res.end = () => res.emit('close');
  try {
    live.subscribe({ method: 'GET' }, res);
    await live.refresh({ force: false });
    await live.refresh({ force: false });
    assert.equal(loads, 2);
  } finally { live.close(); }
});
