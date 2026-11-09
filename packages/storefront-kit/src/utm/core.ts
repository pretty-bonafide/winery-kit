import { toHostname } from './referrer.js';

export const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const;

export type UtmKey = (typeof UTM_KEYS)[number];

/** UTM values keyed WITHOUT the `utm_` prefix; only present keys are stored. */
export type UtmParams = Partial<Record<UtmKey, string>>;

/**
 * The stored last-touch acquisition. `params` is empty when the touch was an
 * external referrer without UTMs; `referrerDomain` (a hostname, never a full
 * URL) is absent when the landing had no external referrer. Records written
 * before referrer capture (params only) read unchanged.
 */
export interface StoredUtm {
  params: UtmParams;
  referrerDomain?: string;
  capturedAt: string;
}

/** What brought the visitor: the touch's UTMs and external referrer hostname.
 * Both null is direct (or unknown). */
export interface Acquisition {
  utm: UtmParams | null;
  referrerDomain: string | null;
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

  const referrerDomain =
    typeof record.referrerDomain === 'string' ? toHostname(record.referrerDomain) : null;

  if (Object.keys(params).length === 0 && !referrerDomain) return null;

  return referrerDomain
    ? { params, referrerDomain, capturedAt: record.capturedAt }
    : { params, capturedAt: record.capturedAt };
}

/** The stored record as an acquisition: empty params read as no UTMs. */
export function toAcquisition(stored: StoredUtm): Acquisition {
  return {
    utm: hasParams(stored.params) ? stored.params : null,
    referrerDomain: stored.referrerDomain ?? null,
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
 * Last-touch attribution: a landing with UTMs or an external referrer is a new
 * touch and replaces the stored record wholesale, keeping both when both
 * arrived. Per-key merging would mix values from unrelated touches. A landing
 * with neither (direct, or navigation within the site) keeps an unexpired
 * record.
 */
export function mergeAcquisition(
  existing: StoredUtm | null,
  landing: Acquisition,
  now: Date,
): StoredUtm | null {
  const { utm, referrerDomain } = landing;
  if (hasParams(utm) || referrerDomain) {
    const params = hasParams(utm) ? utm : {};
    const capturedAt = now.toISOString();
    return referrerDomain ? { params, referrerDomain, capturedAt } : { params, capturedAt };
  }
  if (existing && !isExpired(existing, now)) return existing;
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
