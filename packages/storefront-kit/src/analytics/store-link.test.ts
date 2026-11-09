import { describe, expect, it } from 'vitest';
import {
  type LinkClickGesture,
  opensLink,
  parseStoreDestination,
  resolveStoreOrigins,
  storeLinkClick,
} from './store-link.js';

const STORE = 'https://store.example.com';
const BASE = 'https://www.pacowinery.com/club';

describe('resolveStoreOrigins', () => {
  it('reduces one origin or a list of URLs to origins', () => {
    expect(resolveStoreOrigins(STORE)).toEqual([STORE]);
    expect(
      resolveStoreOrigins([' https://Store.Example.com/ ', 'http://localhost:8788/api']),
    ).toEqual([STORE, 'http://localhost:8788']);
  });

  it('throws naming an entry that is not an http(s) origin', () => {
    expect(() => resolveStoreOrigins([STORE, 'store.example.com'])).toThrow(
      /origins.*store\.example\.com/,
    );
    expect(() => resolveStoreOrigins('')).toThrow(/origins/);
    expect(() => resolveStoreOrigins('mailto:x@example.com')).toThrow(/origins/);
  });

  it('throws on no origins at all', () => {
    expect(() => resolveStoreOrigins([])).toThrow(/at least one/);
  });
});

describe('parseStoreDestination', () => {
  it.each([
    'club_join',
    'shop',
    'account',
    'reservation',
    'gift_card',
    'other',
  ])('keeps %s', (value) => {
    expect(parseStoreDestination(value)).toBe(value);
    expect(parseStoreDestination(` ${value} `)).toBe(value);
  });

  it.each([
    null,
    undefined,
    '',
    '  ',
    'Shop',
    'club-join',
    'checkout',
  ])('reads %j as other', (value) => {
    expect(parseStoreDestination(value)).toBe('other');
  });
});

describe('opensLink', () => {
  const gesture = (overrides: Partial<LinkClickGesture>): LinkClickGesture => ({
    eventType: 'click',
    button: 0,
    altKey: false,
    ...overrides,
  });

  it('counts a primary click and a middle click (auxclick)', () => {
    expect(opensLink(gesture({}))).toBe(true);
    expect(opensLink(gesture({ eventType: 'auxclick', button: 1 }))).toBe(true);
  });

  it('does not count a right click, Alt-click, or a middle click reported as click', () => {
    expect(opensLink(gesture({ eventType: 'auxclick', button: 2 }))).toBe(false);
    expect(opensLink(gesture({ altKey: true }))).toBe(false);
    expect(opensLink(gesture({ eventType: 'auxclick', button: 1, altKey: true }))).toBe(false);
    expect(opensLink(gesture({ button: 1 }))).toBe(false);
    expect(opensLink(gesture({ eventType: 'auxclick', button: 0 }))).toBe(false);
  });
});

describe('storeLinkClick', () => {
  const link = (href: string | null, destination: string | null = null) => ({
    href,
    destination,
    baseUrl: BASE,
  });

  it('builds the input for a store link: destination, store path only, page path', () => {
    expect(
      storeLinkClick(link(`${STORE}/clubs/reserve/join?utm_source=ig#top`, 'club_join'), '/club', [
        STORE,
      ]),
    ).toEqual({
      type: 'store_link_clicked',
      destination: 'club_join',
      linkPath: '/clubs/reserve/join',
      path: '/club',
    });
  });

  it('defaults a missing or unknown destination to other', () => {
    expect(storeLinkClick(link(`${STORE}/gift`), '/', [STORE])?.destination).toBe('other');
    expect(storeLinkClick(link(`${STORE}/gift`, 'giftcard'), '/', [STORE])?.destination).toBe(
      'other',
    );
  });

  it('matches any of several origins, by origin exactly', () => {
    const origins = [STORE, 'https://paco-v2.prettygood.live'];
    expect(storeLinkClick(link('https://paco-v2.prettygood.live/'), '/', origins)?.linkPath).toBe(
      '/',
    );
    expect(storeLinkClick(link('http://store.example.com/'), '/', origins)).toBeNull();
    expect(storeLinkClick(link('https://store.example.com:8443/'), '/', origins)).toBeNull();
    expect(storeLinkClick(link('https://other.example.com/'), '/', origins)).toBeNull();
  });

  it('is null for a site link, a missing or unparseable href', () => {
    expect(storeLinkClick(link('/wines'), '/', [STORE])).toBeNull();
    expect(storeLinkClick(link('#top'), '/', [STORE])).toBeNull();
    expect(storeLinkClick(link(null), '/', [STORE])).toBeNull();
    expect(storeLinkClick(link('https://'), '/', [STORE])).toBeNull();
  });

  it('resolves a relative href against the base URL', () => {
    expect(
      storeLinkClick({ href: '/account', destination: 'account', baseUrl: `${STORE}/x` }, '/', [
        STORE,
      ]),
    ).toMatchObject({ linkPath: '/account', destination: 'account' });
  });
});
