import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UTM_TTL_MS } from './core';
import {
  captureUtmFromLocation,
  readStoredUtm,
  DEFAULT_UTM_STORAGE_KEY as UTM_STORAGE_KEY,
} from './storage';

const NOW = new Date('2026-06-09T12:00:00.000Z');
const now = () => NOW;

function createLocalStorageStub() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
}

function stubWindow(search: string, localStorage = createLocalStorageStub()) {
  vi.stubGlobal('window', { location: { search }, localStorage });
  return localStorage;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('captureUtmFromLocation', () => {
  it('persists utm params from the location search', () => {
    const localStorage = stubWindow('?utm_source=ig&utm_campaign=spring');

    captureUtmFromLocation(now);

    expect(JSON.parse(localStorage.getItem(UTM_STORAGE_KEY) ?? '')).toEqual({
      params: { source: 'ig', campaign: 'spring' },
      capturedAt: NOW.toISOString(),
    });
  });

  it('replaces a previously stored record (last-touch)', () => {
    const localStorage = stubWindow('?utm_source=ig');
    localStorage.setItem(
      UTM_STORAGE_KEY,
      JSON.stringify({ params: { source: 'email', medium: 'newsletter' }, capturedAt: NOW }),
    );

    captureUtmFromLocation(now);

    expect(JSON.parse(localStorage.getItem(UTM_STORAGE_KEY) ?? '')).toEqual({
      params: { source: 'ig' },
      capturedAt: NOW.toISOString(),
    });
  });

  it('keeps the stored record when the visit has no utm params', () => {
    const record = { params: { source: 'email' }, capturedAt: NOW.toISOString() };
    const localStorage = stubWindow('?preview=true');
    localStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(record));

    captureUtmFromLocation(now);

    expect(JSON.parse(localStorage.getItem(UTM_STORAGE_KEY) ?? '')).toEqual(record);
  });

  it('removes an expired record', () => {
    const localStorage = stubWindow('');
    localStorage.setItem(
      UTM_STORAGE_KEY,
      JSON.stringify({
        params: { source: 'email' },
        capturedAt: new Date(NOW.getTime() - UTM_TTL_MS - 1).toISOString(),
      }),
    );

    captureUtmFromLocation(now);

    expect(localStorage.getItem(UTM_STORAGE_KEY)).toBeNull();
  });

  it('is a no-op without a window (SSR)', () => {
    expect(() => captureUtmFromLocation(now)).not.toThrow();
  });

  it('swallows storage failures', () => {
    stubWindow('?utm_source=ig', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    });

    expect(() => captureUtmFromLocation(now)).not.toThrow();
  });
});

describe('readStoredUtm', () => {
  it('returns stored params', () => {
    const localStorage = stubWindow('');
    localStorage.setItem(
      UTM_STORAGE_KEY,
      JSON.stringify({ params: { source: 'ig' }, capturedAt: NOW.toISOString() }),
    );

    expect(readStoredUtm(now)).toEqual({ source: 'ig' });
  });

  it('returns null and removes the key when expired', () => {
    const localStorage = stubWindow('');
    localStorage.setItem(
      UTM_STORAGE_KEY,
      JSON.stringify({
        params: { source: 'ig' },
        capturedAt: new Date(NOW.getTime() - UTM_TTL_MS - 1).toISOString(),
      }),
    );

    expect(readStoredUtm(now)).toBeNull();
    expect(localStorage.getItem(UTM_STORAGE_KEY)).toBeNull();
  });

  it('returns null for corrupt content, missing key, SSR, and storage failures', () => {
    const localStorage = stubWindow('');
    localStorage.setItem(UTM_STORAGE_KEY, 'not json');
    expect(readStoredUtm(now)).toBeNull();

    stubWindow('');
    expect(readStoredUtm(now)).toBeNull();

    stubWindow('', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {},
      removeItem: () => {},
    });
    expect(readStoredUtm(now)).toBeNull();

    vi.unstubAllGlobals();
    expect(readStoredUtm(now)).toBeNull();
  });
});

// Referrer capture reads `document.referrer` once per module instance (one per
// document), so each test loads a fresh copy of the shell.
async function loadStorage() {
  vi.resetModules();
  return import('./storage.js');
}

function stubLanding({
  search = '',
  hostname = 'www.pacowinery.com',
  pathname,
  referrer = '',
  localStorage = createLocalStorageStub(),
}: {
  search?: string;
  hostname?: string;
  pathname?: string;
  referrer?: string;
  localStorage?: ReturnType<typeof createLocalStorageStub>;
}) {
  const location = { search, hostname, pathname };
  vi.stubGlobal('window', { location, localStorage });
  vi.stubGlobal('document', { referrer });
  return { localStorage, location };
}

const storedRecord = (
  localStorage: ReturnType<typeof createLocalStorageStub>,
  key = UTM_STORAGE_KEY,
) => JSON.parse(localStorage.getItem(key) ?? 'null');

