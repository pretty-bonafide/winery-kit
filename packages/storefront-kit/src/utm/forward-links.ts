import { appendUtmToUrl, UTM_KEYS, type UtmParams } from './core';
import { readStoredUtm } from './storage';

export interface ForwardUtmToLinksOptions {
  /** Store origin(s) whose links should carry attribution, e.g. `https://store.example.com`. */
  origins: string | string[];
  /**
   * Site-level gap-fill (typically `source`/`medium`). Lowest precedence: used
   * only for keys that neither a per-link `data-utm-*` attribute nor the
   * visitor's stored acquisition provides.
   */
  defaults?: UtmParams;
  /** Test seam forwarded to `readStoredUtm`. */
  now?: () => Date;
  /** Test seam; defaults to the global `document`. */
  doc?: Document;
}

/** Reads `data-utm-<key>` overrides off a single anchor. */
function readLinkOverrides(anchor: Element): UtmParams {
  const params: UtmParams = {};
  for (const key of UTM_KEYS) {
    const value = anchor.getAttribute(`data-utm-${key}`)?.trim();
    if (value) params[key] = value;
  }
  return params;
}

/**
 * Synchronous core of {@link forwardUtmToLinks}, separated so it can run against
 * an injected document in tests. Rewrites the `href` of every `<a>` pointing at
 * one of `origins`, merging UTM sources by precedence (low → high):
 *
 *   site `defaults`  <  per-link `data-utm-*`  <  stored acquisition  <  params already on the href
 *
 * `appendUtmToUrl` is append-if-absent, so params already on the href (e.g. a
 * CMS-authored link) always win, and re-running is idempotent.
 */
export function decorateUtmLinks(options: ForwardUtmToLinksOptions): void {
  const doc = options.doc ?? document;
  const originList = Array.isArray(options.origins) ? options.origins : [options.origins];
  const origins = new Set(originList);
  const stored = readStoredUtm(options.now);

  for (const anchor of doc.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    let url: URL;
    try {
      url = new URL(anchor.href);
    } catch {
      continue;
    }
    if (!origins.has(url.origin)) continue;

    const merged: UtmParams = { ...options.defaults, ...readLinkOverrides(anchor), ...stored };
    const next = appendUtmToUrl(anchor.href, merged);
    if (next !== anchor.href) anchor.setAttribute('href', next);
  }
}

/**
 * Decorates store-bound links with the visitor's attribution once the DOM is
 * ready. No-op during SSR. Safe to call more than once (idempotent).
 */
export function forwardUtmToLinks(options: ForwardUtmToLinksOptions): void {
  if (typeof document === 'undefined') return;

  const run = () => decorateUtmLinks(options);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
}
