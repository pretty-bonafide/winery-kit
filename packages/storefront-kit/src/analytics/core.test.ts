import { describe, expect, it } from 'vitest';
import {
  type AnalyticsContext,
  type AnalyticsEventInput,
  type AnalyticsEventType,
  buildAnalyticsEvent,
  isPageExitEvent,
  resolveAnalyticsConfig,
  type StoreDestination,
} from './core.js';

const CONTEXT: AnalyticsContext = {
  site: 'paco',
  acquisition: { utm: null, referrerDomain: null },
};

describe('resolveAnalyticsConfig', () => {
  it('is disabled when no api key is given', () => {
    expect(resolveAnalyticsConfig({ site: 'paco' })).toEqual({ enabled: false });
  });

  it('enables with a trimmed key and site, defaulting the server zone to US', () => {
    expect(resolveAnalyticsConfig({ apiKey: ' key-123 ', site: ' paco ' })).toEqual({
      enabled: true,
      apiKey: 'key-123',
      site: 'paco',
      serverZone: 'US',
    });
  });

  it('keeps an explicit EU server zone', () => {
    expect(resolveAnalyticsConfig({ apiKey: 'key', site: 'paco', serverZone: 'EU' })).toMatchObject(
      {
        serverZone: 'EU',
      },
    );
  });

  it('throws on an explicitly empty or blank api key (misconfiguration, not "off")', () => {
    expect(() => resolveAnalyticsConfig({ apiKey: '', site: 'paco' })).toThrow(/apiKey/);
    expect(() => resolveAnalyticsConfig({ apiKey: '   ', site: 'paco' })).toThrow(/apiKey/);
  });

  it('throws on a blank site, with or without a key', () => {
    expect(() => resolveAnalyticsConfig({ apiKey: 'key', site: '' })).toThrow(/site/);
    expect(() => resolveAnalyticsConfig({ site: '  ' })).toThrow(/site/);
  });

  it('throws on an unknown server zone', () => {
    expect(() =>
      resolveAnalyticsConfig({
        apiKey: 'key',
        site: 'paco',
        serverZone: 'eu' as unknown as 'EU',
      }),
    ).toThrow(/serverZone/);
  });
});

describe('resolveAnalyticsConfig serverUrl', () => {
  it('leaves serverUrl off when unset (Amplitude default endpoint)', () => {
    expect(resolveAnalyticsConfig({ apiKey: 'key', site: 'paco' })).not.toHaveProperty('serverUrl');
  });

  it('keeps a same-origin path or an absolute https URL, trimmed', () => {
    expect(
      resolveAnalyticsConfig({ apiKey: 'key', site: 'paco', serverUrl: ' /api/e ' }),
    ).toMatchObject({ serverUrl: '/api/e' });
    expect(
      resolveAnalyticsConfig({ apiKey: 'key', site: 'paco', serverUrl: 'https://e.example.com/2' }),
    ).toMatchObject({ serverUrl: 'https://e.example.com/2' });
  });

  it.each([
    '',
    '  ',
    'api/e',
    '//evil.example/e',
    '/\\evil.example/e',
    'http://e.example.com',
    'javascript:alert(1)',
    'https://',
  ])('throws on %j, with or without a key', (serverUrl) => {
    expect(() => resolveAnalyticsConfig({ apiKey: 'key', site: 'paco', serverUrl })).toThrow(
      /serverUrl/,
    );
    expect(() => resolveAnalyticsConfig({ site: 'paco', serverUrl })).toThrow(/serverUrl/);
  });
});

