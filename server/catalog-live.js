// One public catalog feed per Node process, shared by all connected browsers.
export function createCatalogLive(load, { intervalMs = 10000, heartbeatMs = 15000, version, revalidateMs = 300000 } = {}) {
  const clients = new Set();
  let snapshot = "", timer, heartbeat, running, pending = false, revision, loadedAt = 0, checkedAt = 0;
  const send = (client, message) => {
    if (client.destroyed || client.writableEnded) return;
    if (client.writableLength > 1024 * 1024) return client.end();
    client.write(message);
  };
  const broadcast = message => { for (const client of clients) send(client, message); };
  // Mutations force a fresh load; timer polls normally transfer only a fingerprint.
  const refresh = ({ force = true } = {}) => {
    if (!clients.size) return Promise.resolve();
    if (running) { pending ||= force; return running; }
    running = Promise.resolve().then(async () => {
      const nextRevision = version ? await version() : null;
      if (!force && snapshot && nextRevision !== null && nextRevision === revision && Date.now() - loadedAt < revalidateMs) {
        checkedAt = Date.now();
        return;
      }
      const rows = await load();
      const next = JSON.stringify(rows);
      revision = nextRevision;
      loadedAt = checkedAt = Date.now();
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
        timer = setInterval(() => void refresh({ force: false }), intervalMs);
        heartbeat = setInterval(() => broadcast(': keepalive\n\n'), heartbeatMs);
        timer.unref?.(); heartbeat.unref?.();
      }
      // Additional tabs share the current snapshot instead of re-reading Supabase.
      if (!snapshot || Date.now() - checkedAt >= intervalMs) void refresh({ force: false });
    },
    close() { stop(); for (const client of clients) client.end(); clients.clear(); },
  };
}
