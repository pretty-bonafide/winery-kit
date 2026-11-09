// Imperative shell for `store_link_clicked`: one delegated listener per
// document that hands each click on a link to the pure core (store-link.ts)
// and tracks what it returns. Like the kit's hooks, it emits through
// tracker.ts and never loads the SDK itself.
import {
  type LinkClickEventType,
  opensLink,
  resolveStoreOrigins,
  STORE_DESTINATION_ATTRIBUTE,
  storeLinkClick,
} from './store-link.js';
import { track } from './tracker.js';

export interface TrackStoreLinkClicksOptions {
  /** Store origin(s) whose links count, e.g. `https://store.example.com` (as
   * for `forwardUtmToLinks`). Invalid entries throw. */
  origins: string | readonly string[];
  /** Test seam; defaults to the global `document`. */
  doc?: Document;
}

// One listener per document. The document survives Astro Client Router
// navigation (only its body is swapped), so a site may call
// trackStoreLinkClicks on every `astro:page-load`; later calls only replace the
// origins.
const installed = new WeakMap<Document, { origins: readonly string[] }>();

/**
 * Tracks `store_link_clicked` when the visitor clicks a link to one of the
 * store `origins`: a primary click (plain, or with Ctrl/⌘/Shift to open a new
 * tab or window) or a middle click; not a right click or Alt-click. The link's
 * `data-store-destination` attribute names what it opens (`club_join`, `shop`,
 * `account`, `reservation`, `gift_card`), else `other`.
 *
 * The listener is delegated (links added later count too) and runs in the
 * capture phase, so a site handler that stops propagation can't hide a click;
 * a click whose navigation a site handler then cancels is still counted.
 * Analytics must be initialized for anything to be sent. No-op during SSR;
 * idempotent.
 */
export function trackStoreLinkClicks(options: TrackStoreLinkClicksOptions): void {
  const origins = resolveStoreOrigins(options.origins);
  const doc = options.doc ?? (typeof document === 'undefined' ? undefined : document);
  if (!doc) return;

  const existing = installed.get(doc);
  if (existing) {
    existing.origins = origins;
    return;
  }

  const state = { origins };
  installed.set(doc, state);

  const onClick = (event: MouseEvent) => {
    try {
      const gesture = {
        eventType: event.type as LinkClickEventType,
        button: event.button,
        altKey: event.altKey,
      };
      if (!opensLink(gesture)) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!anchor) return;

      const input = storeLinkClick(
        {
          href: anchor.getAttribute('href'),
          destination: anchor.getAttribute(STORE_DESTINATION_ATTRIBUTE),
          baseUrl: doc.baseURI,
        },
        typeof window === 'undefined' ? '' : window.location.pathname,
        state.origins,
      );
      if (input) track(input);
    } catch {
      // Analytics never breaks navigation.
    }
  };

  doc.addEventListener('click', onClick, { capture: true });
  doc.addEventListener('auxclick', onClick, { capture: true });
}