describe('buildAnalyticsEvent', () => {
  it('reports the site and the stored utm params unchanged, prefixed', () => {
    expect(
      buildAnalyticsEvent(
        { type: 'page_viewed', path: '/wines' },
        {
          site: 'paco',
          acquisition: {
            utm: { source: 'ig', medium: 'social', campaign: 'spring', content: 'hero' },
            referrerDomain: 'l.instagram.com',
          },
        },
      ),
    ).toEqual({
      eventType: 'page_viewed',
      eventProperties: {
        site: 'paco',
        utm_source: 'ig',
        utm_medium: 'social',
        utm_campaign: 'spring',
        utm_content: 'hero',
        referrer_domain: 'l.instagram.com',
        channel: 'social',
        path: '/wines',
      },
    });
  });

  it('reports a referrer-only acquisition as referrer_domain (without www.) and its channel', () => {
    expect(
      buildAnalyticsEvent(
        { type: 'page_viewed', path: '/' },
        { site: 'paco', acquisition: { utm: null, referrerDomain: 'www.google.com' } },
      )?.eventProperties,
    ).toEqual({ site: 'paco', referrer_domain: 'google.com', channel: 'search', path: '/' });
  });

  it('always reports a channel, direct with no acquisition, and no referrer_domain', () => {
    const properties = buildAnalyticsEvent(
      { type: 'page_viewed', path: '/' },
      CONTEXT,
    )?.eventProperties;
    expect(properties).toEqual({ site: 'paco', channel: 'direct', path: '/' });
    expect(properties).not.toHaveProperty('referrer_domain');
  });

  it('adds the acquisition properties to every event type', () => {
    const context: AnalyticsContext = {
      site: 'paco',
      acquisition: { utm: { source: 'newsletter', medium: 'email' }, referrerDomain: null },
    };
    const inputs: AnalyticsEventInput[] = [
      { type: 'page_viewed', path: '/' },
      { type: 'product_viewed', surface: 'card', productSlug: 'cab-2022' },
      { type: 'product_added_to_cart', productSlug: 'cab-2022', quantity: 1 },
      { type: 'checkout_started', cartItemCount: 1, cartSubtotalCents: 4500 },
      { type: 'store_link_clicked', destination: 'shop', linkPath: '/', path: '/' },
    ];
    for (const input of inputs) {
      expect(buildAnalyticsEvent(input, context)?.eventProperties).toMatchObject({
        utm_source: 'newsletter',
        utm_medium: 'email',
        channel: 'email',
      });
    }
  });

  it('never lets event properties re-author the acquisition', () => {
    const event = buildAnalyticsEvent(
      { type: 'page_viewed', path: '/' },
      { site: 'paco', acquisition: { utm: { source: 'email' }, referrerDomain: null } },
    );
    expect(event?.eventProperties).not.toHaveProperty('utm_medium');
    expect(event?.eventProperties.utm_source).toBe('email');
  });

  describe('page_viewed', () => {
    it('drops the query string and hash from the path', () => {
      expect(
        buildAnalyticsEvent({ type: 'page_viewed', path: '/wines?utm_source=ig#top' }, CONTEXT)
          ?.eventProperties.path,
      ).toBe('/wines');
    });

    it('rejects a path that is not absolute', () => {
      expect(buildAnalyticsEvent({ type: 'page_viewed', path: 'wines' }, CONTEXT)).toBeNull();
      expect(buildAnalyticsEvent({ type: 'page_viewed', path: '' }, CONTEXT)).toBeNull();
    });
  });

  describe('product_viewed', () => {
    it('builds the surface, slug, name and price in cents', () => {
      expect(
        buildAnalyticsEvent(
          {
            type: 'product_viewed',
            surface: 'page',
            productSlug: 'cab-2022',
            productName: ' Cabernet 2022 ',
            priceCents: 4500,
          },
          CONTEXT,
        ),
      ).toEqual({
        eventType: 'product_viewed',
        eventProperties: {
          site: 'paco',
          channel: 'direct',
          surface: 'page',
          product_slug: 'cab-2022',
          product_name: 'Cabernet 2022',
          price_cents: 4500,
        },
      });
    });

    it('reports a card view as surface card', () => {
      expect(
        buildAnalyticsEvent(
          { type: 'product_viewed', surface: 'card', productSlug: 'cab-2022' },
          CONTEXT,
        )?.eventProperties,
      ).toEqual({ site: 'paco', channel: 'direct', surface: 'card', product_slug: 'cab-2022' });
    });

    it('omits a blank name and a price that is not whole non-negative cents', () => {
      for (const priceCents of [45.5, -1, Number.NaN]) {
        expect(
          buildAnalyticsEvent(
            {
              type: 'product_viewed',
              surface: 'page',
              productSlug: 'cab-2022',
              productName: ' ',
              priceCents,
            },
            CONTEXT,
          )?.eventProperties,
        ).toEqual({ site: 'paco', channel: 'direct', surface: 'page', product_slug: 'cab-2022' });
      }
    });

    it('rejects a missing slug', () => {
      expect(
        buildAnalyticsEvent({ type: 'product_viewed', surface: 'page', productSlug: ' ' }, CONTEXT),
      ).toBeNull();
    });

    it('rejects an unknown surface', () => {
      for (const surface of ['', 'pdp', 'Card']) {
        expect(
          buildAnalyticsEvent(
            {
              type: 'product_viewed',
              surface: surface as unknown as 'page',
              productSlug: 'cab-2022',
            },
            CONTEXT,
          ),
        ).toBeNull();
      }
    });
  });

  describe('product_added_to_cart', () => {
    it('adds the quantity to the product properties', () => {
      expect(
        buildAnalyticsEvent(
          { type: 'product_added_to_cart', productSlug: 'cab-2022', priceCents: 4500, quantity: 2 },
          CONTEXT,
        )?.eventProperties,
      ).toEqual({
        site: 'paco',
        channel: 'direct',
        product_slug: 'cab-2022',
        price_cents: 4500,
        quantity: 2,
      });
    });

    it('rejects a non-positive or fractional quantity', () => {
      for (const quantity of [0, -1, 1.5]) {
        expect(
          buildAnalyticsEvent(
            { type: 'product_added_to_cart', productSlug: 'cab-2022', quantity },
            CONTEXT,
          ),
        ).toBeNull();
      }
    });
  });

  describe('checkout_started', () => {
    it('reports item count and subtotal in cents', () => {
      expect(
        buildAnalyticsEvent(
          { type: 'checkout_started', cartItemCount: 3, cartSubtotalCents: 13500 },
          CONTEXT,
        ),
      ).toEqual({
        eventType: 'checkout_started',
        eventProperties: {
          site: 'paco',
          channel: 'direct',
          cart_item_count: 3,
          cart_subtotal_cents: 13500,
        },
      });
    });

    it('rejects counts that are not whole non-negative numbers', () => {
      expect(
        buildAnalyticsEvent(
          { type: 'checkout_started', cartItemCount: -1, cartSubtotalCents: 100 },
          CONTEXT,
        ),
      ).toBeNull();
      expect(
        buildAnalyticsEvent(
          { type: 'checkout_started', cartItemCount: 1, cartSubtotalCents: 99.5 },
          CONTEXT,
        ),
      ).toBeNull();
    });
  });
});

