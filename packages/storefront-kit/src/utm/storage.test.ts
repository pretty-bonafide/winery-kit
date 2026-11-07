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
