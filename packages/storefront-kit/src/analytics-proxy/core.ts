// Pure core of the first-party Amplitude forwarder: what to do with an upload
// request, and what the forwarded body looks like. No I/O — forward.ts reads the
// request and talks to Amplitude.
//
// It is never an open proxy: the upstream is fixed by server zone, and only the
// body travels (no client headers, cookies or IP).
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
 * otherwise forwards it without any `ip` and with the visitor's location.
 */
export function decideUploadBody(
  body: Uint8Array,
  context: { serverZone: AmplitudeServerZone; location: VisitorLocation },
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
    body: JSON.stringify(withVisitorLocation(withoutIp(payload), context.location)),
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
