import { describe, expect, it } from 'vitest';
import {
  AMPLITUDE_UPLOAD_URLS,
  DATACENTER_ASNS,
  decideUploadBody,
  decideUploadHead,
  trafficClassFrom,
  UPLOAD_LIMIT_BYTES,
  type UploadHead,
  uploadUrlFor,
  visitorLocationFromCf,
  withoutIp,
  withTrafficClass,
  withVisitorLocation,
} from './core.js';

const HEAD: UploadHead = {
  method: 'POST',
  contentType: 'application/json',
  contentEncoding: null,
  contentLength: '42',
};

const bytes = (text: string) => new TextEncoder().encode(text);
const NOWHERE = { serverZone: 'US', location: {}, trafficClass: 'human' } as const;

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
  it('forwards to the zone URL with location and traffic class added and ip removed', () => {
    const decision = decideUploadBody(
      bytes(
        JSON.stringify({ api_key: 'k', events: [{ event_type: 'page_viewed', ip: '$remote' }] }),
      ),
      {
        serverZone: 'EU',
        location: { country: 'Germany', city: 'Berlin' },
        trafficClass: 'datacenter',
      },
    );
    expect(decision).toEqual({
      action: 'forward',
      url: AMPLITUDE_UPLOAD_URLS.EU,
      body: JSON.stringify({
        api_key: 'k',
        events: [
          {
            event_type: 'page_viewed',
            country: 'Germany',
            city: 'Berlin',
            event_properties: { traffic_class: 'datacenter' },
          },
        ],
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

describe('withTrafficClass', () => {
  it('adds traffic_class to every event, keeping its other event properties', () => {
    expect(
      withTrafficClass(
        {
          api_key: 'k',
          events: [
            { event_type: 'page_viewed', event_properties: { path: '/', channel: 'direct' } },
            { event_type: 'checkout_started' },
          ],
        },
        'known_bot',
      ),
    ).toEqual({
      api_key: 'k',
      events: [
        {
          event_type: 'page_viewed',
          event_properties: { path: '/', channel: 'direct', traffic_class: 'known_bot' },
        },
        { event_type: 'checkout_started', event_properties: { traffic_class: 'known_bot' } },
      ],
    });
  });

  it('overwrites a traffic_class the client sent, so it cannot be spoofed', () => {
    expect(
      withTrafficClass(
        { events: [{ event_properties: { traffic_class: 'human', path: '/' } }] },
        'datacenter',
      ),
    ).toEqual({ events: [{ event_properties: { traffic_class: 'datacenter', path: '/' } }] });
  });

  it.each([null, 'human', ['x']])('replaces event_properties of %j', (eventProperties) => {
    expect(withTrafficClass({ events: [{ event_properties: eventProperties }] }, 'human')).toEqual({
      events: [{ event_properties: { traffic_class: 'human' } }],
    });
  });

  it.each([
    ['a payload with no events', { api_key: 'k' }],
    ['null', null],
  ])('passes %s through unchanged', (_label, payload) => {
    expect(withTrafficClass(payload, 'human')).toEqual(payload);
  });

  it('passes non-object entries through unchanged', () => {
    expect(withTrafficClass({ events: ['x', null] }, 'human')).toEqual({ events: ['x', null] });
  });
});

describe('trafficClassFrom', () => {
  const BROWSER =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const RESIDENTIAL = { asn: 7922, country: 'US' }; // Comcast

  it('is human for a browser on a consumer network', () => {
    expect(trafficClassFrom({ cf: RESIDENTIAL, userAgent: BROWSER })).toBe('human');
  });

  it.each([undefined, null, 'US'])('is human for a browser when cf is %j', (cf) => {
    expect(trafficClassFrom({ cf, userAgent: BROWSER })).toBe('human');
  });

  describe('verified_bot', () => {
    it('from botManagement.verifiedBot', () => {
      expect(
        trafficClassFrom({ cf: { botManagement: { verifiedBot: true } }, userAgent: BROWSER }),
      ).toBe('verified_bot');
    });

    it('from a verifiedBotCategory', () => {
      expect(
        trafficClassFrom({
          cf: { verifiedBotCategory: 'Search Engine Crawler' },
          userAgent: BROWSER,
        }),
      ).toBe('verified_bot');
    });

    it.each([
      ['a blank verifiedBotCategory', { verifiedBotCategory: '  ' }],
      ['verifiedBot false', { botManagement: { verifiedBot: false } }],
      ['a truthy non-boolean verifiedBot', { botManagement: { verifiedBot: 'true' } }],
    ])('not from %s', (_label, cf) => {
      expect(trafficClassFrom({ cf, userAgent: BROWSER })).toBe('human');
    });

    it('wins over a low score, a bot user agent and a datacenter ASN', () => {
      expect(
        trafficClassFrom({
          cf: { botManagement: { verifiedBot: true, score: 1 }, asn: 16509 },
          userAgent: 'Googlebot/2.1',
        }),
      ).toBe('verified_bot');
    });
  });

  describe('known_bot from the Bot Management score', () => {
    it.each([1, 15, 29])('for score %d', (score) => {
      expect(trafficClassFrom({ cf: { botManagement: { score } }, userAgent: BROWSER })).toBe(
        'known_bot',
      );
    });

    it.each([0, 30, 99, '5', Number.NaN])('not for score %j', (score) => {
      expect(trafficClassFrom({ cf: { botManagement: { score } }, userAgent: BROWSER })).toBe(
        'human',
      );
    });

    it('wins over a datacenter ASN', () => {
      expect(
        trafficClassFrom({ cf: { botManagement: { score: 2 }, asn: 16509 }, userAgent: BROWSER }),
      ).toBe('known_bot');
    });
  });

  describe('known_bot from the user agent', () => {
    it.each([
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'Mozilla/5.0 (compatible; AhrefsBot/7.0)',
      'Mozilla/5.0 (compatible; YandexSpider/3.0)',
      'Mozilla/5.0 (compatible; Yahoo! Slurp)',
      'ia_archiver crawler',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
      'python-requests/2.31.0',
      'curl/8.4.0',
      'Wget/1.21.4',
      'Go-http-client/2.0',
      'axios/1.6.0',
      'node-fetch/1.0',
      'Puppeteer',
      'Playwright/1.40',
      'Mozilla/5.0 (Unknown; Linux x86_64) AppleWebKit/538.1 PhantomJS/2.1.1 Safari/538.1',
      'Mozilla/5.0 (Linux; Android 11) Chrome-Lighthouse',
      'facebookexternalhit/1.1',
    ])('for %s', (userAgent) => {
      expect(trafficClassFrom({ cf: RESIDENTIAL, userAgent })).toBe('known_bot');
    });

    it.each([null, '', '   '])('for a missing or empty user agent %j', (userAgent) => {
      expect(trafficClassFrom({ cf: RESIDENTIAL, userAgent })).toBe('known_bot');
    });

    it('not for a CUBOT phone', () => {
      expect(
        trafficClassFrom({
          cf: RESIDENTIAL,
          userAgent:
            'Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
        }),
      ).toBe('human');
    });

    it('wins over a datacenter ASN', () => {
      expect(trafficClassFrom({ cf: { asn: 16509 }, userAgent: 'curl/8.4.0' })).toBe('known_bot');
    });
  });

  describe('datacenter', () => {
    it.each([...DATACENTER_ASNS])('for ASN %d', (asn) => {
      expect(trafficClassFrom({ cf: { asn }, userAgent: BROWSER })).toBe('datacenter');
    });

    it.each([
      13335, // Cloudflare WARP
      36183, // Akamai (iCloud Private Relay)
      54113, // Fastly (iCloud Private Relay)
      15169, // Google (Google Fi)
    ])('not for consumer-carrying ASN %d', (asn) => {
      expect(DATACENTER_ASNS.has(asn)).toBe(false);
      expect(trafficClassFrom({ cf: { asn }, userAgent: BROWSER })).toBe('human');
    });

    it('not for an ASN that is not a number', () => {
      expect(trafficClassFrom({ cf: { asn: '16509' }, userAgent: BROWSER })).toBe('human');
    });
  });
});
