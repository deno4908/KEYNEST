import { LEGAL_VERSION } from '../../shared/legal-content.js';
export const accountLegal = { version: LEGAL_VERSION, terms: true, account_data: true };
export const orderLegal = { version: LEGAL_VERSION, terms: true };

// Business regression fixtures explicitly represent a user who has confirmed
// the new form. Consent rejection tests use raw fetch and never this helper.
export function withLegalConsent(path, body) {
  path = path.replace(/^\/api/, '');
  if (body && typeof body === 'object' && ['/auth/register', '/orders'].includes(path))
    return { legal: path === '/orders' ? orderLegal : accountLegal, ...body };
  return body;
}
