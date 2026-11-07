// Browser client for the same-origin session endpoints. It satisfies the same
// StorefrontAuthClient interface as createStorefrontAuthClient (the direct,
// cross-origin model), so a site swaps between them behind one flag while its UI
// code is unchanged. Every credentialed call is SAME-ORIGIN: the browser talks
// only to the site's own /api/auth/* endpoints, which hold the site-domain
// session cookie and reach the platform server-side. No publishable key, no
// cross-site cookie, no CORS.
import type { CustomerSessionView, StorefrontAuthClient } from '../storefront-api/auth';

export interface SessionAuthClientOptions {
  /** Same-origin base for the session endpoints, e.g. '/api/auth'. */
  basePath?: string;
  fetcher?: typeof fetch;
}

export function createSessionAuthClient(
  options: SessionAuthClientOptions = {},
): StorefrontAuthClient {
  const basePath = (options.basePath ?? '/api/auth').replace(/\/+$/, '');
  const fetcher = options.fetcher ?? fetch;

  function createLoginUrl(returnTo: string): string {
    const url = new URL(`${basePath}/login`, currentOrigin());
    url.searchParams.set('return_to', returnTo);
    return `${url.pathname}${url.search}`;
  }

  function startLogin(returnTo: string): void {
    window.location.assign(createLoginUrl(returnTo));
  }

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    const response = await fetcher(`${basePath}${path}`, {
      ...init,
      credentials: 'same-origin',
      headers,
    });
    if (!response.ok) return { status: 'anonymous' };
    return response.json().catch(() => ({ status: 'anonymous' }));
  }

  async function getSession(): Promise<CustomerSessionView> {
    return parseSessionView(await request('/session'));
  }

  async function logout(): Promise<CustomerSessionView> {
    return parseSessionView(await request('/logout', { method: 'POST' }));
  }

  async function refresh(): Promise<boolean> {
    // The /session endpoint refreshes the token server-side when it is near
    // expiry, so a browser-initiated refresh is just a re-read.
    return (await getSession()).status === 'authenticated';
  }

  return { createLoginUrl, getSession, logout, refresh, startLogin };
}

function currentOrigin(): string {
  return typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
}

function parseSessionView(value: unknown): CustomerSessionView {
  if (typeof value !== 'object' || value === null) return { status: 'anonymous' };
  const record = value as Record<string, unknown>;
  if (record.status !== 'authenticated') return { status: 'anonymous' };

  const customer =
    typeof record.customer === 'object' && record.customer !== null
      ? (record.customer as Record<string, unknown>)
      : null;
  const id = typeof customer?.id === 'string' ? customer.id : null;
  if (!id) return { status: 'anonymous' };

  const firstName = typeof customer?.firstName === 'string' ? customer.firstName : undefined;
  const email = typeof customer?.email === 'string' ? customer.email : undefined;
  return {
    status: 'authenticated',
    customer: { id, ...(firstName ? { firstName } : {}), ...(email ? { email } : {}) },
  };
}
