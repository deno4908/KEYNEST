// PAGE is embedded by scripts/build-country-worker.js; no origin fetch needed for blocked visitors.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const read = request.method === 'GET' || request.method === 'HEAD';
    // Crawlers may fetch robots.txt before requesting a social preview.
    if (read && url.pathname === '/robots.txt') {
      return new Response(request.method === 'HEAD' ? null : 'User-agent: *\nAllow: /\nDisallow: /api/\nAllow: /api/media/\nDisallow: /admin\nDisallow: /account\nDisallow: /orders\nDisallow: /wallet\n', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Keynest-Region-Worker': 'social-preview-v2' },
      });
    }
    // These POST endpoints still authenticate provider signatures/tokens in Node.
    const webhook = request.method === 'POST' && ['/api/webhooks/pay2s', '/api/webhooks/sepay'].includes(url.pathname);
    if (webhook || request.cf?.country === 'VN') return fetch(request);
    // User-Agent is only a preview hint, never authentication. Foreign visitors
    // matching it receive metadata only, not the application or customer APIs.
    const previewBot = /facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Discordbot|TelegramBot|WhatsApp|Zalo/i.test(request.headers.get('User-Agent') || '');
    if (read && previewBot && (url.pathname === '/' || /^\/products\/[a-z0-9-]{1,120}\/?$/.test(url.pathname))) {
      url.pathname = url.pathname === '/' ? '/share-preview' : '/share-preview' + url.pathname.replace(/\/$/, '');
      url.search = '';
      const response = await fetch(new Request(url, { method: request.method, headers: { Accept: 'text/html' } }));
      const preview = new Response(response.body, response);
      preview.headers.set('X-Keynest-Region-Worker', 'social-preview-v2');
      preview.headers.set('Cache-Control', 'private, no-store');
      return preview;
    }
    // Only public product/share images, not arbitrary API paths or user data.
    const publicImage = /^\/images\/(share|products)\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|svg)$/.test(url.pathname)
      || /^\/api\/media\/[a-zA-Z0-9_-]+\.webp$/.test(url.pathname);
    if (read && publicImage) return fetch(request);
    // Public information must be readable by everyone, not only named crawlers.
    // No authentication, account, checkout or payment API is exempted here.
    const publicPage = ['/', '/privacy', '/privacy/', '/terms', '/terms/'].includes(url.pathname);
    const publicData = ['/api/config', '/api/products', '/api/categories', '/api/banners', '/api/promotions', '/api/announcements'].includes(url.pathname);
    const publicAsset = /^\/assets\/[a-zA-Z0-9_.-]+\.(js|css|woff2?|png|jpg|webp|svg)$/.test(url.pathname);
    if (read && (publicPage || publicData || publicAsset)) return fetch(request);
    const headers = {
      'X-Keynest-Region-Worker': 'social-preview-v2',
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
