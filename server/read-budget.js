// Only public display data may use this cache. Never put accounts, orders,
// inventory secrets, payment state or authorization decisions in it.
export function createPublicReadCache({ ttlMs = 10000, maxEntries = 64, maxBytes = 8 * 1024 * 1024, now = () => performance.now() } = {}) {
  const entries = new Map();
  let bytes = 0;
  const remove = key => {
    bytes -= entries.get(key)?.bytes || 0;
    entries.delete(key);
  };
  return {
    clear() { entries.clear(); bytes = 0; },
    async get(key, load) {
      const existing = entries.get(key);
      if (existing && (existing.pending || now() < existing.expires)) return existing.value;
      const entry = { pending: true, expires: 0, bytes: 0, value: null };
      entry.value = Promise.resolve().then(load).then(value => {
        entry.pending = false;
        entry.expires = now() + ttlMs;
        if (entries.get(key) === entry) {
          entry.bytes = Buffer.byteLength(JSON.stringify(value) ?? 'null');
          bytes += entry.bytes;
          while (bytes > maxBytes && entries.size) remove(entries.keys().next().value);
        }
        return value;
      }, error => {
        if (entries.get(key) === entry) remove(key);
        throw error;
      });
      remove(key);
      entries.set(key, entry);
      while (entries.size > maxEntries) remove(entries.keys().next().value);
      return entry.value;
    },
  };
}

// Share maintenance work, rather than running the same two RPCs for every
// storefront read. Critical stock checks can force a run; checkout/settlement
// also enforce expiration within their database transactions.
export function createMaintenanceBudget(run, { intervalMs = 30000, now = () => performance.now() } = {}) {
  let pending, completedAt = -Infinity;
  return ({ force = false } = {}) => {
    if (pending) return pending;
    if (!force && now() - completedAt < intervalMs) return Promise.resolve();
    pending = Promise.resolve().then(run).then(result => {
      completedAt = now();
      return result;
    }).finally(() => { pending = undefined; });
    return pending;
  };
}
