import type { StorefrontApiConfig } from './config';

export interface AnonymousCustomerSession {
  status: 'anonymous';
}

export interface AuthenticatedCustomerSession {
  status: 'authenticated';
  customer: {
    id: string;
    firstName?: string;
    email?: string;
  };
}

export type CustomerSessionView = AnonymousCustomerSession | AuthenticatedCustomerSession;

export interface StorefrontAuthClient {
  createLoginUrl(returnTo: string): string;
  getSession(): Promise<CustomerSessionView>;
  logout(): Promise<CustomerSessionView>;
  refresh(): Promise<boolean>;
  startLogin(returnTo: string): void;
}

export interface StorefrontAuthClientOptions {
  fetcher?: typeof fetch;
}

export class StorefrontAuthError extends Error {
  readonly code?: string;
  readonly status?: number;

  constructor(message: string, options: { code?: string; status?: number } = {}) {
    super(message);
    this.name = 'StorefrontAuthError';
    this.code = options.code;
    this.status = options.status;
  }
}

export function createStorefrontAuthClient(
  config: StorefrontApiConfig,
  options: StorefrontAuthClientOptions = {},
): StorefrontAuthClient {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  // Credentialed auth calls MUST hit the platform origin directly: pg_pub_at /
  // pg_pub_rt are set on the platform host during the hosted OTP flow, so a
  // same-origin proxy never sees them and every session read comes back
  // anonymous.
  const requestBaseUrl = `${baseUrl}/auth`;
  const fetcher = options.fetcher ?? fetch;

  function createLoginUrl(returnTo: string) {
    const url = new URL(`${baseUrl}/auth/login`);
    url.searchParams.set('return_to', returnTo);
    url.searchParams.set('key', config.publishableKey);
    return url.toString();
  }

  function startLogin(returnTo: string) {
    window.location.assign(createLoginUrl(returnTo));
  }

  async function request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    headers.set('X-Publishable-Key', config.publishableKey);

    return fetcher(`${requestBaseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers,
    });
  }

  async function getSession() {
    return readSession({ retryExpiredToken: true });
  }

  async function readSession(options: { retryExpiredToken: boolean }) {
    const response = await request('/session');

    if (response.status === 401) {
      const body = await readJsonBody(response);
      if (isTokenExpired(body) && options.retryExpiredToken && (await refresh())) {
        return readSession({ retryExpiredToken: false });
      }
      throw toAuthError(response, body, 'Customer session is not available.');
    }

    const body = await readJsonBody(response);
    if (!response.ok) throw toAuthError(response, body, 'Customer session is not available.');

    return parseCustomerSessionView(body);
  }

  async function refresh() {
    const response = await request('/refresh', { method: 'POST' });
    if (response.status === 401) return false;
    if (!response.ok) {
      const body = await readJsonBody(response);
      throw toAuthError(response, body, 'Customer session could not be refreshed.');
    }
    return true;
  }

  async function logout() {
    const response = await request('/logout', { method: 'POST' });
    const body = await readJsonBody(response);
    if (!response.ok) throw toAuthError(response, body, 'Sign out failed.');
    return parseCustomerSessionView(body);
  }

  return {
    createLoginUrl,
    getSession,
    logout,
    refresh,
    startLogin,
  };
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '');
}

async function readJsonBody(response: Response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function parseCustomerSessionView(value: unknown): CustomerSessionView {
  const record = asRecord(value);
  if (record?.status === 'anonymous') return { status: 'anonymous' };

  if (record?.status === 'authenticated') {
    const customer = asRecord(record.customer);
    const id = getString(customer, 'id');
    if (!id) throw invalidSessionError();

    const firstName = getString(customer, 'firstName');
    const email = getString(customer, 'email');

    return {
      status: 'authenticated',
      customer: {
        id,
        ...(firstName ? { firstName } : {}),
        ...(email ? { email } : {}),
      },
    };
  }

  throw invalidSessionError();
}

function isTokenExpired(value: unknown) {
  return getString(asRecord(value), 'error') === 'token_expired';
}

function toAuthError(response: Response, body: unknown, fallbackMessage: string) {
  const record = asRecord(body);
  const error = asRecord(record?.error);
  const message =
    getString(error, 'message') ??
    getString(record, 'message') ??
    getString(record, 'error') ??
    fallbackMessage;
  const code = getString(error, 'code') ?? getString(record, 'code') ?? getString(record, 'error');

  return new StorefrontAuthError(message, {
    code: code ?? undefined,
    status: response.status,
  });
}

function invalidSessionError() {
  return new StorefrontAuthError('Storefront API returned an unexpected auth session response.');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getString(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return typeof value === 'string' ? value : null;
}
