import { describe, expect, it } from 'vitest';
import {
  AMPLITUDE_UPLOAD_URLS,
  decideUploadBody,
  decideUploadHead,
  UPLOAD_LIMIT_BYTES,
  type UploadHead,
  uploadUrlFor,
  visitorLocationFromCf,
  withoutIp,
  withVisitorLocation,
} from './core.js';

const HEAD: UploadHead = {
  method: 'POST',
  contentType: 'application/json',
  contentEncoding: null,
  contentLength: '42',
};

const bytes = (text: string) => new TextEncoder().encode(text);
const NOWHERE = { serverZone: 'US', location: {} } as const;

describe('decideUploadHead', () => {
  it('reads the body of a JSON POST, with or without a charset or length', () => {
    expect(decideUploadHead(HEAD)).toEqual({ action: 'read-body' });
    expect(
      decideUploadHead({
        ...HEAD,
        contentType: 'application/json; charset=utf-8',
        contentLength: null,
      }),
    ).toEqual({ action: 'read-body' });
  });

  it.each(['GET', 'HEAD', 'PUT', 'OPTIONS'])('refuses %s with 405', (method) => {
    expect(decideUploadHead({ ...HEAD, method })).toMatchObject({ action: 'reject', status: 405 });
  });

  it.each([
    null,
    'text/plain;charset=UTF-8',
    'application/x-www-form-urlencoded',
  ])('refuses content type %j with 415', (contentType) => {
    expect(decideUploadHead({ ...HEAD, contentType })).toMatchObject({ status: 415 });
  });

  it('refuses a compressed body with 415', () => {
    expect(decideUploadHead({ ...HEAD, contentEncoding: 'gzip' })).toMatchObject({ status: 415 });
    expect(decideUploadHead({ ...HEAD, contentEncoding: 'identity' })).toEqual({
      action: 'read-body',
    });
  });

  it('refuses a declared length over the limit with 413', () => {
    expect(
      decideUploadHead({ ...HEAD, contentLength: String(UPLOAD_LIMIT_BYTES + 1) }),
    ).toMatchObject({ status: 413 });
    expect(decideUploadHead({ ...HEAD, contentLength: String(UPLOAD_LIMIT_BYTES) })).toEqual({
      action: 'read-body',
    });
  });
});

describe('uploadUrlFor', () => {
  it('fixes the upstream by zone', () => {
    expect(uploadUrlFor('US')).toBe('https://api2.amplitude.com/2/httpapi');
    expect(uploadUrlFor('EU')).toBe('https://api.eu.amplitude.com/2/httpapi');
  });

  it('throws on an unknown zone', () => {
    expect(() => uploadUrlFor('eu' as unknown as 'EU')).toThrow(/serverZone/);
  });
});

describe('decideUploadBody', () => {
  it('forwards to the zone URL with location added and ip removed', () => {
    const decision = decideUploadBody(
      bytes(
        JSON.stringify({ api_key: 'k', events: [{ event_type: 'page_viewed', ip: '$remote' }] }),
      ),
      { serverZone: 'EU', location: { country: 'Germany', city: 'Berlin' } },
    );
    expect(decision).toEqual({
      action: 'forward',
      url: AMPLITUDE_UPLOAD_URLS.EU,
      body: JSON.stringify({
        api_key: 'k',
        events: [{ event_type: 'page_viewed', country: 'Germany', city: 'Berlin' }],
      }),
    });
  });

  it('forwards a body with no location unchanged', () => {
    const body = JSON.stringify({ api_key: 'x', events: [] });
    expect(decideUploadBody(bytes(body), NOWHERE)).toMatchObject({ action: 'forward', body });
  });

  it.each(['{"api_key":', '', 'not json'])('refuses malformed JSON %j with 400', (text) => {
    expect(decideUploadBody(bytes(text), NOWHERE)).toMatchObject({ action: 'reject', status: 400 });
  });

  it('refuses invalid UTF-8 with 400', () => {
    expect(decideUploadBody(new Uint8Array([0x7b, 0xff, 0x7d]), NOWHERE)).toMatchObject({
      status: 400,
    });
  });

  it('refuses a body over the limit with 413', () => {
    expect(decideUploadBody(new Uint8Array(UPLOAD_LIMIT_BYTES + 1), NOWHERE)).toMatchObject({
      status: 413,
    });
  });
});

describe('withVisitorLocation', () => {
  const LOCATION = { country: 'United States', region: 'California', city: 'Napa' };

  it('adds country, region and city to every event', () => {
    expect(withVisitorLocation({ api_key: 'k', events: [{ a: 1 }, { b: 2 }] }, LOCATION)).toEqual({
      api_key: 'k',
      events: [
        { a: 1, ...LOCATION },
        { b: 2, ...LOCATION },
      ],
    });
  });

  it('keeps a value the event already carries', () => {
    expect(withVisitorLocation({ events: [{ country: 'Canada', city: null }] }, LOCATION)).toEqual({
      events: [{ country: 'Canada', region: 'California', city: 'Napa' }],
    });
  });

  it('only sets the fields the location has', () => {
    expect(withVisitorLocation({ events: [{ a: 1 }] }, { country: 'France' })).toEqual({
      events: [{ a: 1, country: 'France' }],
    });
  });

  it('leaves events unchanged without location data', () => {
    const payload = { events: [{ a: 1 }] };
    expect(withVisitorLocation(payload, {})).toEqual(payload);
  });

  it.each([
    ['a payload with no events', { api_key: 'k' }],
    ['non-array events', { events: { a: 1 } }],
    ['a non-object payload', [1, 2]],
    ['null', null],
  ])('passes %s through unchanged', (_label, payload) => {
    expect(withVisitorLocation(payload, LOCATION)).toEqual(payload);
  });

  it('passes non-object entries through unchanged', () => {
    expect(withVisitorLocation({ events: ['x', null, { a: 1 }] }, { city: 'Napa' })).toEqual({
      events: ['x', null, { a: 1, city: 'Napa' }],
    });
  });
});

describe('withoutIp', () => {
  it('drops ip from every event and nothing else', () => {
    expect(
      withoutIp({ api_key: 'k', events: [{ ip: '$remote', a: 1 }, { ip: '1.2.3.4' }] }),
    ).toEqual({ api_key: 'k', events: [{ a: 1 }, {}] });
  });
});

describe('visitorLocationFromCf', () => {
  it('maps the ISO country code to its English name and keeps region and city', () => {
    expect(
      visitorLocationFromCf({
        country: 'US',
        region: 'California',
        city: 'Napa',
        latitude: '38.29',
        longitude: '-122.28',
        postalCode: '94558',
        metroCode: '807',
      }),
    ).toEqual({ country: 'United States', region: 'California', city: 'Napa' });
  });

  it('drops unknown and Tor countries, and blank or non-string fields', () => {
    expect(visitorLocationFromCf({ country: 'XX', region: ' ', city: 7 })).toEqual({});
    expect(visitorLocationFromCf({ country: 'T1' })).toEqual({});
  });

  it.each([undefined, null, 'US'])('is empty for %j', (cf) => {
    expect(visitorLocationFromCf(cf)).toEqual({});
  });
});
