import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_UTM_STORAGE_KEY } from '../utm/storage.js';

const sdk = vi.hoisted(() => {
  const client = { init: vi.fn(), track: vi.fn() };
  return { client, createInstance: vi.fn(() => client) };
});

vi.mock('@amplitude/analytics-browser', () => ({ createInstance: sdk.createInstance }));

// The tracker is page-scoped module state; each test loads a fresh copy.
async function loadAnalytics() {
  vi.resetModules();
  return import('./index.js');
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  sdk.createInstance.mockClear();
  sdk.client.init.mockReset();
  sdk.client.track.mockReset();
  sdk.client.init.mockReturnValue({ promise: Promise.resolve() });
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('initAnalytics', () => {
  it('is a no-op without an api key: no SDK load, track does nothing', async () => {
    const { initAnalytics, track } = await loadAnalytics();

    await initAnalytics({ site: 'paco' });
    track({ type: 'page_viewed', path: '/' });
    await flush();

    expect(sdk.createInstance).not.toHaveBeenCalled();
    expect(sdk.client.track).not.toHaveBeenCalled();
  });

  it('throws synchronously on an explicitly empty api key', async () => {
    const { initAnalytics } = await loadAnalytics();
    expect(() => initAnalytics({ apiKey: '', site: 'paco' })).toThrow(/apiKey/);
    expect(sdk.createInstance).not.toHaveBeenCalled();
  });

  it('initializes the SDK cookie-light: no autocapture, no remote config, localStorage, no IP', async () => {
    const { initAnalytics } = await loadAnalytics();

    await initAnalytics({ apiKey: 'key-123', site: 'paco', serverZone: 'EU' });

    expect(sdk.client.init).toHaveBeenCalledWith('key-123', {
      serverZone: 'EU',
      autocapture: false,
      remoteConfig: { fetchRemoteConfig: false },
      identityStorage: 'localStorage',
      trackingOptions: { ipAddress: false },
    });
  });

  it('queues events tracked before the SDK is ready and flushes them in order', async () => {
    const ready = deferred();
    sdk.client.init.mockReturnValue({ promise: ready.promise });
    const { initAnalytics, track } = await loadAnalytics();

    const initialized = initAnalytics({ apiKey: 'key', site: 'paco' });
    track({ type: 'page_viewed', path: '/wines' });
    track({ type: 'product_viewed', productSlug: 'cab-2022' });
    await flush();
    expect(sdk.client.track).not.toHaveBeenCalled();

    ready.resolve();
    await initialized;

    expect(sdk.client.track.mock.calls).toEqual([
      ['page_viewed', { site: 'paco', path: '/wines' }],
      ['product_viewed', { site: 'paco', product_slug: 'cab-2022' }],
    ]);

    track({ type: 'checkout_started', cartItemCount: 1, cartSubtotalCents: 4500 });
    expect(sdk.client.track).toHaveBeenLastCalledWith('checkout_started', {
      site: 'paco',
      cart_item_count: 1,
      cart_subtotal_cents: 4500,
    });
  });

  it('attaches the stored acquisition to every event', async () => {
    window.localStorage.setItem(
      DEFAULT_UTM_STORAGE_KEY,
      JSON.stringify({
        params: { source: 'ig', medium: 'social' },
        capturedAt: new Date().toISOString(),
      }),
    );
    const { initAnalytics, track } = await loadAnalytics();

    await initAnalytics({ apiKey: 'key', site: 'paco' });
    track({ type: 'page_viewed', path: '/' });

    expect(sdk.client.track).toHaveBeenCalledWith('page_viewed', {
      site: 'paco',
      utm_source: 'ig',
      utm_medium: 'social',
      path: '/',
    });
  });

  it('starts once per page; a second call reuses the first', async () => {
    const { initAnalytics } = await loadAnalytics();

    const first = initAnalytics({ apiKey: 'key', site: 'paco' });
    const second = initAnalytics({ apiKey: 'key', site: 'paco' });

    expect(second).toBe(first);
    await first;
    expect(sdk.createInstance).toHaveBeenCalledTimes(1);
  });

  it('drops events and warns once when the SDK fails to load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sdk.client.init.mockReturnValue({ promise: Promise.reject(new Error('blocked')) });
    const { initAnalytics, track } = await loadAnalytics();

    const initialized = initAnalytics({ apiKey: 'key', site: 'paco' });
    track({ type: 'page_viewed', path: '/' });
    await expect(initialized).resolves.toBeUndefined();
    track({ type: 'page_viewed', path: '/wines' });

    expect(sdk.client.track).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('never throws when the SDK throws on send', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sdk.client.track.mockImplementation(() => {
      throw new Error('boom');
    });
    const { initAnalytics, track } = await loadAnalytics();

    await initAnalytics({ apiKey: 'key', site: 'paco' });

    expect(() => track({ type: 'page_viewed', path: '/' })).not.toThrow();
    expect(() => track({ type: 'page_viewed', path: '/wines' })).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('drops (and warns about) an invalid event without sending it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { initAnalytics, track } = await loadAnalytics();

    await initAnalytics({ apiKey: 'key', site: 'paco' });
    track({ type: 'product_added_to_cart', productSlug: 'cab-2022', quantity: 0 });

    expect(sdk.client.track).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('product_added_to_cart'),
      expect.anything(),
    );
  });
});

describe('track', () => {
  it('does nothing when analytics was never initialized', async () => {
    const { track } = await loadAnalytics();
    expect(() => track({ type: 'page_viewed', path: '/' })).not.toThrow();
    expect(sdk.client.track).not.toHaveBeenCalled();
  });
});

describe('trackPageView', () => {
  it('reports the current pathname without the query string', async () => {
    window.history.replaceState(null, '', '/wines/cab-2022?utm_source=ig');
    const { initAnalytics, trackPageView } = await loadAnalytics();

    await initAnalytics({ apiKey: 'key', site: 'paco' });
    trackPageView();

    expect(sdk.client.track).toHaveBeenCalledWith('page_viewed', {
      site: 'paco',
      path: '/wines/cab-2022',
    });
  });
});
