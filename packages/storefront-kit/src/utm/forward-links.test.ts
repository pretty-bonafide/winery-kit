import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decorateUtmLinks } from './forward-links';
import { DEFAULT_UTM_STORAGE_KEY } from './storage';

const STORE = 'https://store.example.com';
const NOW = new Date('2026-06-09T12:00:00.000Z');
const now = () => NOW;

function seedStored(params: Record<string, string>) {
  window.localStorage.setItem(
    DEFAULT_UTM_STORAGE_KEY,
    JSON.stringify({ params, capturedAt: NOW.toISOString() }),
  );
}

/** UTM params on an anchor's (post-decoration) href, keyed without the `utm_` prefix. */
function utmOf(anchor: Element | null): Record<string, string> {
  const href = anchor?.getAttribute('href') ?? '';
  const search = new URL(href).searchParams;
  const out: Record<string, string> = {};
  for (const [key, value] of search) {
    if (key.startsWith('utm_')) out[key.slice(4)] = value;
  }
  return out;
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('decorateUtmLinks', () => {
  it('preserves acquisition UTMs and only gap-fills missing keys', () => {
    seedStored({ source: 'google', medium: 'cpc', campaign: 'spring' });
    document.body.innerHTML = `<a id="join" href="${STORE}/clubs"
      data-utm-campaign="club" data-utm-content="clubs-primary"></a>`;

    decorateUtmLinks({ origins: STORE, defaults: { source: 'site', medium: 'referral' }, now });

    expect(utmOf(document.getElementById('join'))).toEqual({
      source: 'google', // acquisition beats the `site` default
      medium: 'cpc', // acquisition beats the `referral` default
      campaign: 'spring', // acquisition beats the per-link `club`
      content: 'clubs-primary', // only the gap is filled, from the per-link attr
    });
  });

  it('falls back to per-link then site defaults when there is no stored attribution', () => {
    document.body.innerHTML = `<a id="join" href="${STORE}/clubs"
      data-utm-campaign="club" data-utm-content="clubs-primary"></a>`;

    decorateUtmLinks({ origins: STORE, defaults: { source: 'site', medium: 'referral' }, now });

    expect(utmOf(document.getElementById('join'))).toEqual({
      source: 'site',
      medium: 'referral',
      campaign: 'club',
      content: 'clubs-primary',
    });
  });

  it('leaves links to other origins untouched', () => {
    seedStored({ source: 'google' });
    document.body.innerHTML = `<a id="ext" href="https://other.example.com/path"></a>`;

    decorateUtmLinks({ origins: STORE, now });

    expect(document.getElementById('ext')?.getAttribute('href')).toBe(
      'https://other.example.com/path',
    );
  });

  it('never overwrites params already present on the href', () => {
    seedStored({ source: 'google', medium: 'cpc' });
    document.body.innerHTML = `<a id="cms" href="${STORE}/clubs?utm_source=cms"></a>`;

    decorateUtmLinks({ origins: STORE, defaults: { medium: 'referral' }, now });

    expect(utmOf(document.getElementById('cms'))).toEqual({
      source: 'cms', // explicit href value wins over stored + defaults
      medium: 'cpc', // stored fills the gap
    });
  });

  it('is idempotent across repeated runs', () => {
    seedStored({ source: 'google' });
    document.body.innerHTML = `<a id="join" href="${STORE}/clubs"></a>`;

    decorateUtmLinks({ origins: STORE, now });
    const afterFirst = document.getElementById('join')?.getAttribute('href');
    decorateUtmLinks({ origins: STORE, now });

    expect(document.getElementById('join')?.getAttribute('href')).toBe(afterFirst);
  });

  it('decorates links across multiple configured origins', () => {
    seedStored({ source: 'google' });
    const SECOND = 'https://shop.example.com';
    document.body.innerHTML = `<a id="a" href="${STORE}/clubs"></a><a id="b" href="${SECOND}/cart"></a>`;

    decorateUtmLinks({ origins: [STORE, SECOND], now });

    expect(utmOf(document.getElementById('a'))).toEqual({ source: 'google' });
    expect(utmOf(document.getElementById('b'))).toEqual({ source: 'google' });
  });

  it('ignores non-http links and never throws', () => {
    document.body.innerHTML = `<a id="mail" href="mailto:hi@example.com"></a>`;

    expect(() =>
      decorateUtmLinks({ origins: STORE, defaults: { source: 'site' }, now }),
    ).not.toThrow();
    expect(document.getElementById('mail')?.getAttribute('href')).toBe('mailto:hi@example.com');
  });
});
