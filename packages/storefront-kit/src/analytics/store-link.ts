// Pure core of store-link click tracking: which clicks open a link, which
// links go to the store, and the `store_link_clicked` input for one. No DOM —
// the shell (store-link-clicks.ts) reads the event and the anchor.
import { isStoreDestination, type StoreDestination, type StoreLinkClickedInput } from './core.js';

/** The attribute a site puts on a store link to say what it opens. */
export const STORE_DESTINATION_ATTRIBUTE = 'data-store-destination';

/**
 * Normalizes the configured store origins (`https://store.example.com`, or any
 * URL on it) to origins. An entry that isn't an http(s) URL, or no entries at
 * all, is a provisioning mistake and throws naming it (RULES.md §5).
 */
export function resolveStoreOrigins(origins: string | readonly string[]): string[] {
  const entries = typeof origins === 'string' ? [origins] : origins;
  if (entries.length === 0) {
    throw new Error('trackStoreLinkClicks: `origins` needs at least one store origin.');
  }
  return entries.map((entry) => {
    const origin = httpOrigin(entry);
    if (!origin) {
      throw new Error(
        `trackStoreLinkClicks: \`origins\` entry "${entry}" is not an http(s) origin.`,
      );
    }
    return origin;
  });
}

function httpOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** The link's `data-store-destination` when it is a known destination,
 * else `other` (missing, blank or unknown). */
export function parseStoreDestination(value: string | null | undefined): StoreDestination {
  const destination = value?.trim();
  return isStoreDestination(destination) ? destination : 'other';
}

/** The DOM event that reported the click. */
export type LinkClickEventType = 'click' | 'auxclick';

export interface LinkClickGesture {
  eventType: LinkClickEventType;
  /** `MouseEvent.button`: 0 primary, 1 middle (wheel), 2 secondary. */
  button: number;
  altKey: boolean;
}

/**
 * Whether the click opens the link, in this tab or another: a primary click,
 * plain or with Ctrl/⌘/Shift (new tab or window), or a middle click (reported
 * as `auxclick`). A secondary click only opens a menu, and Alt-click downloads
 * the link, so neither counts. Each gesture is counted from one event type
 * only, so a browser that also reports a middle click as `click` isn't counted
 * twice.
 */
export function opensLink(gesture: LinkClickGesture): boolean {
  if (gesture.altKey) return false;
  return gesture.eventType === 'click' ? gesture.button === 0 : gesture.button === 1;
}

export interface StoreLinkCandidate {
  /** The anchor's raw `href` attribute. */
  href: string | null;
  /** The anchor's `data-store-destination` attribute. */
  destination: string | null;
  /** The document's base URL, to resolve a relative `href`. */
  baseUrl: string;
}

/**
 * The `store_link_clicked` input for a clicked anchor, or null when its
 * `href` doesn't resolve to one of the store `origins`. Only the store URL's
 * path is reported (its query, which carries forwarded UTMs, and hash are
 * dropped). `pagePath` is the current page's path.
 */
export function storeLinkClick(
  link: StoreLinkCandidate,
  pagePath: string,
  origins: readonly string[],
): StoreLinkClickedInput | null {
  if (!link.href) return null;

  let url: URL;
  try {
    url = new URL(link.href, link.baseUrl);
  } catch {
    return null;
  }
  if (!origins.includes(url.origin)) return null;

  return {
    type: 'store_link_clicked',
    destination: parseStoreDestination(link.destination),
    linkPath: url.pathname,
    path: pagePath,
  };
}
