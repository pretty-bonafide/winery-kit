export const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const;

export type UtmKey = (typeof UTM_KEYS)[number];

/** UTM values keyed WITHOUT the `utm_` prefix; only present keys are stored. */
export type UtmParams = Partial<Record<UtmKey, string>>;

export interface StoredUtm {
  params: UtmParams;
  capturedAt: string;
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

  if (Object.keys(params).length === 0) return null;

  return { params, capturedAt: record.capturedAt };
}

export function isExpired(stored: StoredUtm, now: Date, ttlMs: number = UTM_TTL_MS): boolean {
  const capturedAt = Date.parse(stored.capturedAt);
  if (Number.isNaN(capturedAt)) return true;
  return now.getTime() - capturedAt > ttlMs;
}

/**
 * Last-touch attribution: incoming params replace the stored record wholesale.
 * Per-key merging would mix values from unrelated campaigns.
 */
export function mergeUtm(
  existing: StoredUtm | null,
  incoming: UtmParams | null,
  now: Date,
): StoredUtm | null {
  if (incoming) return { params: incoming, capturedAt: now.toISOString() };
  if (existing && !isExpired(existing, now)) return existing;
  return null;
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