describe('captureUtmFromLocation referrer capture', () => {
  it('stores an external referrer as its hostname only, with empty params', async () => {
    const { captureUtmFromLocation } = await loadStorage();
    const { localStorage } = stubLanding({
      referrer: 'https://www.google.com:443/search?q=paco+winery',
    });

    captureUtmFromLocation(now);

    expect(storedRecord(localStorage)).toEqual({
      params: {},
      referrerDomain: 'google.com',
      capturedAt: NOW.toISOString(),
    });
  });

  it('stores both the UTMs and the referrer of one landing', async () => {
    const { captureUtmFromLocation } = await loadStorage();
    const { localStorage } = stubLanding({
      search: '?utm_source=ig&utm_medium=social',
      referrer: 'https://l.instagram.com/?u=x',
    });

    captureUtmFromLocation(now);

    expect(storedRecord(localStorage)).toEqual({
      params: { source: 'ig', medium: 'social' },
      referrerDomain: 'l.instagram.com',
      capturedAt: NOW.toISOString(),
    });
  });

  it('replaces an old UTM record with a referral (last touch)', async () => {
    const { captureUtmFromLocation } = await loadStorage();
    const { localStorage } = stubLanding({ referrer: 'https://www.winespectator.com/article' });
    localStorage.setItem(
      UTM_STORAGE_KEY,
      JSON.stringify({ params: { source: 'email', medium: 'newsletter' }, capturedAt: NOW }),
    );

    captureUtmFromLocation(now);

    expect(storedRecord(localStorage)).toEqual({
      params: {},
      referrerDomain: 'winespectator.com',
      capturedAt: NOW.toISOString(),
    });
  });

  it.each([
    ['no referrer', ''],
    ['the same host', 'https://www.pacowinery.com/wines'],
    ['a host on the same site domain', 'https://store.pacowinery.com/cart'],
    ['an invalid referrer', 'not a url'],
  ])('keeps the stored record for %s', async (_label, referrer) => {
    const { captureUtmFromLocation } = await loadStorage();
    const record = { params: { source: 'email' }, capturedAt: NOW.toISOString() };
    const { localStorage } = stubLanding({ referrer });
    localStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(record));

    captureUtmFromLocation(now);

    expect(storedRecord(localStorage)).toEqual(record);
  });

  it('ignores a referrer from a configured internal host (origin or hostname)', async () => {
    const { captureUtmFromLocation, configureUtmStorage } = await loadStorage();
    configureUtmStorage({ internalHosts: ['https://paco-v2.prettygood.live', 'auth.example.net'] });
    const record = { params: { source: 'email' }, capturedAt: NOW.toISOString() };
    const { localStorage } = stubLanding({ referrer: 'https://paco-v2.prettygood.live/account' });
    localStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(record));

    captureUtmFromLocation(now);

    expect(storedRecord(localStorage)).toEqual(record);
  });

  it('keeps configured internal hosts when a later call sets only the storage key', async () => {
    const { captureUtmFromLocation, configureUtmStorage, getUtmStorageKey } = await loadStorage();
    configureUtmStorage({ internalHosts: ['paco-v2.prettygood.live'] });
    configureUtmStorage({ storageKey: 'paco_utm_v1' });
    const { localStorage } = stubLanding({ referrer: 'https://paco-v2.prettygood.live/' });

    captureUtmFromLocation(now);

    expect(getUtmStorageKey()).toBe('paco_utm_v1');
    expect(localStorage.getItem('paco_utm_v1')).toBeNull();
  });

  it('captures referrers with an existing storageKey-only configuration', async () => {
    const { captureUtmFromLocation, configureUtmStorage } = await loadStorage();
    configureUtmStorage({ storageKey: 'paco_utm_v1' });
    const { localStorage } = stubLanding({ referrer: 'https://duckduckgo.com/' });

    captureUtmFromLocation(now);

    expect(storedRecord(localStorage, 'paco_utm_v1')).toEqual({
      params: {},
      referrerDomain: 'duckduckgo.com',
      capturedAt: NOW.toISOString(),
    });
  });

  it('throws on an invalid internal host', async () => {
    const { configureUtmStorage } = await loadStorage();
    expect(() => configureUtmStorage({ internalHosts: ['not a host'] })).toThrow(/internalHosts/);
  });

  it('reads the referrer only on the first capture of a document (Client Router)', async () => {
    const { captureUtmFromLocation } = await loadStorage();
    const { localStorage, location } = stubLanding({
      search: '?utm_source=newsletter&utm_medium=email',
      referrer: 'https://mail.google.com/',
    });
    captureUtmFromLocation(now);

    // A client-side navigation: new URL without UTMs, same document.referrer.
    location.search = '';
    captureUtmFromLocation(() => new Date(NOW.getTime() + 60_000));

    expect(storedRecord(localStorage)).toEqual({
      params: { source: 'newsletter', medium: 'email' },
      referrerDomain: 'mail.google.com',
      capturedAt: NOW.toISOString(),
    });
  });
});

