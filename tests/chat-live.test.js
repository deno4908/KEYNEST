import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as httpServer } from 'node:http';
import { WebSocket } from 'ws';
import { createChatLive } from '../server/chat-live.js';
import { SELLER_TERMS_VERSION } from '../shared/seller-terms.js';

process.env.NODE_ENV = 'test';
process.env.APP_MODE = 'demo';
process.env.APP_ORIGIN = 'http://127.0.0.1:5173';
const dir = mkdtempSync(join(tmpdir(), 'keynest-chat-live-'));
process.env.DEMO_DATA_PATH = join(dir, 'store.json');
const { createServer, store, chatLive } = await import('../server/index.js');
const origin = process.env.APP_ORIGIN;

function observe(ws) {
  const messages = [], listeners = new Set();
  ws.on('message', value => {
    const message = JSON.parse(value.toString());
    messages.push(message);
    for (const listener of listeners) listener();
  });
  return {
    ws, messages,
    wait(predicate, from = 0) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { listeners.delete(check); reject(new Error('Timed out waiting for socket event')); }, 4000);
        const check = () => {
          const found = messages.slice(from).find(predicate);
          if (found) { clearTimeout(timer); listeners.delete(check); resolve(found); }
        };
        listeners.add(check); check();
      });
    },
    async send(input) {
      const id = randomUUID();
      ws.send(JSON.stringify({ id, input }));
      return this.wait(message => message.id === id);
    },
  };
}
const ready = ws => new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
const denied = ws => new Promise((resolve, reject) => {
  ws.once('unexpected-response', (request, response) => { response.resume(); ws.terminate(); resolve(response.statusCode); });
  ws.on('error', () => {});
  ws.once('open', () => { ws.terminate(); reject(new Error('Unexpected upgrade')); });
});

