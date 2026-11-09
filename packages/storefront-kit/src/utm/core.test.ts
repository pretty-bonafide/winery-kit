import { describe, expect, it } from 'vitest';
import {
  appendUtmToUrl,
  extractUtmParams,
  isExpired,
  mergeAcquisition,
  mergeUtm,
  parseStoredUtm,
  type StoredUtm,
  toAcquisition,
  UTM_TTL_MS,
} from './core';

const NOW = new Date('2026-06-09T12:00:00.000Z');

function stored(params: StoredUtm['params'], capturedAt = NOW.toISOString()): StoredUtm {
  return { params, capturedAt };
}

describe('extractUtmParams', () => {
  it('extracts known utm keys without the prefix', () => {
    expect(extractUtmParams('?utm_source=ig&utm_medium=social&utm_campaign=spring')).toEqual({
      source: 'ig',
      medium: 'social',
      campaign: 'spring',
    });
  });

  it('handles a search string without a leading question mark', () => {
    expect(extractUtmParams('utm_source=ig')).toEqual({ source: 'ig' });
  });

  it('decodes URL-encoded values', () => {
    expect(extractUtmParams('?utm_campaign=spring%20release%2B2026')).toEqual({
      campaign: 'spring release+2026',
    });
  });

  it('returns null when no utm params are present', () => {
    expect(extractUtmParams('?preview=true&status=success')).toBeNull();
    expect(extractUtmParams('')).toBeNull();
  });

  it('drops empty and whitespace-only values', () => {
    expect(extractUtmParams('?utm_source=&utm_medium=%20%20')).toBeNull();
  });

  it('ignores unknown utm-like keys', () => {
    expect(extractUtmParams('?utm_bogus=x')).toBeNull();
  });
});

describe('parseStoredUtm', () => {
  it('round-trips a serialized record', () => {
    const record = stored({ source: 'ig' });
    expect(parseStoredUtm(JSON.stringify(record))).toEqual(record);
  });

  it('returns null for null, garbage, and non-object JSON', () => {
    expect(parseStoredUtm(null)).toBeNull();
    expect(parseStoredUtm('not json')).toBeNull();
    expect(parseStoredUtm('"a string"')).toBeNull();
    expect(parseStoredUtm('[1,2]')).toBeNull();
  });

  it('returns null when capturedAt is missing or unparseable', () => {
    expect(parseStoredUtm(JSON.stringify({ params: { source: 'ig' } }))).toBeNull();
    expect(
      parseStoredUtm(JSON.stringify({ params: { source: 'ig' }, capturedAt: 'whenever' })),
    ).toBeNull();
  });

  it('drops non-string and unknown param values, returns null if none survive', () => {
    expect(
      parseStoredUtm(JSON.stringify({ params: { source: 42, bogus: 'x' }, capturedAt: NOW })),
    ).toBeNull();
  });
});

describe('parseStoredUtm with a referrer', () => {
  it('reads an old record (params only) unchanged, with no referrerDomain', () => {
    const raw = JSON.stringify({ params: { source: 'ig' }, capturedAt: NOW.toISOString() });
    const parsed = parseStoredUtm(raw);
    expect(parsed).toEqual({ params: { source: 'ig' }, capturedAt: NOW.toISOString() });
    expect(parsed).not.toHaveProperty('referrerDomain');
  });

  it('reads a referrer-only record (empty params) as valid', () => {
    const record = { params: {}, referrerDomain: 'www.google.com', capturedAt: NOW.toISOString() };
    expect(parseStoredUtm(JSON.stringify(record))).toEqual(record);
  });

  it('reads a record with both UTMs and a referrer', () => {
    const record = {
      params: { source: 'ig', medium: 'social' },
      referrerDomain: 'l.instagram.com',
      capturedAt: NOW.toISOString(),
    };
    expect(parseStoredUtm(JSON.stringify(record))).toEqual(record);
  });

  it('drops an invalid referrerDomain, and the record if nothing else survives', () => {
    expect(
      parseStoredUtm(
        JSON.stringify({ params: { source: 'ig' }, referrerDomain: 42, capturedAt: NOW }),
      ),
    ).toEqual({ params: { source: 'ig' }, capturedAt: NOW.toISOString() });
    expect(
      parseStoredUtm(JSON.stringify({ params: {}, referrerDomain: '', capturedAt: NOW })),
    ).toBeNull();
    expect(
      parseStoredUtm(JSON.stringify({ params: {}, referrerDomain: 'not a host', capturedAt: NOW })),
    ).toBeNull();
  });

  it('still requires params to be an object', () => {
    expect(
      parseStoredUtm(JSON.stringify({ referrerDomain: 'www.google.com', capturedAt: NOW })),
    ).toBeNull();
  });
});

describe('toAcquisition', () => {
  it('maps params and referrer, reading empty params as no UTMs', () => {
    expect(toAcquisition(stored({ source: 'ig' }))).toEqual({
      utm: { source: 'ig' },
      referrerDomain: null,
    });
    expect(
      toAcquisition({
        params: {},
        referrerDomain: 'www.google.com',
        capturedAt: NOW.toISOString(),
      }),
    ).toEqual({ utm: null, referrerDomain: 'www.google.com' });
  });
});

describe('isExpired', () => {
  it('is false within the TTL and true past it', () => {
    const captured = new Date(NOW.getTime() - UTM_TTL_MS);
    expect(isExpired(stored({ source: 'ig' }, captured.toISOString()), NOW)).toBe(false);

    const stale = new Date(NOW.getTime() - UTM_TTL_MS - 1);
    expect(isExpired(stored({ source: 'ig' }, stale.toISOString()), NOW)).toBe(true);
  });

  it('treats an unparseable capturedAt as expired', () => {
    expect(isExpired(stored({ source: 'ig' }, 'garbage'), NOW)).toBe(true);
  });
});

