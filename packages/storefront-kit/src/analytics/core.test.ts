import { describe, expect, it } from 'vitest';
import { type AnalyticsContext, buildAnalyticsEvent, resolveAnalyticsConfig } from './core.js';

const CONTEXT: AnalyticsContext = { site: 'paco', utm: null };

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
          utm: { source: 'ig', medium: 'social', campaign: 'spring', content: 'hero' },
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
        path: '/wines',
      },
    });
  });

  it('never lets event properties re-author the acquisition', () => {
    const event = buildAnalyticsEvent(
      { type: 'page_viewed', path: '/' },
      { site: 'paco', utm: { source: 'email' } },
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
    it('builds slug, name and price in cents', () => {
      expect(
        buildAnalyticsEvent(
          {
            type: 'product_viewed',
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
          product_slug: 'cab-2022',
          product_name: 'Cabernet 2022',
          price_cents: 4500,
        },
      });
    });

    it('omits a blank name and a price that is not whole non-negative cents', () => {
      for (const priceCents of [45.5, -1, Number.NaN]) {
        expect(
          buildAnalyticsEvent(
            { type: 'product_viewed', productSlug: 'cab-2022', productName: ' ', priceCents },
            CONTEXT,
          )?.eventProperties,
        ).toEqual({ site: 'paco', product_slug: 'cab-2022' });
      }
    });

    it('rejects a missing slug', () => {
      expect(buildAnalyticsEvent({ type: 'product_viewed', productSlug: ' ' }, CONTEXT)).toBeNull();
    });
  });

  describe('product_added_to_cart', () => {
    it('adds the quantity to the product properties', () => {
      expect(
        buildAnalyticsEvent(
          { type: 'product_added_to_cart', productSlug: 'cab-2022', priceCents: 4500, quantity: 2 },
          CONTEXT,
        )?.eventProperties,
      ).toEqual({ site: 'paco', product_slug: 'cab-2022', price_cents: 4500, quantity: 2 });
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
        eventProperties: { site: 'paco', cart_item_count: 3, cart_subtotal_cents: 13500 },
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
