import { describe, expect, it } from 'vitest';
import { buildBookingUrl, buildClubJoinUrl, resolveStoreOrigin } from './index';

const FALLBACK = 'https://store.example.com';

describe('resolveStoreOrigin', () => {
  it('extracts the origin from a fuller API URL', () => {
    expect(resolveStoreOrigin('https://store.example.com/api/public/v1', FALLBACK)).toBe(
      'https://store.example.com',
    );
  });

  it('passes a bare origin through unchanged', () => {
    expect(resolveStoreOrigin('https://store.example.com', FALLBACK)).toBe(
      'https://store.example.com',
    );
  });

  it('strips any port/path but keeps a non-default port', () => {
    expect(resolveStoreOrigin('http://localhost:8788/api', FALLBACK)).toBe('http://localhost:8788');
  });

  it('falls back when the input is null, undefined, or empty', () => {
    expect(resolveStoreOrigin(null, FALLBACK)).toBe(FALLBACK);
    expect(resolveStoreOrigin(undefined, FALLBACK)).toBe(FALLBACK);
    expect(resolveStoreOrigin('', FALLBACK)).toBe(FALLBACK);
  });

  it('falls back when the input is not a parseable URL', () => {
    expect(resolveStoreOrigin('not a url', FALLBACK)).toBe(FALLBACK);
  });
});

describe('buildClubJoinUrl', () => {
  it('defaults to the canonical /clubs path', () => {
    expect(buildClubJoinUrl({ storeOrigin: 'https://store.example.com' })).toBe(
      'https://store.example.com/clubs',
    );
  });

  it('honors a custom path', () => {
    expect(buildClubJoinUrl({ storeOrigin: 'https://store.example.com', path: '/club/join' })).toBe(
      'https://store.example.com/club/join',
    );
  });

  it('resolves against the origin even when it carries a trailing slash', () => {
    expect(buildClubJoinUrl({ storeOrigin: 'https://store.example.com/' })).toBe(
      'https://store.example.com/clubs',
    );
  });

  it("opens one club's join flow when given its slug", () => {
    expect(
      buildClubJoinUrl({ storeOrigin: 'https://store.example.com/', club: 'villa-creek-reserve' }),
    ).toBe('https://store.example.com/clubs/villa-creek-reserve/join');
  });

  it('encodes the club slug as one path segment', () => {
    expect(buildClubJoinUrl({ storeOrigin: 'https://store.example.com', club: 'a/b c' })).toBe(
      'https://store.example.com/clubs/a%2Fb%20c/join',
    );
  });

  it('treats an undefined club as absent', () => {
    expect(buildClubJoinUrl({ storeOrigin: 'https://store.example.com', club: undefined })).toBe(
      'https://store.example.com/clubs',
    );
  });

  it('throws on a blank club slug', () => {
    expect(() => buildClubJoinUrl({ storeOrigin: 'https://store.example.com', club: ' ' })).toThrow(
      /club/,
    );
  });
});

describe('buildBookingUrl', () => {
  it('opens the hosted booking flow on the date step for the experience', () => {
    expect(
      buildBookingUrl({ storeOrigin: 'https://store.example.com', experience: 'flagship-tasting' }),
    ).toBe('https://store.example.com/visit?step=visit&experience=flagship-tasting');
  });

  it('resolves against the origin even when it carries a trailing slash', () => {
    expect(
      buildBookingUrl({ storeOrigin: 'https://store.example.com/', experience: 'the-vault' }),
    ).toBe('https://store.example.com/visit?step=visit&experience=the-vault');
  });

  it('encodes the slug as a query value', () => {
    expect(buildBookingUrl({ storeOrigin: 'https://store.example.com', experience: 'a b&c' })).toBe(
      'https://store.example.com/visit?step=visit&experience=a+b%26c',
    );
  });

  it('throws on a blank experience slug', () => {
    expect(() =>
      buildBookingUrl({ storeOrigin: 'https://store.example.com', experience: '' }),
    ).toThrow(/experience/);
  });
});
