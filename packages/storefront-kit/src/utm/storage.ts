import {
  type Acquisition,
  extractUtmParams,
  isExpired,
  mergeAcquisition,
  parseStoredUtm,
  toAcquisition,
  type UtmParams,
} from './core.js';
import { externalReferrerDomain, resolveInternalHosts } from './referrer.js';

// Sites that predate the kit keep their original key (e.g. `acme_utm_v1`) via
// configureUtmStorage so returning visitors' attribution survives the
// migration; new sites use the default.
export const DEFAULT_UTM_STORAGE_KEY = 'pg_utm_v1';

let storageKey = DEFAULT_UTM_STORAGE_KEY;
let internalHosts: readonly string[] = [];

// `document.referrer` describes how this document was reached. Under the Astro
// Client Router the document (and this module) survives navigation, and the
// referrer keeps its landing value, so only the first capture reads it.
let referrerRead = false;

export interface UtmStorageOptions {
  /** localStorage key for the stored acquisition. Default `pg_utm_v1`. */
  storageKey?: string;
  /**
   * Hosts the brand owns on other domains (e.g. a store on the platform's
   * domain), as hostnames or origins. A referrer from one of them, like one
   * from the page's own site domain, is navigation within the property and
   * never starts a new touch. Invalid entries throw.
   */
  internalHosts?: readonly string[];
}

/** Sets the given options; options left out keep their current value. */
export function configureUtmStorage(options: UtmStorageOptions) {
  if (options.internalHosts !== undefined) {
    internalHosts = resolveInternalHosts(options.internalHosts);
  }
  if (options.storageKey !== undefined) storageKey = options.storageKey;
}

export function getUtmStorageKey() {
  return storageKey;
}

function takeDocumentReferrer(): string {
  if (referrerRead || typeof document === 'undefined') return '';
  referrerRead = true;
  return document.referrer ?? '';
}

/**
 * Captures the landing's `utm_*` params and external referrer hostname from
 * the current location and persists them with last-touch semantics. Storage
 * failures (Safari private mode, disabled storage) degrade to "no
 * attribution" — never a broken page.
 */
export function captureUtmFromLocation(now: () => Date = () => new Date()): void {
  if (typeof window === 'undefined') return;

  try {
    const referrer = takeDocumentReferrer();
    const existing = parseStoredUtm(window.localStorage.getItem(storageKey));
    const landing: Acquisition = {
      utm: extractUtmParams(window.location.search),
      referrerDomain: referrer
        ? externalReferrerDomain(referrer, {
            pageHost: window.location.hostname ?? '',
            internalHosts,
          })
        : null,
    };
    const merged = mergeAcquisition(existing, landing, now());

    if (merged) {
      window.localStorage.setItem(storageKey, JSON.stringify(merged));
    } else if (existing) {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // Attribution is best-effort; storage being unavailable is not an error.
  }
}

/** The stored acquisition's UTM params, or null when it has none (no record,
 * expired, or a referrer-only touch). */
export function readStoredUtm(now: () => Date = () => new Date()): UtmParams | null {
  return readStoredAcquisition(now).utm;
}

/** The stored acquisition (UTMs and external referrer hostname); both null
 * when there is none, it expired, or storage is unavailable. */
export function readStoredAcquisition(now: () => Date = () => new Date()): Acquisition {
  if (typeof window === 'undefined') return { utm: null, referrerDomain: null };

  try {
    const stored = parseStoredUtm(window.localStorage.getItem(storageKey));
    if (stored && !isExpired(stored, now())) return toAcquisition(stored);
    if (stored) window.localStorage.removeItem(storageKey);
    return { utm: null, referrerDomain: null };
  } catch {
    return { utm: null, referrerDomain: null };
  }
}
