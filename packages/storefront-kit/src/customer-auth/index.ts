// Site-domain customer session (Shopify-headless-style code exchange).
//
// Server (Astro endpoints / Worker): createCustomerClient does the confidential
// code exchange + refresh and lends the header set the same-origin proxy
// attaches; sealSession/unsealSession persist the TokenBundle in the site's own
// HttpOnly cookie. Browser: createSessionAuthClient talks only to same-origin
// /api/auth/*. See docs/winery-store-requirements.md §7 for the flow.
export * from './authorization';
export * from './customer-client';
export * from './session-client';
export * from './session-seal';
export * from './token-bundle';
