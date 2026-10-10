// PAGE is embedded by scripts/build-country-worker.js; no origin fetch needed for blocked visitors.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    // These POST endpoints still authenticate provider signatures/tokens in Node.
    const webhook = request.method === 'POST' && ['/api/webhooks/pay2s', '/api/webhooks/sepay'].includes(url.pathname);
    if (webhook || request.cf?.country === 'VN') return fetch(request);
    const headers = {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    };
    const api = url.pathname === '/api' || url.pathname.startsWith('/api/');
    headers['Content-Type'] = api ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8';
    const body = api ? JSON.stringify({ code: 'REGION_RESTRICTED', error: 'KEYNEST hiện chỉ hoạt động tại Việt Nam.' }) : PAGE;
    return new Response(request.method === 'HEAD' ? null : body, { status: 403, headers });
  },
};
