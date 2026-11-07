// Imperative shell: the SERVER-side confidential client for the code-exchange
// flow. It runs only in the site's Astro server/Worker (never the browser),
// where the `pgsk` secret key lives. It turns an authorization code into a
// TokenBundle, refreshes it, and lends the exact header set the site's
// same-origin proxy must attach when forwarding credentialed customer-context
// reads (so the header contract has one owner). Pure protocol shaping lives in
// authorization.ts / token-bundle.ts; this file only does fetch.
import { StorefrontAuthError } from '../storefront-api/auth';
import {
  type CustomerPurchaseContext,
  parsePurchaseContextResponse,
} from '../storefront-api/customer-context';
import {
  buildAuthorizationCodeBody,
  buildAuthorizationUrl,
  buildRefreshTokenBody,
  parseTokenResponse,
} from './authorization';
import type { TokenBundle } from './token-bundle';

export interface CustomerClientConfig {
  /** Public storefront API base, e.g. https://host/api/public/v1 */
  baseUrl: string;
  publishableKey: string;
  /** The `pgsk` secret key — server-only; authenticates server-to-server calls. */
  secretKey: string;
}

export interface CustomerClientOptions {
  fetcher?: typeof fetch;
}

export interface CustomerClient {
  /** Normalized storefront API base (no trailing slash) — for the proxy target. */
  readonly storefrontBaseUrl: string;
  getAuthorizationUrl(input: { callbackUrl: string }): string;
  exchangeCode(input: { code: string }): Promise<TokenBundle>;
  refresh(input: { refreshToken: string }): Promise<TokenBundle>;
  /**
   * Headers the site's server sends on every storefront call: the secret key
   * (Bearer) authenticates the server and bypasses the origin allowlist;
   * `x-customer-token` (when a session is present) scopes the read to the
   * signed-in customer. The publishable key is intentionally omitted — `/auth/token`
   * rejects it (401 secret_key_required), and data routes accept the secret key.
   */
  getServerHeaders(options?: { customerToken?: string }): Record<string, string>;
  /** Server-side purchase-context read on behalf of a customer access token. */
  fetchPurchaseContext(
    accessToken: string,
    variationIds: string[],
  ): Promise<CustomerPurchaseContext | null>;
}

export function createCustomerClient(
  config: CustomerClientConfig,
  options: CustomerClientOptions = {},
): CustomerClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const fetcher = options.fetcher ?? fetch;

  function getServerHeaders(
    headerOptions: { customerToken?: string } = {},
  ): Record<string, string> {
    return {
      Authorization: `Bearer ${config.secretKey}`,
      ...(headerOptions.customerToken ? { 'x-customer-token': headerOptions.customerToken } : {}),
    };
  }

  async function postToken(body: Record<string, string>): Promise<TokenBundle> {
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}/auth/token`, {
        method: 'POST',
        headers: {
          ...getServerHeaders(),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new StorefrontAuthError('Customer token exchange failed to reach the storefront.', {
        code: 'network_error',
      });
    }

    const payload = await readJson(response);
    if (!response.ok) {
      throw new StorefrontAuthError('Customer token exchange was rejected.', {
        code: getErrorCode(payload) ?? 'token_exchange_failed',
        status: response.status,
      });
    }

    const bundle = parseTokenResponse(payload);
    if (!bundle) {
      throw new StorefrontAuthError('Customer token response was not understood.', {
        code: 'malformed_token_response',
        status: response.status,
      });
    }
    return bundle;
  }

  return {
    storefrontBaseUrl: baseUrl,

    getAuthorizationUrl(input) {
      return buildAuthorizationUrl({
        baseUrl,
        publishableKey: config.publishableKey,
        callbackUrl: input.callbackUrl,
      });
    },

    exchangeCode(input) {
      return postToken(buildAuthorizationCodeBody(input));
    },

    refresh(input) {
      return postToken(buildRefreshTokenBody(input));
    },

    getServerHeaders,

    async fetchPurchaseContext(accessToken, variationIds) {
      if (variationIds.length === 0) return { availability: [], memberships: [], pricing: [] };
      try {
        const response = await fetcher(`${baseUrl}/purchase-context`, {
          method: 'POST',
          headers: {
            ...getServerHeaders({ customerToken: accessToken }),
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ variationIds }),
        });
        if (!response.ok) return null;
        return parsePurchaseContextResponse(await response.json());
      } catch {
        return null;
      }
    },
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function getErrorCode(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const record = payload as Record<string, unknown>;
  const direct = record.error ?? record.code;
  return typeof direct === 'string' ? direct : undefined;
}
