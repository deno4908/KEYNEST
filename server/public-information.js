import { terms, privacy, LEGAL_VERSION, LEGAL_UPDATED_LABEL, legalSources } from '../shared/legal-content.js';
import { storeDescription, signInDescription } from '../shared/store-description.js';
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Same public copy as React, available before JavaScript or API requests load.
export function publicInformation(path) {
  const page = path.replace(/\/$/, '') || '/';
  if (!['/', '/privacy', '/terms'].includes(page)) return '';
  const links = '<nav class="legal-tabs"><a href="/">KEYNEST</a><a href="/privacy">Chính sách bảo mật</a><a href="/terms">Điều khoản dịch vụ</a></nav>';
  if (page === '/') return `<main class="container legal-page"><h1>KEYNEST — Cửa hàng sản phẩm số</h1><p>${escape(storeDescription)}</p><p>${escape(signInDescription)}</p>${links}</main>`;
  const title = page === '/privacy' ? 'Chính sách bảo mật' : 'Điều khoản dịch vụ';
  return `<main class="container legal-page">${links}<header class="legal-hero"><h1>${title}</h1><p>Cập nhật ngày ${LEGAL_UPDATED_LABEL} · Phiên bản ${LEGAL_VERSION}</p></header><article class="legal-document">${(page === '/privacy' ? privacy : terms).map(([heading, body], i) => `<section class="legal-section" id="policy-${i}"><span class="legal-section-number">${i + 1}</span><div><h2>${escape(heading)}</h2><p>${escape(body)}</p></div></section>`).join('')}<section><h2>Văn bản pháp luật tham khảo</h2><ul>${legalSources.map(([label, url]) => `<li><a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(label)}</a></li>`).join('')}</ul></section></article><a href="/support">Trung tâm hỗ trợ KEYNEST</a></main>`;
}
export function injectPublicInformation(html, path) {
  const content = publicInformation(path);
  return content ? html.replace('<div id="root"></div>', `<div id="root">${content}</div>`) : html;
}
