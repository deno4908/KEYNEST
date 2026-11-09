import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { AppError } from './security.js';

export const chatTopic = z.union([
  z.literal('seller-support'), z.literal('tickets'),
  z.string().regex(/^order:[0-9a-f-]{36}$/).refine(value => z.uuid().safeParse(value.slice(6)).success),
]);
const frame = z.object({ id: z.uuid(), input: z.unknown() }).strict();

// One Node process owns the live connections. Idle sockets never query the DB.
// Every delivery and command revalidates the original authenticated session.
export function createChatLive({ origin, authorize, load, command,
  lifetimeMs = 300000, heartbeatMs = 25000, ticketMs = 30000,
  maxClients = 500, maxPerUser = 6, writeLimit = 20,
}) {
  const tickets = new Map(), clients = new Set(), budgets = new Map();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16384,
    perMessageDeflate: false, handleProtocols: () => 'keynest-chat' });
  const count = uid => [...clients].filter(client => client.uid === uid).length;
  const prune = () => {
    for (const [key, value] of tickets) if (value.expires <= Date.now()) tickets.delete(key);
    for (const [key, value] of budgets) if (value.until <= Date.now()) budgets.delete(key);
  };
  const spend = (uid, kind, limit, windowMs) => {
    const key = `${uid}:${kind}`;
    let budget = budgets.get(key);
    if (!budget || budget.until <= Date.now()) budgets.set(key, budget = { used: 0, until: Date.now() + windowMs });
    if (++budget.used > limit) throw new AppError('Bạn thao tác quá nhanh. Vui lòng thử lại sau.', 429);
  };
  const send = (client, value) => {
    if (client.ws.readyState !== WebSocket.OPEN) return;
    if (client.ws.bufferedAmount > 1024 * 1024) return client.ws.close(1013, 'Slow connection');
    client.ws.send(JSON.stringify(value));
  };
  const report = (client, error, id) => {
    send(client, { type: 'error', id, status: error instanceof z.ZodError ? 400 : error.status || 500,
      error: error instanceof AppError ? error.message : error instanceof z.ZodError ? 'Tin nhắn không hợp lệ.' : 'Không thể cập nhật cuộc trò chuyện.' });
    if ([401, 403, 404].includes(error.status)) client.ws.close(4001, 'Access changed');
  };
  const enqueue = (client, work, id) => {
    if (++client.queued > 8) { client.queued--; client.ws.close(1008, 'Too many requests'); return; }
    client.queue = client.queue.then(async () => {
      if (client.ws.readyState !== WebSocket.OPEN) return;
      await work();
    }).catch(error => report(client, error, id)).finally(() => { client.queued--; });
  };
  const userFor = async client => {
    const user = await authorize(client.context);
    if (user.id !== client.uid) throw new AppError('Phiên đăng nhập đã thay đổi.', 401);
    return user;
  };
  const refresh = client => {
    if (client.refreshing) { client.dirty = true; return; }
    client.refreshing = true;
    enqueue(client, async () => {
      try {
        const user = await userFor(client);
        send(client, { type: 'snapshot', data: await load(client.topic, user) });
      } finally {
        client.refreshing = false;
        if (client.dirty) { client.dirty = false; refresh(client); }
      }
    });
  };
  const invalidate = (topic, except) => {
    for (const client of clients) {
      if (client === except) continue;
      // Support lists are always loaded for their own verified user; never send
      // another participant's response (viewer permissions differ).
      if (!topic || client.topic === topic || (topic === 'support' && !client.topic.startsWith('order:'))) refresh(client);
    }
  };
  wss.on('connection', (ws, request, ticket) => {
    const client = { ws, ...ticket, queued: 0, queue: Promise.resolve(), alive: true };
    clients.add(client);
    const expiry = setTimeout(() => ws.close(4000, 'Renew session'), lifetimeMs);
    expiry.unref?.();
    ws.on('error', () => ws.terminate());
    ws.on('pong', () => { client.alive = true; });
    ws.on('close', () => { clearTimeout(expiry); clients.delete(client); });
    ws.on('message', (bytes, binary) => {
      let message;
      try {
        spend(client.uid, 'frames', 60, 60000);
        if (binary) throw new AppError('Tin nhắn không hợp lệ.', 400);
        message = frame.parse(JSON.parse(bytes.toString()));
      } catch (error) {
        report(client, error instanceof AppError ? error : new AppError('Tin nhắn không hợp lệ.', 400));
        if (error.status === 429) ws.close(1008, 'Rate limited');
        return;
      }
      enqueue(client, async () => {
        spend(client.uid, 'writes', writeLimit, 60000);
        if (!client.topic.startsWith('order:')) spend(client.uid, 'support-writes', 15, 900000);
        const user = await userFor(client);
        await command(client.topic, user, message.input);
        // Notify peers even if the sender's subsequent snapshot read fails.
        invalidate(client.topic.startsWith('order:') ? client.topic : 'support', client);
        if (client.topic.startsWith('order:')) invalidate('support');
        // Persist before acknowledgement. A disconnect never triggers an automatic resend.
        send(client, { type: 'snapshot', data: await load(client.topic, user) });
        send(client, { type: 'result', id: message.id });
      }, message.id);
    });
    refresh(client); // Also supplies missed messages after reconnect.
  });
  const heartbeat = setInterval(() => {
    prune();
    for (const client of clients) {
      if (!client.alive) { client.ws.terminate(); continue; }
      client.alive = false;
      client.ws.ping();
    }
  }, heartbeatMs);
  heartbeat.unref?.();
  return {
    async issue(topic, user, context) {
      topic = chatTopic.parse(topic);
      prune();
      if (clients.size >= maxClients || count(user.id) >= maxPerUser || tickets.size >= 1000)
        throw new AppError('Có quá nhiều kết nối chat. Hãy đóng bớt cửa sổ rồi thử lại.', 429);
      spend(user.id, 'tickets', 30, 60000);
      await load(topic, user); // Verify topic ownership before issuing a one-use ticket.
      const token = randomBytes(32).toString('base64url');
      tickets.set(token, { topic, uid: user.id, context, expires: Date.now() + ticketMs });
      return { ticket: token };
    },
    invalidate,
    attach(server) {
      const upgrade = async (request, socket, head) => {
        const reject = status => { if (!socket.destroyed) socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
        socket.on('error', () => {});
        if (request.url !== '/api/chat/live' || request.headers.origin !== origin) return reject('403 Forbidden');
        const protocols = (request.headers['sec-websocket-protocol'] || '').split(',').map(value => value.trim());
        const token = protocols.find(value => /^ticket\.[A-Za-z0-9_-]{43}$/.test(value))?.slice(7);
        const ticket = tickets.get(token);
        if (token) tickets.delete(token);
        if (!protocols.includes('keynest-chat') || !ticket || ticket.expires <= Date.now()) return reject('401 Unauthorized');
        if (clients.size >= maxClients || count(ticket.uid) >= maxPerUser) return reject('429 Too Many Requests');
        try {
          const user = await authorize(ticket.context);
          if (user.id !== ticket.uid) return reject('401 Unauthorized');
          if (socket.destroyed) return;
          // Recheck after asynchronous authentication to bound simultaneous upgrades.
          if (clients.size >= maxClients || count(ticket.uid) >= maxPerUser) return reject('429 Too Many Requests');
          wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request, ticket));
        } catch { reject('401 Unauthorized'); }
      };
      server.on('upgrade', upgrade);
      server.once('close', () => { server.off('upgrade', upgrade); this.close(); });
    },
    close() {
      clearInterval(heartbeat);
      tickets.clear(); budgets.clear();
      for (const client of clients) client.ws.terminate();
      clients.clear();
      wss.close();
    },
  };
}
