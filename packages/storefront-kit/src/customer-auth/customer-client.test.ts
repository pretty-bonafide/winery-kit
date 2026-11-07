import { describe, expect, it, vi } from 'vitest';
import { createCustomerClient } from './customer-client';

const CONFIG = {
  baseUrl: 'https://api.example.com/public/v1/',
  publishableKey: 'pgpk_live',
  secretKey: 'pgsk_secret',
};

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode(payload)}.sig`;
}

const ACCESS_TOKEN = jwt({ sub: 'cust_1', email: 'a@example.com', given_name: 'Ada' });
const TOKEN_RESPONSE = {
  accessToken: ACCESS_TOKEN,
  refreshToken: 'rt',
  expiresAtEpochMs: 1_000_000_060_000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function client(fetcher: typeof fetch) {
  return createCustomerClient(CONFIG, { fetcher });
}

describe('createCustomerClient', () => {
  it('normalizes the storefront base (no trailing slash)', () => {
    expect(client(vi.fn()).storefrontBaseUrl).toBe('https://api.example.com/public/v1');
  });

  it('getServerHeaders carries the secret key (no publishable) + optional customer token', () => {
    const c = client(vi.fn());
    expect(c.getServerHeaders()).toEqual({ Authorization: 'Bearer pgsk_secret' });
    expect(c.getServerHeaders({ customerToken: 'ct' })).toEqual({
      Authorization: 'Bearer pgsk_secret',
      'x-customer-token': 'ct',
    });
  });

  it('exchangeCode posts the authorizationCode grant with secret-only auth', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(TOKEN_RESPONSE));
    const bundle = await client(fetcher).exchangeCode({ code: 'the-code' });

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.example.com/public/v1/auth/token');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer pgsk_secret');
    expect(init.headers['X-Publishable-Key']).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ grantType: 'authorizationCode', code: 'the-code' });
    expect(bundle).toEqual({
      accessToken: ACCESS_TOKEN,
      refreshToken: 'rt',
      expiresAt: 1_000_000_060_000,
      customer: { id: 'cust_1', firstName: 'Ada', email: 'a@example.com' },
    });
  });

  it('refresh posts the refreshToken grant', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(TOKEN_RESPONSE));
    await client(fetcher).refresh({ refreshToken: 'old-rt' });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      grantType: 'refreshToken',
      refreshToken: 'old-rt',
    });
  });

  it('throws a StorefrontAuthError when the exchange is rejected', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ error: 'invalid_grant' }, 400));
    await expect(client(fetcher).exchangeCode({ code: 'bad' })).rejects.toMatchObject({
      name: 'StorefrontAuthError',
      code: 'invalid_grant',
      status: 400,
    });
  });

  it('throws when the token response cannot be understood', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ accessToken: 'opaque' }));
    await expect(client(fetcher).exchangeCode({ code: 'c' })).rejects.toMatchObject({
      code: 'malformed_token_response',
    });
  });

  it('throws a network_error when the fetch itself fails', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('down'));
    await expect(client(fetcher).refresh({ refreshToken: 'rt' })).rejects.toMatchObject({
      code: 'network_error',
    });
  });

  describe('fetchPurchaseContext', () => {
    it('short-circuits empty variation ids', async () => {
      const fetcher = vi.fn();
      expect(await client(fetcher).fetchPurchaseContext('at', [])).toEqual({
        availability: [],
        memberships: [],
        pricing: [],
      });
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('attaches x-customer-token and parses the context', async () => {
      const fetcher = vi
        .fn()
        .mockResolvedValue(jsonResponse({ pricing: [], availability: [], memberships: [] }));
      const result = await client(fetcher).fetchPurchaseContext('cust-token', ['var_1']);

      const [url, init] = fetcher.mock.calls[0];
      expect(url).toBe('https://api.example.com/public/v1/purchase-context');
      expect(init.headers.Authorization).toBe('Bearer pgsk_secret');
      expect(init.headers['x-customer-token']).toBe('cust-token');
      expect(JSON.parse(init.body)).toEqual({ variationIds: ['var_1'] });
      expect(result).toEqual({ availability: [], memberships: [], pricing: [] });
    });

    it('returns null on a non-ok response', async () => {
      const fetcher = vi.fn().mockResolvedValue(jsonResponse({}, 401));
      expect(await client(fetcher).fetchPurchaseContext('ct', ['var_1'])).toBeNull();
    });
  });
});
