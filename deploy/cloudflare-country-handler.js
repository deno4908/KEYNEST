// PAGE is embedded by scripts/build-country-worker.js; no origin fetch needed for blocked visitors.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const read = request.method === 'GET' || request.method === 'HEAD';
    // These POST endpoints still authenticate provider signatures/tokens in Node.
    const webhook = request.method === 'POST' && ['/api/webhooks/pay2s', '/api/webhooks/sepay'].includes(url.pathname);
    if (webhook || request.cf?.country === 'VN') return fetch(request);
    // Public browsing is global; account and transaction routes remain restricted.
    // Do not grant access based on a spoofable Googlebot User-Agent.
    const publicPage = ['/', '/catalog', '/guide', '/sitemap.xml', '/robots.txt'].includes(url.pathname.replace(/\/$/, '') || '/')
      || /^\/products\/[a-z0-9-]{1,120}\/?$/.test(url.pathname);
    const publicData = ['/api/config', '/api/products', '/api/catalog', '/api/categories', '/api/banners', '/api/promotions', '/api/announcements'].includes(url.pathname)
      || /^\/api\/products\/[a-zA-Z0-9-]+(?:\/(?:reviews|comments))?$/.test(url.pathname);
    const publicAsset = /^\/assets\/[a-zA-Z0-9_.-]+$/.test(url.pathname);
    if (read && (publicPage || publicData || publicAsset)) {
      const headers = new Headers(request.headers);
      headers.delete('Cookie');
      headers.delete('Authorization');
      return fetch(new Request(request, { headers }));
    }
    const publicImage = /^\/images\/(share|products)\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|svg)$/.test(url.pathname)
      || /^\/api\/media\/[a-zA-Z0-9_-]+\.webp$/.test(url.pathname);
    if (read && publicImage) {
      url.search = '';
      return fetch(new Request(url, { method: request.method }));
    }
    // Keep legal information available abroad, but show the region screen at the homepage.
    const page = url.pathname.replace(/\/$/, '') || '/';
    if (read && page !== '/' && Object.hasOwn(PUBLIC_PAGES, page)) {
      return new Response(request.method === 'HEAD' ? null : PUBLIC_PAGES[page], {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'private, no-store',
          'X-Keynest-Region-Worker': 'vietnam-region-v5',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
        },
      });
    }
    const headers = {
      'X-Keynest-Region-Worker': 'vietnam-region-v5',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    };
    const api = url.pathname === '/api' || url.pathname.startsWith('/api/');
    headers['Content-Type'] = api ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8';
    const body = api ? JSON.stringify({ code: 'REGION_RESTRICTED', error: 'KEYNEST hiện chỉ hoạt động tại Việt Nam.' }) : PAGE;
    return new Response(request.method === 'HEAD' ? null : body, { status: 403, headers });
  },
};
