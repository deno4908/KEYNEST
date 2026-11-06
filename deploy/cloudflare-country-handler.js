// PAGE is embedded by scripts/build-country-worker.js; no origin fetch needed for blocked visitors.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const read = request.method === 'GET' || request.method === 'HEAD';
    if (read && url.pathname === '/api/region') {
      return new Response(request.method === 'HEAD' ? null : JSON.stringify({ allowed: request.cf?.country === 'VN' }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store',
          'X-Keynest-Region-Worker': 'vietnam-region-v6', 'X-Content-Type-Options': 'nosniff' },
      });
    }
    // These POST endpoints still authenticate provider signatures/tokens in Node.
    const webhook = request.method === 'POST' && ['/api/webhooks/pay2s', '/api/webhooks/sepay'].includes(url.pathname);
    if (webhook || request.cf?.country === 'VN') return fetch(request);
    // Visitors outside Vietnam see the region screen, including on public pages.
    // Legal pages remain readable; headers and User-Agent never bypass this check.
    const page = url.pathname.replace(/\/$/, '') || '/';
    if (read && page !== '/' && Object.hasOwn(PUBLIC_PAGES, page)) {
      return new Response(request.method === 'HEAD' ? null : PUBLIC_PAGES[page], {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'private, no-store',
          'X-Keynest-Region-Worker': 'vietnam-region-v6',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
        },
      });
    }
    const headers = {
      'X-Keynest-Region-Worker': 'vietnam-region-v6',
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