describe('readStoredAcquisition', () => {
  it('returns the stored UTMs and referrer', async () => {
    const { readStoredAcquisition } = await loadStorage();
    const { localStorage } = stubLanding({});
    localStorage.setItem(
      UTM_STORAGE_KEY,
      JSON.stringify({
        params: { source: 'ig' },
        referrerDomain: 'l.instagram.com',
        capturedAt: NOW.toISOString(),
      }),
    );

    expect(readStoredAcquisition(now)).toEqual({
      utm: { source: 'ig' },
      referrerDomain: 'l.instagram.com',
    });
  });

  it('returns no acquisition (and removes the key) when expired', async () => {
    const { readStoredAcquisition } = await loadStorage();
    const { localStorage } = stubLanding({});
    localStorage.setItem(
      UTM_STORAGE_KEY,
      JSON.stringify({
        params: {},
        referrerDomain: 'www.google.com',
        capturedAt: new Date(NOW.getTime() - UTM_TTL_MS - 1).toISOString(),
      }),
    );

    expect(readStoredAcquisition(now)).toEqual({ utm: null, referrerDomain: null });
    expect(localStorage.getItem(UTM_STORAGE_KEY)).toBeNull();
  });

  it('returns no acquisition without a window or with failing storage', async () => {
    const { readStoredAcquisition } = await loadStorage();
    vi.stubGlobal('window', undefined);
    expect(readStoredAcquisition(now)).toEqual({ utm: null, referrerDomain: null });

    stubWindow('', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {},
      removeItem: () => {},
    });
    expect(readStoredAcquisition(now)).toEqual({ utm: null, referrerDomain: null });
  });
});

describe('readStoredUtm with a referrer-only record', () => {
  it('returns null, so forwarded links and checkout carry no empty UTMs', () => {
    const localStorage = stubWindow('');
    localStorage.setItem(
      UTM_STORAGE_KEY,
      JSON.stringify({ params: {}, referrerDomain: 'www.google.com', capturedAt: NOW }),
    );

    expect(readStoredUtm(now)).toBeNull();
    expect(localStorage.getItem(UTM_STORAGE_KEY)).not.toBeNull();
  });
});

describe('captureUtmFromLocation click IDs and landing path', () => {
  it('stores the click ID type (never its value) and the landing path as a new touch', async () => {
    const { captureUtmFromLocation } = await loadStorage();
    const { localStorage } = stubLanding({
      search: '?gclid=Cj0KCQ-secret',
      pathname: '/wines/cab-2022',
      referrer: 'https://www.google.com/',
    });
    localStorage.setItem(
      UTM_STORAGE_KEY,
      JSON.stringify({ params: { source: 'email' }, capturedAt: NOW.toISOString() }),
    );

    captureUtmFromLocation(now);

    expect(storedRecord(localStorage)).toEqual({
      params: {},
      referrerDomain: 'google.com',
      clickId: 'google',
      landingPath: '/wines/cab-2022',
      capturedAt: NOW.toISOString(),
    });
    expect(localStorage.getItem(UTM_STORAGE_KEY)).not.toContain('Cj0KCQ');
  });

  it('stores a direct landing’s path when nothing is stored', async () => {
    const { captureUtmFromLocation, readStoredAcquisition } = await loadStorage();
    const { localStorage } = stubLanding({ pathname: '/visit' });

    captureUtmFromLocation(now);

    expect(storedRecord(localStorage)).toEqual({
      params: {},
      landingPath: '/visit',
      capturedAt: NOW.toISOString(),
    });
    expect(readStoredAcquisition(now)).toEqual({
      utm: null,
      referrerDomain: null,
      landingPath: '/visit',
    });
    expect(readStoredUtm(now)).toBeNull();
  });

  it('keeps the first landing path through later direct pages (Client Router)', async () => {
    const { captureUtmFromLocation } = await loadStorage();
    const { localStorage, location } = stubLanding({
      search: '?utm_source=ig&utm_medium=social',
      pathname: '/wines',
    });
    captureUtmFromLocation(now);

    location.search = '';
    location.pathname = '/shop';
    captureUtmFromLocation(() => new Date(NOW.getTime() + 60_000));

    expect(storedRecord(localStorage)).toEqual({
      params: { source: 'ig', medium: 'social' },
      landingPath: '/wines',
      capturedAt: NOW.toISOString(),
    });
  });

  it('never replaces an existing record with a direct landing', async () => {
    const { captureUtmFromLocation } = await loadStorage();
    const record = { params: {}, referrerDomain: 'google.com', capturedAt: NOW.toISOString() };
    const { localStorage } = stubLanding({ pathname: '/shop' });
    localStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(record));

    captureUtmFromLocation(now);

    expect(storedRecord(localStorage)).toEqual(record);
  });

  it('normalizes a 0.5.0 record with a www. referrer when it is read', async () => {
    const { readStoredAcquisition } = await loadStorage();
    const { localStorage } = stubLanding({});
    localStorage.setItem(
      UTM_STORAGE_KEY,
      JSON.stringify({ params: {}, referrerDomain: 'www.google.com', capturedAt: NOW }),
    );

    expect(readStoredAcquisition(now)).toEqual({ utm: null, referrerDomain: 'google.com' });
  });
});
