// Functional core for the authorization-code exchange with the platform public
// storefront API. Pure request builders + a response parser, matched to the live
// openapi.json (verified 2026-07-09).
//
// ┌─ WIRE CONTRACT (v1 confidential client) ──────────────────────────────────┐
// │ Authorize (browser top-level nav — sets NO custom headers):               │
// │   GET  {API}/auth/login?return_to={callback}&key={pub}&response_type=code  │
// │   → after OTP the store 302s to  {callback}?code={code}&status=success     │
// │     (code mode sets no cookies; the store owns its own pg_pub_state CSRF)  │
// │ Token exchange (site SERVER → API — secret key ONLY; publishable is 401):  │
// │   POST {API}/auth/token   Authorization: Bearer {pgsk secret}             │
// │     { grantType: 'authorizationCode', code }        // no redirect_uri     │
// │     { grantType: 'refreshToken', refreshToken }                            │
// │   → { accessToken, expiresAtEpochMs, refreshToken }  // no customer object │
// │ Data routes: present the access JWT via the `x-customer-token` header.     │
// └───────────────────────────────────────────────────────────────────────────┘
import { z } from 'zod';
import { decodeCustomerFromJwt, type TokenBundle } from './token-bundle';

export interface AuthorizationUrlInput {
  baseUrl: string;
  publishableKey: string;
  /**
   * The site's own callback URL; sent as the store's `return_to`. In code mode
   * the store appends `?code=<code>&status=success` to it after OTP, so this
   * must be a bare URL with no query of its own.
   */
  callbackUrl: string;
}

export function buildAuthorizationUrl(input: AuthorizationUrlInput): string {
  const url = new URL(`${normalizeBaseUrl(input.baseUrl)}/auth/login`);
  url.searchParams.set('return_to', input.callbackUrl);
  url.searchParams.set('key', input.publishableKey);
  url.searchParams.set('response_type', 'code');
  return url.toString();
}

export function buildAuthorizationCodeBody(input: { code: string }): Record<string, string> {
  return { grantType: 'authorizationCode', code: input.code };
}

export function buildRefreshTokenBody(input: { refreshToken: string }): Record<string, string> {
  return { grantType: 'refreshToken', refreshToken: input.refreshToken };
}

const tokenResponseSchema = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresAtEpochMs: z.number().int().positive(),
  })
  .passthrough();

/**
 * Parse a /auth/token response into a TokenBundle. The store returns an absolute
 * `expiresAtEpochMs` and NO customer object, so the display identity is decoded
 * from the access JWT (unverified — used only for the account UI, never authz).
 * Returns null on any shape mismatch or an undecodable token (fail closed →
 * anonymous).
 */
export function parseTokenResponse(body: unknown): TokenBundle | null {
  const parsed = tokenResponseSchema.safeParse(body);
  if (!parsed.success) return null;

  const customer = decodeCustomerFromJwt(parsed.data.accessToken);
  if (!customer) return null;

  return {
    accessToken: parsed.data.accessToken,
    refreshToken: parsed.data.refreshToken,
    expiresAt: parsed.data.expiresAtEpochMs,
    customer,
  };
}

/** Read a callback failure off the query: an `error`, or a non-success `status`. */
export function readCallbackError(params: URLSearchParams): string | null {
  const error = params.get('error');
  if (error) return params.get('error_description') || error;

  const status = params.get('status');
  if (status && status !== 'success') return status;

  return null;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}
