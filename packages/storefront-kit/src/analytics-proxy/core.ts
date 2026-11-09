// Pure core of the first-party Amplitude forwarder: what to do with an upload
// request, and what the forwarded body looks like. No I/O — forward.ts reads the
// request and talks to Amplitude.
//
// It is never an open proxy: the upstream is fixed by server zone, and only the
// body travels (no client headers, cookies or IP). The server adds two things:
// the visitor's city-level location and a `traffic_class` event property
// (human, bot or datacenter) for dashboards to filter on. The user agent and
// ASN it is computed from are never forwarded.
import type { AmplitudeServerZone } from '../analytics/core.js';

/** Amplitude's HTTP V2 API, which the browser SDK posts to by default. */
export const AMPLITUDE_UPLOAD_URLS: Record<AmplitudeServerZone, string> = {
  US: 'https://api2.amplitude.com/2/httpapi',
  EU: 'https://api.eu.amplitude.com/2/httpapi',
};

/** Amplitude rejects HTTP V2 uploads over 1 MB. */
export const UPLOAD_LIMIT_BYTES = 1_000_000;

export interface UploadHead {
  method: string;
  contentType: string | null;
  contentEncoding: string | null;
  contentLength: string | null;
}

/** Where the visitor is, at city level, as the edge reports it. */
export interface VisitorLocation {
  /** English country name, e.g. `United States`. */
  country?: string;
  /** Full region name, e.g. `California`. */
  region?: string;
  city?: string;
}

/**
 * Who sent the upload, as the edge sees it. The first matching rule wins:
 * `verified_bot` (Cloudflare's verified bots), `known_bot` (a low Bot
 * Management score, or a user agent that names itself a bot), `datacenter` (a
 * major cloud or hosting network) and otherwise `human`.
 */
export type TrafficClass = 'verified_bot' | 'known_bot' | 'datacenter' | 'human';

export type UploadRejection = {
  action: 'reject';
  status: 400 | 405 | 413 | 415;
  message: string;
};

export type HeadDecision = UploadRejection | { action: 'read-body' };

export type BodyDecision = UploadRejection | { action: 'forward'; url: string; body: string };

export function uploadUrlFor(serverZone: AmplitudeServerZone): string {
  const url = AMPLITUDE_UPLOAD_URLS[serverZone];
  if (!url) {
    throw new Error(
      `forwardToAmplitude: unknown \`serverZone\` "${serverZone}" (expected US or EU).`,
    );
  }
  return url;
}

/** Decides from the method and headers alone, before any of the body is read. */
export function decideUploadHead(head: UploadHead): HeadDecision {
  if (head.method.toUpperCase() !== 'POST') {
    return { action: 'reject', status: 405, message: 'Method not allowed.' };
  }
  // The SDK's fetch transport sends plain JSON; a body we can't read can't be
  // enriched, so anything else (sendBeacon's text/plain, gzip) is refused.
  const mediaType = head.contentType?.split(';', 1)[0]?.trim().toLowerCase();
  const encoding = head.contentEncoding?.trim().toLowerCase();
  if (mediaType !== 'application/json' || (encoding && encoding !== 'identity')) {
    return {
      action: 'reject',
      status: 415,
      message: 'Expected an uncompressed application/json body.',
    };
  }
  const length = head.contentLength === null ? Number.NaN : Number(head.contentLength);
  if (length > UPLOAD_LIMIT_BYTES) return tooLarge();
  return { action: 'read-body' };
}

/**
 * Decides from the body: refuses one over the limit or that isn't JSON, and
 * otherwise forwards it without any `ip`, with the visitor's location and with
 * the `traffic_class` event property on every event.
 */
export function decideUploadBody(
  body: Uint8Array,
  context: {
    serverZone: AmplitudeServerZone;
    location: VisitorLocation;
    trafficClass: TrafficClass;
  },
): BodyDecision {
  if (body.byteLength > UPLOAD_LIMIT_BYTES) return tooLarge();

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    return { action: 'reject', status: 400, message: 'The body is not valid JSON.' };
  }

  return {
    action: 'forward',
    url: uploadUrlFor(context.serverZone),
    body: JSON.stringify(
      withTrafficClass(
        withVisitorLocation(withoutIp(payload), context.location),
        context.trafficClass,
      ),
    ),
  };
}

/**
 * Narrows Cloudflare's `request.cf` to a city-level location: country as an
 * English name, region and city as given. Coordinates, postal code and metro
 * code are left out on purpose. Unknown (`XX`) and Tor (`T1`) countries are
 * dropped.
 */
export function visitorLocationFromCf(cf: unknown): VisitorLocation {
  if (typeof cf !== 'object' || cf === null) return {};
  const { country, region, city } = cf as Record<string, unknown>;
  const location: VisitorLocation = {};
  const countryName = typeof country === 'string' ? countryNameFor(country) : undefined;
  if (countryName) location.country = countryName;
  if (typeof region === 'string' && region.trim()) location.region = region.trim();
  if (typeof city === 'string' && city.trim()) location.city = city.trim();
  return location;
}

/**
 * Adds the visitor's location to every event that doesn't already carry it. A
 * payload that isn't `{ events: [...] }`, and entries that aren't objects, pass
 * through unchanged for Amplitude to judge.
 */
export function withVisitorLocation(payload: unknown, location: VisitorLocation): unknown {
  return mapEvents(payload, (event) => {
    const next = { ...event };
    for (const key of ['country', 'region', 'city'] as const) {
      if (location[key] !== undefined && (next[key] === undefined || next[key] === null)) {
        next[key] = location[key];
      }
    }
    return next;
  });
}

