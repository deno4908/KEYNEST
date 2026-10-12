// PAGE is embedded by scripts/build-country-worker.js; no origin fetch needed for blocked visitors.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const read = request.method === 'GET' || request.method === 'HEAD';
    // These POST endpoints still authenticate provider signatures/tokens in Node.
    const webhook = request.method === 'POST' && ['/api/webhooks/pay2s', '/api/webhooks/sepay'].includes(url.pathname);
    if (webhook || request.cf?.country === 'VN') return fetch(request);
    if (read && url.pathname === '/robots.txt') {
      return new Response(request.method === 'HEAD' ? null : 'User-agent: *\nAllow: /\nDisallow: /api/\nAllow: /api/media/\nDisallow: /account\nDisallow: /admin\nDisallow: /wallet\nDisallow: /orders\n', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Keynest-Region-Worker': 'vietnam-region-v5' },
      });
    }
    // User-Agent grants only public metadata, never access to the application.
    const previewBot = /facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Discordbot|TelegramBot|WhatsApp|Zalo/i.test(request.headers.get('User-Agent') || '');
    if (read && previewBot && (url.pathname === '/' || /^\/products\/[a-z0-9-]{1,120}\/?$/.test(url.pathname))) {
      url.pathname = url.pathname === '/' ? '/share-preview' : '/share-preview' + url.pathname.replace(/\/$/, '');
      url.search = '';
      const response = await fetch(new Request(url, { method: request.method, headers: { Accept: 'text/html' } }));
      const preview = new Response(request.method === 'HEAD' ? null : response.body, response);
      preview.headers.set('Cache-Control', 'private, no-store');
      preview.headers.set('X-Keynest-Region-Worker', 'vietnam-region-v5');
      return preview;
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
