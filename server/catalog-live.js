// One public catalog feed per Node process, shared by all connected browsers.
export function createCatalogLive(load, { intervalMs = 2000, heartbeatMs = 15000 } = {}) {
  const clients = new Set();
  let snapshot = "", timer, heartbeat, running, pending = false;
  const send = (client, message) => {
    if (client.destroyed || client.writableEnded) return;
    if (client.writableLength > 1024 * 1024) return client.end();
    client.write(message);
  };
  const broadcast = message => { for (const client of clients) send(client, message); };
  const refresh = () => {
    if (!clients.size) return Promise.resolve();
    if (running) { pending = true; return running; }
    running = Promise.resolve().then(load).then(rows => {
      const next = JSON.stringify(rows);
      if (next !== snapshot) {
        snapshot = next;
        broadcast(`data: ${snapshot}\n\n`);
      }
    }).catch(() => {
      broadcast('event: catalog-unavailable\ndata: {}\n\n');
    }).finally(() => {
      running = null;
      if (pending) { pending = false; void refresh(); }
    });
    return running;
  };
  const stop = () => { clearInterval(timer); clearInterval(heartbeat); timer = heartbeat = undefined; };
  return {
    refresh,
    subscribe(req, res) {
      res.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
      });
      if (req.method === 'HEAD') return res.end();
      res.flushHeaders();
      res.write('retry: 2000\n\n');
      clients.add(res);
      res.on('close', () => { clients.delete(res); if (!clients.size) stop(); });
      res.on('error', () => { clients.delete(res); res.destroy(); if (!clients.size) stop(); });
      if (snapshot) send(res, `data: ${snapshot}\n\n`);
      if (!timer) {
        timer = setInterval(() => void refresh(), intervalMs);
        heartbeat = setInterval(() => broadcast(': keepalive\n\n'), heartbeatMs);
        timer.unref?.(); heartbeat.unref?.();
      }
      void refresh();
    },
    close() { stop(); for (const client of clients) client.end(); clients.clear(); },
  };
}
