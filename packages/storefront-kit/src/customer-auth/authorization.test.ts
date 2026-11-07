import { describe, expect, it } from 'vitest';
import {
  buildAuthorizationCodeBody,
  buildAuthorizationUrl,
  buildRefreshTokenBody,
  parseTokenResponse,
  readCallbackError,
} from './authorization';

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode(payload)}.sig`;
}

describe('buildAuthorizationUrl', () => {
  it('builds a code-mode authorize URL with the callback as return_to', () => {
    const url = new URL(
      buildAuthorizationUrl({
        baseUrl: 'https://api.example.com/public/v1/',
        publishableKey: 'pk_live',
        callbackUrl: 'https://site.example.com/api/auth/callback',
      }),
    );

    expect(url.origin + url.pathname).toBe('https://api.example.com/public/v1/auth/login');
    expect(url.searchParams.get('return_to')).toBe('https://site.example.com/api/auth/callback');
    expect(url.searchParams.get('key')).toBe('pk_live');
    expect(url.searchParams.get('response_type')).toBe('code');
    // The store owns CSRF (pg_pub_state) and appends ?code=..&status=.. itself.
    expect(url.searchParams.has('state')).toBe(false);
    expect(url.searchParams.has('redirect_uri')).toBe(false);
  });
});

describe('token exchange bodies', () => {
  it('builds the authorizationCode grant body (no redirect_uri)', () => {
    expect(buildAuthorizationCodeBody({ code: 'abc' })).toEqual({
      grantType: 'authorizationCode',
      code: 'abc',
    });
  });

  it('builds the refreshToken grant body', () => {
    expect(buildRefreshTokenBody({ refreshToken: 'r1' })).toEqual({
      grantType: 'refreshToken',
      refreshToken: 'r1',
    });
  });
});

describe('parseTokenResponse', () => {
  it('parses the store response and decodes identity from the access JWT', () => {
    const accessToken = jwt({ sub: 'cust_1', email: 'a@example.com', given_name: 'Ada' });
    const bundle = parseTokenResponse({
      accessToken,
      refreshToken: 'rt',
      expiresAtEpochMs: 1_000_000_060_000,
    });
    expect(bundle).toEqual({
      accessToken,
      refreshToken: 'rt',
      expiresAt: 1_000_000_060_000,
      customer: { id: 'cust_1', firstName: 'Ada', email: 'a@example.com' },
    });
  });

  it('returns null when the access token has no resolvable identity', () => {
    expect(
      parseTokenResponse({ accessToken: 'opaque', refreshToken: 'rt', expiresAtEpochMs: 1 }),
    ).toBeNull();
  });

  it('returns null on a malformed response', () => {
    expect(parseTokenResponse({ accessToken: jwt({ sub: 'x' }) })).toBeNull();
    expect(parseTokenResponse({ access_token: 'snake' })).toBeNull();
    expect(parseTokenResponse(null)).toBeNull();
  });
});

describe('readCallbackError', () => {
  it('prefers error_description, then error', () => {
    expect(
      readCallbackError(new URLSearchParams('error=login_failed&error_description=OTP+expired')),
    ).toBe('OTP expired');
    expect(readCallbackError(new URLSearchParams('error=access_denied'))).toBe('access_denied');
  });

  it('treats a non-success status as an error', () => {
    expect(readCallbackError(new URLSearchParams('status=error'))).toBe('error');
  });

  it('returns null on a successful callback', () => {
    expect(readCallbackError(new URLSearchParams('code=abc&status=success'))).toBeNull();
    expect(readCallbackError(new URLSearchParams('code=abc'))).toBeNull();
  });
});
