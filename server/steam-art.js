// Public Steam storefront feed; no API key or customer data is sent.
const feed = 'https://store.steampowered.com/api/featuredcategories/?cc=vn&l=english';
export function createSteamArt({ fetcher = fetch, now = Date.now } = {}) {
  let items = [], refreshAt = 0, pending;
  return async function getArt() {
    if (now() < refreshAt) return items;
    if (!pending) pending = (async () => {
      try {
        const response = await fetcher(feed, { signal: AbortSignal.timeout(4000) });
        if (!response.ok) throw new Error('Steam unavailable');
        const data = await response.json();
        const games = new Map();
        for (const group of ['top_sellers', 'new_releases', 'specials', 'coming_soon']) {
          for (const game of Array.isArray(data[group]?.items) ? data[group].items : []) {
            if (!Number.isSafeInteger(game.id) || game.id <= 0 || game.type !== 0 || typeof game.name !== 'string') continue;
            games.set(game.id, {
              name: game.name.slice(0, 200),
              src: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${game.id}/library_hero.jpg`,
            });
          }
        }
        if (!games.size) throw new Error('Empty Steam feed');
        items = [...games.values()].slice(0, 100);
        refreshAt = now() + 6 * 60 * 60 * 1000;
      } catch {
        // Keep the last good list and back off instead of hammering Steam.
        refreshAt = now() + 60000;
      } finally { pending = null; }
      return items;
    })();
    return pending;
  };
}
