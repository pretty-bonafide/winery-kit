// Amplitude shell. The SDK is an OPTIONAL peer, loaded with a dynamic import
// only when a site calls initAnalytics with a key, so sites without analytics
// ship none of it. Only `/analytics` reaches this module — the kit's hooks emit
// through tracker.ts, which knows nothing of the SDK.
import type { Types } from '@amplitude/analytics-browser';
import { type AnalyticsConfig, type InitAnalyticsOptions, resolveAnalyticsConfig } from './core.js';
import { type AnalyticsSink, startTracker } from './tracker.js';

type EnabledAnalyticsConfig = Extract<AnalyticsConfig, { enabled: true }>;

/**
 * Cookie-light start: no autocapture (page views, attribution, clicks — our own
 * builders own the schema, and attribution comes from the kit's stored UTMs),
 * no remote config that could switch autocapture back on from the dashboard,
 * identity in localStorage rather than cookies, and no IP address on events.
 * A `serverUrl` path is resolved against this page's origin.
 */
function amplitudeOptions(config: EnabledAnalyticsConfig): Types.BrowserOptions {
  return {
    serverZone: config.serverZone,
    ...(config.serverUrl !== undefined && {
      serverUrl: new URL(config.serverUrl, window.location.origin).href,
    }),
    autocapture: false,
    remoteConfig: { fetchRemoteConfig: false },
    identityStorage: 'localStorage',
    trackingOptions: { ipAddress: false },
  };
}

async function loadAmplitudeSink(config: EnabledAnalyticsConfig): Promise<AnalyticsSink> {
  const amplitude = await import('@amplitude/analytics-browser');
  const client = amplitude.createInstance();
  await client.init(config.apiKey, amplitudeOptions(config)).promise;
  return {
    send(event) {
      client.track(event.eventType, event.eventProperties);
    },
    // The fetch transport sends with `keepalive` (bodies up to 16 KB), so the
    // upload survives the navigation that follows, and it posts uncompressed
    // application/json, which /analytics-proxy accepts. (The SDK's beacon
    // transport would post text/plain, which the proxy refuses.)
    flush() {
      void client.flush().promise.catch(() => {});
    },
  };
}

/**
 * Starts analytics for this page. Without an `apiKey` it is a deliberate no-op
 * and every `track` does nothing. Misconfiguration (an empty key or site)
 * throws synchronously. The returned promise resolves once the SDK is ready —
 * or has failed to load, which warns and never breaks the page.
 */
export function initAnalytics(options: InitAnalyticsOptions): Promise<void> {
  const config = resolveAnalyticsConfig(options);
  if (!config.enabled || typeof window === 'undefined') return Promise.resolve();
  return startTracker(config.site, () => loadAmplitudeSink(config));
}