describe('mergeUtm', () => {
  it('replaces the stored record wholesale on a new touch (last-touch)', () => {
    const existing = stored(
      { source: 'email', campaign: 'winter' },
      new Date(NOW.getTime() - 1000).toISOString(),
    );
    expect(mergeUtm(existing, { source: 'ig' }, NOW)).toEqual({
      params: { source: 'ig' },
      capturedAt: NOW.toISOString(),
    });
  });

  it('keeps an unexpired record when nothing new arrives', () => {
    const existing = stored({ source: 'email' });
    expect(mergeUtm(existing, null, NOW)).toBe(existing);
  });

  it('drops an expired record when nothing new arrives', () => {
    const stale = stored(
      { source: 'email' },
      new Date(NOW.getTime() - UTM_TTL_MS - 1).toISOString(),
    );
    expect(mergeUtm(stale, null, NOW)).toBeNull();
  });

  it('returns null when there is nothing stored and nothing incoming', () => {
    expect(mergeUtm(null, null, NOW)).toBeNull();
  });
});

describe('mergeAcquisition', () => {
  const earlier = new Date(NOW.getTime() - 1000).toISOString();

  it('starts a new touch from UTMs alone, with no referrerDomain key', () => {
    const merged = mergeAcquisition(null, { utm: { source: 'ig' }, referrerDomain: null }, NOW);
    expect(merged).toEqual({ params: { source: 'ig' }, capturedAt: NOW.toISOString() });
    expect(merged).not.toHaveProperty('referrerDomain');
  });

  it('starts a new touch from an external referrer alone, with empty params', () => {
    expect(mergeAcquisition(null, { utm: null, referrerDomain: 'www.google.com' }, NOW)).toEqual({
      params: {},
      referrerDomain: 'www.google.com',
      capturedAt: NOW.toISOString(),
    });
  });

  it('stores both when the landing has UTMs and a referrer', () => {
    expect(
      mergeAcquisition(
        stored({ source: 'old' }, earlier),
        { utm: { source: 'ig', medium: 'social' }, referrerDomain: 'l.instagram.com' },
        NOW,
      ),
    ).toEqual({
      params: { source: 'ig', medium: 'social' },
      referrerDomain: 'l.instagram.com',
      capturedAt: NOW.toISOString(),
    });
  });

  it('lets a referral replace an old UTM record wholesale', () => {
    const existing = stored({ source: 'email', campaign: 'winter' }, earlier);
    expect(
      mergeAcquisition(existing, { utm: null, referrerDomain: 'www.winespectator.com' }, NOW),
    ).toEqual({
      params: {},
      referrerDomain: 'www.winespectator.com',
      capturedAt: NOW.toISOString(),
    });
  });

  it('lets new UTMs replace an old referrer record wholesale (no referrer carried over)', () => {
    const existing: StoredUtm = {
      params: {},
      referrerDomain: 'www.google.com',
      capturedAt: earlier,
    };
    expect(
      mergeAcquisition(existing, { utm: { source: 'ig' }, referrerDomain: null }, NOW),
    ).toEqual({ params: { source: 'ig' }, capturedAt: NOW.toISOString() });
  });

  it('keeps an unexpired record on a direct landing', () => {
    const existing = stored({ source: 'email' }, earlier);
    expect(mergeAcquisition(existing, { utm: null, referrerDomain: null }, NOW)).toBe(existing);

    const referral: StoredUtm = {
      params: {},
      referrerDomain: 'www.google.com',
      capturedAt: earlier,
    };
    expect(mergeAcquisition(referral, { utm: null, referrerDomain: null }, NOW)).toBe(referral);
  });

  it('drops an expired record on a direct landing', () => {
    const stale: StoredUtm = {
      params: {},
      referrerDomain: 'www.google.com',
      capturedAt: new Date(NOW.getTime() - UTM_TTL_MS - 1).toISOString(),
    };
    expect(mergeAcquisition(stale, { utm: null, referrerDomain: null }, NOW)).toBeNull();
  });

  it('treats empty UTM params as none', () => {
    const existing = stored({ source: 'email' }, earlier);
    expect(mergeAcquisition(existing, { utm: {}, referrerDomain: null }, NOW)).toBe(existing);
  });
});

describe('appendUtmToUrl', () => {
  it('appends prefixed params to a bare URL', () => {
    expect(appendUtmToUrl('https://store.example.com/checkout', { source: 'ig' })).toBe(
      'https://store.example.com/checkout?utm_source=ig',
    );
  });

  it('composes with an existing query string', () => {
    expect(appendUtmToUrl('https://store.example.com/checkout?session=abc', { source: 'ig' })).toBe(
      'https://store.example.com/checkout?session=abc&utm_source=ig',
    );
  });

  it('does not overwrite utm params already on the URL', () => {
    expect(
      appendUtmToUrl('https://store.example.com/checkout?utm_source=platform', {
        source: 'ig',
        medium: 'social',
      }),
    ).toBe('https://store.example.com/checkout?utm_source=platform&utm_medium=social');
  });

  it('encodes values', () => {
    expect(
      appendUtmToUrl('https://store.example.com/checkout', { campaign: 'spring release' }),
    ).toBe('https://store.example.com/checkout?utm_campaign=spring+release');
  });

  it('returns relative or unparseable URLs unchanged instead of throwing', () => {
    expect(appendUtmToUrl('/checkout', { source: 'ig' })).toBe('/checkout');
    expect(appendUtmToUrl('', { source: 'ig' })).toBe('');
  });

  it('returns the URL unchanged when params are null', () => {
    expect(appendUtmToUrl('https://store.example.com/checkout', null)).toBe(
      'https://store.example.com/checkout',
    );
  });
});
