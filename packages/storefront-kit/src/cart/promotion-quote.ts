// Functional core for the cart's order-promotion quote (`POST /checkout/quote`).
//
// Promotions are only visible inside the open cart sheet, so the quote is
// fetched lazily: never on page boot, never for an empty cart, never while
// local writes are still settling or have failed (the server cart would not
// match the displayed one), and at most one at a time. The cart store (the shell)
// feeds in the facts and acts on the decision.

export interface PromotionQuoteFacts {
  /** The configured adapter can quote promotions on demand (`getPromotions`). */
  canQuote: boolean;
  isSidebarOpen: boolean;
  /** Lines in the displayed cart. */
  lineCount: number;
  /** The displayed cart currently shows at least one promotion. */
  hasPromotions: boolean;
  /** No local cart write is queued, debounced, or in flight. */
  outboxIdle: boolean;
  /** A displayed line failed to persist, so the server cart (what a quote
   * prices) differs from the displayed one until the shopper fixes it. */
  hasFailedWrites: boolean;
  /** Bumped on every change to the displayed cart's contents. */
  cartGeneration: number;
  /** Generation the displayed promotions were quoted for, or null if none. */
  quotedGeneration: number | null;
  /** Generation of the quote currently in flight, or null if none. */
  inFlightGeneration: number | null;
}

export type PromotionQuoteDecision = 'quote' | 'clear' | 'skip';

export function decidePromotionQuote(facts: PromotionQuoteFacts): PromotionQuoteDecision {
  if (!facts.canQuote) return 'skip';
  // An empty cart has nothing to promote: drop any stale nudge, never quote.
  if (facts.lineCount === 0) return facts.hasPromotions ? 'clear' : 'skip';
  // A quote would price the server cart, not the one on screen: show none.
  if (facts.hasFailedWrites) return facts.hasPromotions ? 'clear' : 'skip';
  // Closed sheet: no quote. Promotions quoted for an older cart are dropped
  // now, while nobody sees it, so reopening never flashes a stale nudge.
  if (!facts.isSidebarOpen) {
    return facts.hasPromotions && facts.quotedGeneration !== facts.cartGeneration
      ? 'clear'
      : 'skip';
  }
  if (!facts.outboxIdle) return 'skip';
  if (facts.quotedGeneration === facts.cartGeneration) return 'skip';
  // One quote at a time. A quote for an older generation is discarded when it
  // lands, and its completion re-evaluates, so the newest cart is quoted next.
  if (facts.inFlightGeneration !== null) return 'skip';
  return 'quote';
}
