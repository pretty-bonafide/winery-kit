import { extractUtmParams, isExpired, mergeUtm, parseStoredUtm, type UtmParams } from './core.js';

// Sites that predate the kit keep their original key (e.g. `acme_utm_v1`) via
// configureUtmStorage so returning visitors' attribution survives the
// migration; new sites use the default.
export const DEFAULT_UTM_STORAGE_KEY = 'pg_utm_v1';

let storageKey = DEFAULT_UTM_STORAGE_KEY;

export function configureUtmStorage(options: { storageKey: string }) {
  storageKey = options.storageKey;
}

export function getUtmStorageKey() {
  return storageKey;
}

/**
 * Captures `utm_*` params from the current location and persists them with
 * last-touch semantics. Storage failures (Safari private mode, disabled
 * storage) degrade to "no attribution" — never a broken page.
 */
export function captureUtmFromLocation(now: () => Date = () => new Date()): void {
  if (typeof window === 'undefined') return;

  try {
    const existing = parseStoredUtm(window.localStorage.getItem(storageKey));
    const incoming = extractUtmParams(window.location.search);
    const merged = mergeUtm(existing, incoming, now());

    if (merged) {
      window.localStorage.setItem(storageKey, JSON.stringify(merged));
    } else if (existing) {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // Attribution is best-effort; storage being unavailable is not an error.
  }
}

export function readStoredUtm(now: () => Date = () => new Date()): UtmParams | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = parseStoredUtm(window.localStorage.getItem(storageKey));
    if (!stored) return null;

    if (isExpired(stored, now())) {
      window.localStorage.removeItem(storageKey);
      return null;
    }

    return stored.params;
  } catch {
    return null;
  }
}