/**
 * Sets the `traffic_class` event property on every event, replacing any value
 * the client sent: the server is authoritative, so a bot can't report itself as
 * `human`. Other event properties are kept; `event_properties` that aren't an
 * object are replaced.
 */
export function withTrafficClass(payload: unknown, trafficClass: TrafficClass): unknown {
  return mapEvents(payload, (event) => ({
    ...event,
    event_properties: {
      ...(isRecord(event.event_properties) ? event.event_properties : {}),
      traffic_class: trafficClass,
    },
  }));
}

/**
 * Classifies the upload's sender from Cloudflare's `request.cf` and the
 * `User-Agent` header. The first matching rule wins:
 *
 * 1. `verified_bot`: Cloudflare marks it a verified bot (`botManagement.verifiedBot`
 *    or a `verifiedBotCategory`).
 * 2. `known_bot`: a Bot Management score from 1 to 29. Bot Management is only
 *    on Enterprise zones, so `botManagement` is usually absent; a score of 0
 *    means "not computed" and is ignored.
 * 3. `known_bot`: the user agent names itself a bot, crawler, headless browser
 *    or HTTP library — or is missing or empty, since every real browser sends one.
 * 4. `datacenter`: the visitor's ASN is a major cloud or hosting network.
 * 5. `human` otherwise.
 */
export function trafficClassFrom(input: { cf: unknown; userAgent: string | null }): TrafficClass {
  const cf = isRecord(input.cf) ? input.cf : {};
  const botManagement = isRecord(cf.botManagement) ? cf.botManagement : {};

  const category = cf.verifiedBotCategory;
  if (
    botManagement.verifiedBot === true ||
    (typeof category === 'string' && category.trim() !== '')
  ) {
    return 'verified_bot';
  }

  const score = botManagement.score;
  if (typeof score === 'number' && score >= 1 && score <= 29) return 'known_bot';

  // A missing or empty user agent counts as a bot: real browsers always send one.
  const userAgent = input.userAgent?.trim() ?? '';
  if (userAgent === '' || BOT_USER_AGENT.test(userAgent)) return 'known_bot';

  if (typeof cf.asn === 'number' && DATACENTER_ASNS.has(cf.asn)) return 'datacenter';

  return 'human';
}

/** User agents that name themselves a bot, crawler, headless browser,
 * monitoring tool or HTTP library. Case-insensitive. */
const BOT_USER_AGENT = new RegExp(
  [
    // Not the CUBOT phone brand, which Android user agents name.
    '(?<!cu)bot',
    'crawl',
    'spider',
    'slurp',
    'headless',
    'python-requests',
    'python-urllib',
    'aiohttp',
    'httpx',
    'curl',
    'wget',
    'go-http-client',
    'axios',
    'node-fetch',
    'undici',
    'okhttp',
    'java/',
    'libwww-perl',
    'scrapy',
    'puppeteer',
    'playwright',
    'selenium',
    'phantomjs',
    'lighthouse',
    'pagespeed',
    'gtmetrix',
    'pingdom',
    'uptimerobot',
    'facebookexternalhit',
    'meta-externalagent',
  ].join('|'),
  'i',
);

/**
 * Major cloud and hosting networks, where page views come from scripts and
 * servers rather than people.
 *
 * Deliberately left out, because real people browse through them: Cloudflare
 * (13335, the WARP VPN), Akamai (36183) and Fastly (54113), which carry iCloud
 * Private Relay egress, and Google (15169), which carries Google Fi and other
 * consumer services. Google Cloud's own network (396982) is included.
 */
export const DATACENTER_ASNS: ReadonlySet<number> = new Set([
  16509, // Amazon AWS (AMAZON-02)
  14618, // Amazon AWS (AMAZON-AES)
  396982, // Google Cloud
  8075, // Microsoft / Azure
  14061, // DigitalOcean
  24940, // Hetzner
  16276, // OVH
  63949, // Linode (Akamai Connected Cloud)
  20473, // Vultr (Choopa)
  31898, // Oracle Cloud
  45102, // Alibaba Cloud
  132203, // Tencent Cloud
  12876, // Scaleway
  51167, // Contabo
  60781, // Leaseweb
]);

/**
 * Drops `ip` from every event. The SDK sends none (`trackingOptions.ipAddress:
 * false`); if one arrived as `$remote`, Amplitude would record the Worker's IP.
 */
export function withoutIp(payload: unknown): unknown {
  return mapEvents(payload, ({ ip: _ip, ...event }) => event);
}

type UploadEvent = Record<string, unknown>;

function mapEvents(payload: unknown, map: (event: UploadEvent) => UploadEvent): unknown {
  if (!isRecord(payload) || !Array.isArray(payload.events)) return payload;
  return {
    ...payload,
    events: payload.events.map((event: unknown) => (isRecord(event) ? map(event) : event)),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function countryNameFor(code: string): string | undefined {
  const upper = code.trim().toUpperCase();
  // `T1` fails the pattern; `XX` passes it but names no country.
  if (!/^[A-Z]{2}$/.test(upper) || upper === 'XX') return undefined;
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(upper) ?? upper;
  } catch {
    return upper;
  }
}

function tooLarge(): UploadRejection {
  return {
    action: 'reject',
    status: 413,
    message: `The body is over ${UPLOAD_LIMIT_BYTES} bytes.`,
  };
}
