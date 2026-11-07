import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REFRESH_SKEW_MS,
  decodeCustomerFromJwt,
  isAccessTokenExpired,
  shouldRefresh,
  type TokenBundle,
  toSessionView,
} from './token-bundle';

const NOW = 1_000_000_000_000;

function bundle(overrides: Partial<TokenBundle> = {}): TokenBundle {
  return {
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresAt: NOW + 3_600_000,
    customer: { id: 'cust_1', firstName: 'Ada', email: 'ada@example.com' },
    ...overrides,
  };
}

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

describe('isAccessTokenExpired', () => {
  it('is false well before expiry', () => {
    expect(isAccessTokenExpired(bundle(), NOW)).toBe(false);
  });

  it('is true once inside the refresh skew window', () => {
    const expiresAt = NOW + DEFAULT_REFRESH_SKEW_MS - 1;
    expect(isAccessTokenExpired(bundle({ expiresAt }), NOW)).toBe(true);
  });

  it('is true after hard expiry', () => {
    expect(isAccessTokenExpired(bundle({ expiresAt: NOW - 1 }), NOW)).toBe(true);
  });

  it('honors a custom skew', () => {
    const expiresAt = NOW + 5_000;
    expect(isAccessTokenExpired(bundle({ expiresAt }), NOW, 10_000)).toBe(true);
    expect(isAccessTokenExpired(bundle({ expiresAt }), NOW, 1_000)).toBe(false);
  });
});

describe('shouldRefresh', () => {
  it('mirrors expiry within the skew window', () => {
    expect(shouldRefresh(bundle({ expiresAt: NOW + 30_000 }), NOW)).toBe(true);
    expect(shouldRefresh(bundle({ expiresAt: NOW + 3_600_000 }), NOW)).toBe(false);
  });
});

describe('toSessionView', () => {
  it('maps null to anonymous', () => {
    expect(toSessionView(null)).toEqual({ status: 'anonymous' });
  });

  it('maps a bundle to an authenticated view', () => {
    expect(toSessionView(bundle())).toEqual({
      status: 'authenticated',
      customer: { id: 'cust_1', firstName: 'Ada', email: 'ada@example.com' },
    });
  });

  it('omits absent optional identity fields', () => {
    expect(toSessionView(bundle({ customer: { id: 'cust_2' } }))).toEqual({
      status: 'authenticated',
      customer: { id: 'cust_2' },
    });
  });
});

describe('decodeCustomerFromJwt', () => {
  it('reads sub/email/given_name claims', () => {
    const token = jwt({ sub: 'cust_9', email: 'grace@example.com', given_name: 'Grace' });
    expect(decodeCustomerFromJwt(token)).toEqual({
      id: 'cust_9',
      firstName: 'Grace',
      email: 'grace@example.com',
    });
  });

  it('prefers customer_id and first_name variants', () => {
    const token = jwt({ customer_id: 'cust_10', first_name: 'Alan', sub: 'ignored' });
    expect(decodeCustomerFromJwt(token)).toEqual({ id: 'cust_10', firstName: 'Alan' });
  });

  it('returns null without a subject', () => {
    expect(decodeCustomerFromJwt(jwt({ email: 'x@example.com' }))).toBeNull();
  });

  it('returns null for malformed tokens', () => {
    expect(decodeCustomerFromJwt('not-a-jwt')).toBeNull();
    expect(decodeCustomerFromJwt('')).toBeNull();
  });
});
