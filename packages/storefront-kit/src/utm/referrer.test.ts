import { describe, expect, it } from 'vitest';
import {
  externalReferrerDomain,
  isInternalReferrer,
  normalizeReferrerDomain,
  referrerHostname,
  resolveInternalHosts,
  siteDomain,
  toHostname,
  withoutWww,
} from './referrer.js';

describe('referrerHostname', () => {
  it('keeps only the lowercase hostname: no scheme, port, path, query or hash', () => {
    expect(referrerHostname('https://WWW.Google.co.uk:8443/search?q=wine#top')).toBe(
      'www.google.co.uk',
    );
    expect(referrerHostname('http://l.instagram.com/?u=https%3A%2F%2Fpacowinery.com')).toBe(
      'l.instagram.com',
    );
  });

  it('drops a trailing dot', () => {
    expect(referrerHostname('https://news.example.com./story')).toBe('news.example.com');
  });

  it('is null for an empty, invalid or non-http(s) referrer', () => {
    for (const referrer of [
      '',
      '   ',
      'not a url',
      '/relative/path',
      'android-app://com.google.android.gm/',
      'file:///tmp/page.html',
      'about:blank',
    ]) {
      expect(referrerHostname(referrer)).toBeNull();
    }
  });
});

describe('toHostname', () => {
  it('accepts a hostname or an origin', () => {
    expect(toHostname('store.example.com')).toBe('store.example.com');
    expect(toHostname(' https://Store.Example.com ')).toBe('store.example.com');
    expect(toHostname('https://store.example.com:8443/')).toBe('store.example.com');
    expect(toHostname('store.example.com:8443')).toBe('store.example.com');
  });

  it('is null for something that is neither', () => {
    expect(toHostname('')).toBeNull();
    expect(toHostname('store example')).toBeNull();
    expect(toHostname('https://')).toBeNull();
  });
});

describe('siteDomain', () => {
  it('is the last two labels', () => {
    expect(siteDomain('www.pacowinery.com')).toBe('pacowinery.com');
    expect(siteDomain('store.pacowinery.com')).toBe('pacowinery.com');
    expect(siteDomain('pacowinery.com')).toBe('pacowinery.com');
    expect(siteDomain('Store.PacoWinery.com')).toBe('pacowinery.com');
  });

  it('is naive about multi-label suffixes (documented limitation)', () => {
    expect(siteDomain('shop.example.co.uk')).toBe('co.uk');
  });

  it('returns IP addresses and single-label hosts whole', () => {
    expect(siteDomain('127.0.0.1')).toBe('127.0.0.1');
    expect(siteDomain('[::1]')).toBe('[::1]');
    expect(siteDomain('localhost')).toBe('localhost');
  });
});

describe('isInternalReferrer', () => {
  const context = { pageHost: 'www.pacowinery.com', internalHosts: [] };

  it('is internal for the page host itself', () => {
    expect(isInternalReferrer('www.pacowinery.com', context)).toBe(true);
  });

  it('is internal for any host sharing the site domain', () => {
    expect(isInternalReferrer('pacowinery.com', context)).toBe(true);
    expect(isInternalReferrer('store.pacowinery.com', context)).toBe(true);
  });

  it('is internal for a configured internal host on another domain', () => {
    expect(
      isInternalReferrer('paco-v2.prettygood.live', {
        ...context,
        internalHosts: ['paco-v2.prettygood.live'],
      }),
    ).toBe(true);
  });

  it('is external for other sites, including a configured host’s siblings', () => {
    expect(isInternalReferrer('www.google.com', context)).toBe(false);
    expect(isInternalReferrer('pacowinery.com.evil.example', context)).toBe(false);
    expect(
      isInternalReferrer('other.prettygood.live', {
        ...context,
        internalHosts: ['paco-v2.prettygood.live'],
      }),
    ).toBe(false);
  });

  it('does not treat IPs on the same /16 as one site', () => {
    expect(isInternalReferrer('10.0.0.1', { pageHost: '127.0.0.1', internalHosts: [] })).toBe(
      false,
    );
  });
});

describe('resolveInternalHosts', () => {
  it('normalizes origins and hostnames to hostnames', () => {
    expect(resolveInternalHosts(['https://Store.Example.net', 'checkout.example.org'])).toEqual([
      'store.example.net',
      'checkout.example.org',
    ]);
  });

  it('throws naming an entry that is neither', () => {
    expect(() => resolveInternalHosts(['store.example.net', 'not a host'])).toThrow(
      /internalHosts.*not a host/,
    );
    expect(() => resolveInternalHosts([''])).toThrow(/internalHosts/);
  });
});

describe('externalReferrerDomain', () => {
  const context = { pageHost: 'pacowinery.com', internalHosts: ['store.example.net'] };

  it('is the hostname of an external referrer, without a leading www.', () => {
    expect(externalReferrerDomain('https://www.google.com/', context)).toBe('google.com');
    expect(externalReferrerDomain('https://l.instagram.com/?u=x', context)).toBe('l.instagram.com');
  });

  it('detects an internal referrer before stripping www.', () => {
    expect(
      externalReferrerDomain('https://www.store.example.net/', {
        pageHost: 'pacowinery.com',
        internalHosts: ['www.store.example.net'],
      }),
    ).toBeNull();
    expect(externalReferrerDomain('https://www.pacowinery.com/', context)).toBeNull();
  });

  it('is null for no referrer, an invalid one, or an internal one', () => {
    expect(externalReferrerDomain('', context)).toBeNull();
    expect(externalReferrerDomain('garbage', context)).toBeNull();
    expect(externalReferrerDomain('https://www.pacowinery.com/wines', context)).toBeNull();
    expect(externalReferrerDomain('https://store.example.net/cart', context)).toBeNull();
  });
});

describe('withoutWww', () => {
  it('strips a single leading www.', () => {
    expect(withoutWww('www.instagram.com')).toBe('instagram.com');
    expect(withoutWww('www.google.co.uk')).toBe('google.co.uk');
    expect(withoutWww('www.www.example.com')).toBe('www.example.com');
  });

  it('keeps other subdomains and a bare www. host', () => {
    expect(withoutWww('l.instagram.com')).toBe('l.instagram.com');
    expect(withoutWww('news.google.com')).toBe('news.google.com');
    expect(withoutWww('www2.example.com')).toBe('www2.example.com');
    expect(withoutWww('www.com')).toBe('www.com');
    expect(withoutWww('instagram.com')).toBe('instagram.com');
  });
});

describe('normalizeReferrerDomain', () => {
  it('lowercases, reduces an origin to its host and strips www.', () => {
    expect(normalizeReferrerDomain('WWW.Instagram.com')).toBe('instagram.com');
    expect(normalizeReferrerDomain('https://www.google.com')).toBe('google.com');
    expect(normalizeReferrerDomain('l.instagram.com')).toBe('l.instagram.com');
  });

  it('is null for something that is not a hostname', () => {
    expect(normalizeReferrerDomain('')).toBeNull();
    expect(normalizeReferrerDomain('not a host')).toBeNull();
  });
});
