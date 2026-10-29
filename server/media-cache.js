import { mkdir, readFile, readdir, stat, unlink, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Only public, immutable UUID.webp images belong here. Never cache order secrets.
export function createMediaCache({ directory, load, maxBytes = 256 * 1024 * 1024, warn = console.warn }) {
  const pending = new Map();
  let writes = Promise.resolve(), warned = false;
  const cacheError = () => {
    if (!warned) { warned = true; warn('Media disk cache unavailable; serving images from Storage.'); }
  };
  async function save(file, buffer) {
    if (buffer.length > maxBytes) return;
    await mkdir(directory, { recursive: true });
    const entries = await Promise.all((await readdir(directory)).filter(name => name.endsWith('.webp')).map(async name => {
      const path = join(directory, name);
      try { const info = await stat(path); return { path, size: info.size, time: info.mtimeMs }; }
      catch (e) { if (e.code !== 'ENOENT') throw e; return null; }
    }));
    const files = entries.filter(Boolean).sort((a, b) => a.time - b.time);
    let bytes = files.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of files) {
      if (bytes + buffer.length <= maxBytes) break;
      await unlink(entry.path).catch(e => { if (e.code !== 'ENOENT') throw e; });
      bytes -= entry.size;
    }
    const temporary = join(directory, `${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, buffer, { flag: 'wx' });
      await rename(temporary, join(directory, file));
    } finally { await unlink(temporary).catch(() => {}); }
  }
  return function get(file) {
    if (!/^[a-f0-9-]{36}\.webp$/.test(file)) return Promise.reject(new Error('Invalid media cache key'));
    if (pending.has(file)) return pending.get(file);
    const result = (async () => {
      try { return await readFile(join(directory, file)); }
      catch (e) { if (e.code !== 'ENOENT') cacheError(); }
      const buffer = await load(file);
      // Serialize eviction/writes so concurrent images respect the disk budget.
      writes = writes.then(() => save(file, buffer)).catch(cacheError);
      await writes;
      return buffer;
    })().finally(() => pending.delete(file));
    pending.set(file, result);
    return result;
  };
}
