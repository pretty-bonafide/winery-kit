// Functional core for the site-domain customer session.
//
// A TokenBundle is what a site stores in its OWN (site-domain) session cookie
// after the confidential-client code exchange: the customer access token that
// authenticates server-side data reads (as `x-customer-token`), the refresh
// credential, an absolute expiry, and the display identity decoded from the
// access token. Everything here is pure — `now` is injected, never read from the
// clock — so expiry and session-view derivation are trivially testable ahead of
// the live platform backend. All I/O (crypto, fetch, cookies) lives in the
// imperative shell (session-seal.ts, customer-client.ts, and the site's Astro
// endpoints).
import type { CustomerSessionView } from '../storefront-api/auth.js';

export interface CustomerIdentity {
  id: string;
  firstName?: string;
  email?: string;
}

export interface TokenBundle {
  accessToken: string;
  refreshToken: string;
  /** Absolute epoch-ms expiry of the access token. */
  expiresAt: number;
  customer: CustomerIdentity;
}

/** Refresh this far before the hard expiry so an in-flight read never races it. */
export const DEFAULT_REFRESH_SKEW_MS = 60_000;

export function isAccessTokenExpired(
  bundle: TokenBundle,
  now: number,
  skewMs = DEFAULT_REFRESH_SKEW_MS,
): boolean {
  return now >= bundle.expiresAt - skewMs;
}

/** True when the bundle is still usable but close enough to expiry to refresh. */
export function shouldRefresh(bundle: TokenBundle, now: number): boolean {
  return isAccessTokenExpired(bundle, now);
}

export function toSessionView(bundle: TokenBundle | null): CustomerSessionView {
  if (!bundle) return { status: 'anonymous' };
  const { id, firstName, email } = bundle.customer;
  return {
    status: 'authenticated',
    customer: {
      id,
      ...(firstName ? { firstName } : {}),
      ...(email ? { email } : {}),
    },
  };
}

/**
 * Decode the display identity from a customer access JWT WITHOUT verifying it.
 * The token is only trusted server-side by the platform on each data call; here
 * we read claims solely to render the account name/email, so an unverified
 * base64url decode of the payload is sufficient (and never used for authz).
 * Returns null when the value is not a well-formed JWT with a usable subject.
 */
export function decodeCustomerFromJwt(accessToken: string): CustomerIdentity | null {
  const payload = decodeJwtPayload(accessToken);
  if (!payload) return null;

  const id =
    getString(payload, 'customer_id') ?? getString(payload, 'sub') ?? getString(payload, 'cid');
  if (!id) return null;

  const firstName =
    getString(payload, 'first_name') ??
    getString(payload, 'firstName') ??
    getString(payload, 'given_name');
  const email = getString(payload, 'email');

  return {
    id,
    ...(firstName ? { firstName } : {}),
    ...(email ? { email } : {}),
  };
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;

  const json = base64UrlDecode(parts[1]);
  if (json === null) return null;

  try {
    const parsed = JSON.parse(json) as unknown;
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function base64UrlDecode(value: string): string | null {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  try {
    // atob is available in Workers and modern Node; decode as UTF-8.
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
