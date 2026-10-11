const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function socialMetadata(path, origin, store) {
  const base = new URL(origin).origin;
  let title = 'KEYNEST — Game key, gift card & MMO';
  let description = 'Khám phá game key, gift card, nạp game và dịch vụ MMO tại KEYNEST.';
  let image = '/images/share/keynest-v2.jpg';
  let canonical = '/';
  const match = /^\/products\/([a-z0-9-]{1,120})\/?$/.exec(path);
  if (match) {
    const product = await store.product(match[1]);
    if (!product || product.active === false) return null;
    title = `${product.name} | KEYNEST`;
    description = String(product.description || description).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').slice(0, 220);
    canonical = `/products/${encodeURIComponent(product.slug)}`;
    if (product.image) {
      const candidate = new URL(product.image, base);
      if (['https:', 'http:'].includes(candidate.protocol) && !candidate.username && !candidate.password) image = candidate.href;
      if (/^\/images\/products\/[a-z0-9-]+\.svg$/.test(product.image)) image = product.image.replace('/products/', '/share/').replace('.svg', '.png');
    }
  }
  return { title, description, image: new URL(image, base).href, url: base + canonical,
    ...(image === '/images/share/keynest-v2.jpg' ? { imageWidth: 1200, imageHeight: 630 } : {}) };
}
export function metadataHead(meta) {
  const tag = (key, value, kind = 'property') => `<meta ${kind}="${key}" content="${escape(value)}">`;
  return `<title>${escape(meta.title)}</title>\n` + [
    tag('description', meta.description, 'name'), tag('og:type', 'website'), tag('og:site_name', 'KEYNEST'),
    tag('og:locale', 'vi_VN'), tag('og:title', meta.title), tag('og:description', meta.description),
    tag('og:url', meta.url), tag('og:image', meta.image), tag('og:image:alt', meta.title),
    ...(meta.image.startsWith('https://') ? [tag('og:image:secure_url', meta.image)] : []),
    ...(meta.imageWidth && meta.imageHeight ? [tag('og:image:width', meta.imageWidth), tag('og:image:height', meta.imageHeight)] : []),
    ...(/\.(jpg|jpeg|png|webp)(?:\?|$)/i.test(meta.image) ? [tag('og:image:type', `image/${/\.jpe?g(?:\?|$)/i.test(meta.image) ? 'jpeg' : /\.png(?:\?|$)/i.test(meta.image) ? 'png' : 'webp'}`)] : []),
    tag('twitter:card', 'summary_large_image', 'name'), tag('twitter:title', meta.title, 'name'),
    tag('twitter:description', meta.description, 'name'), tag('twitter:image', meta.image, 'name'),
    `<link rel="canonical" href="${escape(meta.url)}">`,
  ].join('\n');
}
export function injectMetadata(html, meta) {
  return html.replace(/<title>[\s\S]*?<\/title>/i, '').replace(/<meta\s+name="description"[\s\S]*?>/i, '').replace('</head>', `${metadataHead(meta)}\n</head>`);
}