describe('buildAnalyticsEvent click ID and landing path', () => {
  it('reports click_id_type and landing_path when known, and the click ID channel', () => {
    expect(
      buildAnalyticsEvent(
        { type: 'page_viewed', path: '/shop' },
        {
          site: 'paco',
          acquisition: {
            utm: null,
            referrerDomain: 'google.com',
            clickId: 'google',
            landingPath: '/wines',
          },
        },
      )?.eventProperties,
    ).toEqual({
      site: 'paco',
      referrer_domain: 'google.com',
      click_id_type: 'google',
      landing_path: '/wines',
      channel: 'paid',
      path: '/shop',
    });
  });

  it('reports a direct visitor’s landing path with channel direct', () => {
    expect(
      buildAnalyticsEvent(
        { type: 'page_viewed', path: '/' },
        { site: 'paco', acquisition: { utm: null, referrerDomain: null, landingPath: '/visit' } },
      )?.eventProperties,
    ).toEqual({ site: 'paco', landing_path: '/visit', channel: 'direct', path: '/' });
  });

  it('leaves them off when unknown', () => {
    const properties = buildAnalyticsEvent(
      { type: 'page_viewed', path: '/' },
      CONTEXT,
    )?.eventProperties;
    expect(properties).not.toHaveProperty('click_id_type');
    expect(properties).not.toHaveProperty('landing_path');
  });
});

describe('buildAnalyticsEvent store_link_clicked', () => {
  it('reports the destination, the store link path and the page path', () => {
    expect(
      buildAnalyticsEvent(
        {
          type: 'store_link_clicked',
          destination: 'club_join',
          linkPath: '/clubs/reserve/join',
          path: '/club',
        },
        {
          site: 'paco',
          acquisition: { utm: { source: 'newsletter', medium: 'email' }, referrerDomain: null },
        },
      ),
    ).toEqual({
      eventType: 'store_link_clicked',
      eventProperties: {
        site: 'paco',
        utm_source: 'newsletter',
        utm_medium: 'email',
        channel: 'email',
        destination: 'club_join',
        link_path: '/clubs/reserve/join',
        path: '/club',
      },
    });
  });

  it.each<StoreDestination>([
    'club_join',
    'shop',
    'account',
    'reservation',
    'gift_card',
    'other',
  ])('accepts destination %s', (destination) => {
    expect(
      buildAnalyticsEvent(
        { type: 'store_link_clicked', destination, linkPath: '/', path: '/' },
        CONTEXT,
      )?.eventProperties.destination,
    ).toBe(destination);
  });

  it('drops the query string and hash from both paths', () => {
    expect(
      buildAnalyticsEvent(
        {
          type: 'store_link_clicked',
          destination: 'shop',
          linkPath: '/wines?utm_source=ig#x',
          path: '/?a=1',
        },
        CONTEXT,
      )?.eventProperties,
    ).toMatchObject({ link_path: '/wines', path: '/' });
  });

  it('rejects an unknown destination or a path that is not one', () => {
    const valid = {
      type: 'store_link_clicked',
      destination: 'shop',
      linkPath: '/',
      path: '/',
    } as const;
    expect(
      buildAnalyticsEvent(
        { ...valid, destination: 'Shop' as unknown as StoreDestination },
        CONTEXT,
      ),
    ).toBeNull();
    expect(buildAnalyticsEvent({ ...valid, linkPath: '' }, CONTEXT)).toBeNull();
    expect(buildAnalyticsEvent({ ...valid, path: 'club' }, CONTEXT)).toBeNull();
  });
});

describe('isPageExitEvent', () => {
  it.each<[AnalyticsEventType, boolean]>([
    ['store_link_clicked', true],
    ['checkout_started', true],
    ['page_viewed', false],
    ['product_viewed', false],
    ['product_added_to_cart', false],
  ])('%s → %s', (eventType, expected) => {
    expect(isPageExitEvent(eventType)).toBe(expected);
  });
});