test('real HTTP authentication and bidirectional order/support WebSocket delivery', async t => {
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const sockets = [];
  t.after(async () => {
    for (const stream of sockets) stream.ws.terminate();
    chatLive.close();
    await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });
  async function request(path, body, cookie = '', requestOrigin = origin) {
    const response = await fetch(`${base}/api${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Origin: requestOrigin, 'X-App-Request': 'keynest', 'Content-Type': 'application/json', Cookie: cookie },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json(),
      cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
  }
  const login = email => request('/auth/login', { email, password: email.startsWith('admin@') ? 'Admin123!' : email.startsWith('student@') ? 'Student123!' : 'Seller123!' });
  const buyer = store.db.users.find(user => user.email === 'student@keynest.local');
  const seller = store.register('live-seller@example.test', 'Seller123!', 'Live seller');
  store.updateProfile(seller.id, { role: 'seller', seller_terms_version: SELLER_TERMS_VERSION });
  const outsider = store.register('live-outsider@example.test', 'Seller123!', 'Other customer');
  const buyerSession = await login(buyer.email), sellerSession = await login(seller.email),
    outsiderSession = await login(outsider.email), adminSession = await login('admin@keynest.local');
  const itemId = randomUUID(), otherItem = randomUUID(), orderId = randomUUID();
  const order = { id: orderId, number: 'LIVE-ORDER', user_id: buyer.id, status: 'processing',
    paid_at: new Date().toISOString(), created_at: new Date().toISOString(), total: 100000, subtotal: 100000,
    items: [{ id: itemId, seller_id: seller.id, seller_name: seller.name, name: 'Live product', variant_name: 'Test', price: 100000, quantity: 1 }] };
  store.db.orders.push(order, { ...order, id: randomUUID(), items: [{ ...order.items[0], id: otherItem }] });
  store.save();
  const issue = (topic, cookie) => request('/chat/live-ticket', { topic }, cookie);
  const connect = async (topic, cookie) => {
    const ticket = await issue(topic, cookie);
    assert.equal(ticket.status, 200);
    const stream = observe(new WebSocket(`${base.replace('http:', 'ws:')}/api/chat/live`,
      ['keynest-chat', `ticket.${ticket.data.ticket}`], { origin }));
    sockets.push(stream);
    await ready(stream.ws);
    await stream.wait(message => message.type === 'snapshot');
    return stream;
  };
  await t.test('unauthenticated, foreign-origin and unrelated conversation access fail', async () => {
    assert.equal((await issue(`order:${itemId}`, '')).status, 401);
    assert.equal((await request('/chat/live-ticket', { topic: `order:${itemId}` }, buyerSession.cookie, 'https://evil.test')).status, 403);
    assert.equal((await issue(`order:${itemId}`, outsiderSession.cookie)).status, 403);
    assert.equal((await issue('seller-support', buyerSession.cookie)).status, 403);
    assert.equal((await issue('order:invalid', buyerSession.cookie)).status, 400);
    assert.equal(await denied(new WebSocket(`${base.replace('http:', 'ws:')}/api/chat/live`, ['keynest-chat'], { origin })), 401);
  });
  const buyerStream = await connect(`order:${itemId}`, buyerSession.cookie);
  const sellerStream = await connect(`order:${itemId}`, sellerSession.cookie);
  const otherStream = await connect(`order:${otherItem}`, buyerSession.cookie);
  await t.test('tickets are single-use and upgrades check Origin independently', async () => {
    const ticket = await issue(`order:${itemId}`, buyerSession.cookie);
    const url = `${base.replace('http:', 'ws:')}/api/chat/live`;
    const protocols = ['keynest-chat', `ticket.${ticket.data.ticket}`];
    assert.equal(await denied(new WebSocket(url, protocols, { origin: 'https://evil.test' })), 403);
    const socket = new WebSocket(url, protocols, { origin });
    sockets.push({ ws: socket }); await ready(socket);
    assert.equal(await denied(new WebSocket(url, protocols, { origin })), 401);
    socket.terminate();
  });
  const first = { action: 'message', body: 'Buyer to seller over WebSocket', request_id: randomUUID() };
  await t.test('messages persist, reach both peers with their own permissions and stay in their room', async () => {
    assert.equal((await buyerStream.send(first)).type, 'result');
    const received = await sellerStream.wait(message => message.type === 'snapshot' && message.data.messages.some(row => row.body === first.body));
    assert.equal(received.data.viewer_role, 'seller');
    assert.equal(buyerStream.messages.at(-2).data.viewer_role, 'customer');
    assert.equal((await buyerStream.send(first)).type, 'result');
    assert.equal(store.db.seller_chat_messages.filter(message => message.request_id === first.request_id).length, 1);
    assert.equal((await sellerStream.send({ ...first, body: 'Seller replies immediately', request_id: randomUUID() })).type, 'result');
    await buyerStream.wait(message => message.type === 'snapshot' && message.data.messages.some(row => row.body === 'Seller replies immediately'));
    assert.ok(otherStream.messages.every(message => message.type !== 'snapshot' || message.data.messages.length === 0));
  });
  await t.test('admin observers stay read-only and malformed commands do not write', async () => {
    const admin = await connect(`order:${itemId}`, adminSession.cookie);
    assert.equal(admin.messages[0].data.can_message, false);
    const count = store.db.seller_chat_messages.length;
    assert.equal((await admin.send({ ...first, request_id: randomUUID() })).status, 403);
    assert.equal((await buyerStream.send({ action: 'message', body: 'x'.repeat(3001), request_id: randomUUID() })).status, 400);
    assert.equal(store.db.seller_chat_messages.length, count);
  });
  await t.test('HTTP writes still notify sockets and reconnect restores missed history', async () => {
    const response = await request(`/order-chat/${itemId}`, { ...first, body: 'Legacy HTTP client', request_id: randomUUID() }, buyerSession.cookie);
    assert.equal(response.status, 200);
    await sellerStream.wait(message => message.type === 'snapshot' && message.data.messages.some(row => row.body === 'Legacy HTTP client'));
    sellerStream.ws.terminate();
    await buyerStream.send({ ...first, body: 'Sent while seller offline', request_id: randomUUID() });
    const reconnected = await connect(`order:${itemId}`, sellerSession.cookie);
    assert.ok(reconnected.messages[0].data.messages.some(row => row.body === 'Sent while seller offline'));
  });
  await t.test('support conversations push both ways and never expose another customer tickets', async () => {
    const ticket = store.createTicket(buyer.id, { order_id: orderId, subject: 'Live support', message: 'Please help with order' });
    const customer = await connect('tickets', buyerSession.cookie);
    const merchant = await connect('seller-support', sellerSession.cookie);
    const unrelated = await connect('tickets', outsiderSession.cookie);
    assert.equal((await merchant.send({ id: ticket.id, body: 'Seller support answer' })).type, 'result');
    await customer.wait(message => message.type === 'snapshot' && message.data.some(row => row.messages.some(m => m.body === 'Seller support answer')));
    assert.equal((await customer.send({ id: ticket.id, body: 'Buyer support follow-up' })).type, 'result');
    await merchant.wait(message => message.type === 'snapshot' && message.data.some(row => row.messages.some(m => m.body === 'Buyer support follow-up')));
    assert.equal((await unrelated.send({ id: ticket.id, body: 'Try another customer ticket' })).status, 404);
    assert.ok(unrelated.messages.every(message => message.type !== 'snapshot' || message.data.length === 0));
  });
  await t.test('revoked sessions cannot receive later private messages or send new ones', async () => {
    const until = buyerStream.messages.length;
    for (const session of store.db.app_sessions) if (session.user_id === buyer.id) session.revoked_at = new Date().toISOString();
    const seller = await connect(`order:${itemId}`, sellerSession.cookie);
    await seller.send({ ...first, body: 'After buyer revocation', request_id: randomUUID() });
    await buyerStream.wait(message => message.type === 'error' && message.status === 401, until);
    assert.ok(!buyerStream.messages.slice(until).some(message => message.type === 'snapshot'));
    assert.equal((await issue(`order:${itemId}`, buyerSession.cookie)).status, 401);
  });
});

test('transport bounds writes, renews idle sessions, and does not poll data while idle', async t => {
  let reads = 0, writes = 0;
  const hub = createChatLive({ origin, authorize: async () => ({ id: 'test-user' }),
    load: async () => { reads++; return []; }, command: async () => { writes++; },
    writeLimit: 2, lifetimeMs: 2000, heartbeatMs: 50, ticketMs: 500 });
  const server = httpServer(); hub.attach(server); server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `ws://127.0.0.1:${server.address().port}/api/chat/live`;
  t.after(async () => { hub.close(); await new Promise(resolve => server.close(resolve)); });
  const ticket = await hub.issue('tickets', { id: 'test-user' }, {});
  const stream = observe(new WebSocket(url, ['keynest-chat', `ticket.${ticket.ticket}`], { origin }));
  await ready(stream.ws); await stream.wait(message => message.type === 'snapshot');
  const initialReads = reads;
  await new Promise(resolve => setTimeout(resolve, 125));
  assert.equal(reads, initialReads, 'heartbeats must not fetch conversations');
  await stream.send({ body: 'first' }); await stream.send({ body: 'second' });
  assert.equal((await stream.send({ body: 'third' })).status, 429);
  assert.equal(writes, 2);
  const closeCode = await new Promise(resolve => stream.ws.once('close', resolve));
  assert.equal(closeCode, 4000);
  const expired = await hub.issue('tickets', { id: 'test-user' }, {});
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(await denied(new WebSocket(url, ['keynest-chat', `ticket.${expired.ticket}`], { origin })), 401);
});
