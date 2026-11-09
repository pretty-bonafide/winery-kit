import { normalizeReferrerDomain } from './referrer.js';

export const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const;

export type UtmKey = (typeof UTM_KEYS)[number];

/** UTM values keyed WITHOUT the `utm_` prefix; only present keys are stored. */
export type UtmParams = Partial<Record<UtmKey, string>>;

/** The ad network whose click ID was on the landing URL. Only the type is
 * kept, never the ID itself. */
export type ClickIdType = 'google' | 'microsoft' | 'meta' | 'tiktok';

/** Click-ID query params by network, in precedence order. */
export const CLICK_ID_PARAMS: ReadonlyArray<readonly [param: string, type: ClickIdType]> = [
  ['gclid', 'google'],
  ['gbraid', 'google'],
  ['wbraid', 'google'],
  ['msclkid', 'microsoft'],
  ['fbclid', 'meta'],
  ['ttclid', 'tiktok'],
];

/**
 * The stored last-touch acquisition. `params` is empty when the touch had no
 * UTMs. The optional keys are present only when known:
 *
 * - `referrerDomain`: the landing's external referrer hostname (never a full
 *   URL), without a leading `www.`.
 * - `clickId`: the ad network of a click ID on the landing URL (never its value).
 * - `landingPath`: the path (no query or hash) of the landing that started the
 *   touch. A record holding only this is a direct visit.
 *
 * Records written by older kits (params only, or params and a referrer) read
 * unchanged.
 */
export interface StoredUtm {
  params: UtmParams;
  referrerDomain?: string;
  clickId?: ClickIdType;
  landingPath?: string;
  capturedAt: string;
}

/** What brought the visitor: the touch's UTMs, external referrer hostname and
 * ad click ID type, plus the page it landed on. No UTMs, referrer or click ID
 * is direct (or unknown). `clickId` and `landingPath` are present only when
 * known. */
export interface Acquisition {
  utm: UtmParams | null;
  referrerDomain: string | null;
  clickId?: ClickIdType;
  landingPath?: string;
}

export const UTM_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function extractUtmParams(search: string): UtmParams | null {
  const searchParams = new URLSearchParams(search);
  const params: UtmParams = {};

  for (const key of UTM_KEYS) {
    const value = searchParams.get(`utm_${key}`)?.trim();
    if (value) params[key] = value;
  }

  return Object.keys(params).length > 0 ? params : null;
}

/** The first known click-ID param with a non-blank value on the landing URL,
 * as its network. */
export function extractClickIdType(search: string): ClickIdType | null {
  const searchParams = new URLSearchParams(search);
  for (const [param, type] of CLICK_ID_PARAMS) {
    if (searchParams.get(param)?.trim()) return type;
  }
  return null;
}

/** A landing path: the pathname alone (query and hash dropped), or null when
 * it isn't an absolute path. */
export function normalizeLandingPath(raw: string | null | undefined): string | null {
  const path = raw?.trim().split(/[?#]/, 1)[0];
  return path?.startsWith('/') ? path : null;
}

function isClickIdType(value: unknown): value is ClickIdType {
  return CLICK_ID_PARAMS.some(([, type]) => type === value);
}

export function parseStoredUtm(raw: string | null): StoredUtm | null {
  if (!raw) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  if (typeof record.capturedAt !== 'string' || Number.isNaN(Date.parse(record.capturedAt))) {
    return null;
  }

  const rawParams = record.params;
  if (typeof rawParams !== 'object' || rawParams === null || Array.isArray(rawParams)) return null;

  const params: UtmParams = {};
  for (const key of UTM_KEYS) {
    const paramValue = (rawParams as Record<string, unknown>)[key];
    if (typeof paramValue === 'string' && paramValue) params[key] = paramValue;
  }

  // Records stored by 0.5.0 kept a leading `www.`; normalize them on read.
  const referrerDomain =
    typeof record.referrerDomain === 'string'
      ? normalizeReferrerDomain(record.referrerDomain)
      : null;
  const clickId = isClickIdType(record.clickId) ? record.clickId : null;
  const landingPath =
    typeof record.landingPath === 'string' ? normalizeLandingPath(record.landingPath) : null;

  if (!hasParams(params) && !referrerDomain && !clickId && !landingPath) return null;

  return buildRecord({ utm: params, referrerDomain, clickId, landingPath }, record.capturedAt);
}

/** The stored record as an acquisition: empty params read as no UTMs. */
export function toAcquisition(stored: StoredUtm): Acquisition {
  return {
    utm: hasParams(stored.params) ? stored.params : null,
    referrerDomain: stored.referrerDomain ?? null,
    ...(stored.clickId && { clickId: stored.clickId }),
    ...(stored.landingPath && { landingPath: stored.landingPath }),
  };
}

interface RecordFields {
  utm: UtmParams | null;
  referrerDomain: string | null;
  clickId?: ClickIdType | null;
  landingPath?: string | null;
}

/** A stored record with only the keys that are known. */
function buildRecord(fields: RecordFields, capturedAt: string): StoredUtm {
  return {
    params: hasParams(fields.utm) ? fields.utm : {},
    ...(fields.referrerDomain && { referrerDomain: fields.referrerDomain }),
    ...(fields.clickId && { clickId: fields.clickId }),
    ...(fields.landingPath && { landingPath: fields.landingPath }),
    capturedAt,
  };
}

function hasParams(params: UtmParams | null): params is UtmParams {
  return params !== null && Object.keys(params).length > 0;
}

export function isExpired(stored: StoredUtm, now: Date, ttlMs: number = UTM_TTL_MS): boolean {
  const capturedAt = Date.parse(stored.capturedAt);
  if (Number.isNaN(capturedAt)) return true;
  return now.getTime() - capturedAt > ttlMs;
}

/**
 * Last-touch attribution: a landing with UTMs, an external referrer or an ad
 * click ID is a new touch and replaces the stored record wholesale, keeping
 * everything that arrived together (and the landing's path). Per-key merging
 * would mix values from unrelated touches.
 *
 * A landing with none of those (direct, or navigation within the site) never
 * replaces an unexpired record. With no unexpired record, a direct landing
 * that has a path starts a direct record (just `landingPath`), so direct
 * visitors still report the page they landed on.
 */
export function mergeAcquisition(
  existing: StoredUtm | null,
  landing: Acquisition,
  now: Date,
): StoredUtm | null {
  const capturedAt = now.toISOString();
  if (hasParams(landing.utm) || landing.referrerDomain || landing.clickId) {
    return buildRecord(landing, capturedAt);
  }
  if (existing && !isExpired(existing, now)) return existing;
  if (landing.landingPath) return buildRecord(landing, capturedAt);
  return null;
}

/** {@link mergeAcquisition} for a landing that carries only UTMs. */
export function mergeUtm(
  existing: StoredUtm | null,
  incoming: UtmParams | null,
  now: Date,
): StoredUtm | null {
  return mergeAcquisition(existing, { utm: incoming, referrerDomain: null }, now);
}

/**
 * Returns the URL with `utm_*` params appended. Params already present on the
 * URL win — a platform-stamped value is more authoritative than our stored
 * copy. Unparseable URLs are returned unchanged rather than throwing, so a
 * redirect can never break on attribution.
 */
export function appendUtmToUrl(url: string, params: UtmParams | null): string {
  if (!params) return url;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  for (const key of UTM_KEYS) {
    const value = params[key];
    if (value && !parsed.searchParams.has(`utm_${key}`)) {
      parsed.searchParams.set(`utm_${key}`, value);
    }
  }

  return parsed.toString();
}
