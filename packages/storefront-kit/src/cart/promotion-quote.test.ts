import { describe, expect, it } from 'vitest';
import { decidePromotionQuote, type PromotionQuoteFacts } from './promotion-quote';

const READY: PromotionQuoteFacts = {
  canQuote: true,
  isSidebarOpen: true,
  lineCount: 2,
  hasPromotions: false,
  outboxIdle: true,
  hasFailedWrites: false,
  cartGeneration: 3,
  quotedGeneration: null,
  inFlightGeneration: null,
};

describe('decidePromotionQuote', () => {
  it('quotes an open, settled cart with lines that has not been quoted', () => {
    expect(decidePromotionQuote(READY)).toBe('quote');
    expect(decidePromotionQuote({ ...READY, quotedGeneration: 2 })).toBe('quote');
  });

  it('skips when the adapter cannot quote', () => {
    expect(decidePromotionQuote({ ...READY, canQuote: false })).toBe('skip');
    expect(
      decidePromotionQuote({ ...READY, canQuote: false, lineCount: 0, hasPromotions: true }),
    ).toBe('skip');
  });

  it('never quotes an empty cart, and clears promotions it still shows', () => {
    expect(decidePromotionQuote({ ...READY, lineCount: 0 })).toBe('skip');
    expect(decidePromotionQuote({ ...READY, lineCount: 0, hasPromotions: true })).toBe('clear');
    expect(
      decidePromotionQuote({ ...READY, lineCount: 0, hasPromotions: true, isSidebarOpen: false }),
    ).toBe('clear');
  });

  it('never quotes while the sheet is closed, and drops promotions from an older cart', () => {
    const closed = { ...READY, isSidebarOpen: false };
    expect(decidePromotionQuote(closed)).toBe('skip');
    expect(decidePromotionQuote({ ...closed, hasPromotions: true, quotedGeneration: 3 })).toBe(
      'skip',
    );
    expect(decidePromotionQuote({ ...closed, hasPromotions: true, quotedGeneration: 2 })).toBe(
      'clear',
    );
  });

  it('waits for local writes to settle', () => {
    expect(decidePromotionQuote({ ...READY, outboxIdle: false })).toBe('skip');
  });

  it('never quotes while a write has failed, and clears promotions it still shows', () => {
    expect(decidePromotionQuote({ ...READY, hasFailedWrites: true })).toBe('skip');
    expect(decidePromotionQuote({ ...READY, hasFailedWrites: true, hasPromotions: true })).toBe(
      'clear',
    );
  });

  it('skips when the displayed promotions already match this cart', () => {
    expect(decidePromotionQuote({ ...READY, quotedGeneration: 3 })).toBe('skip');
  });

  it('allows one quote in flight at a time', () => {
    expect(decidePromotionQuote({ ...READY, inFlightGeneration: 3 })).toBe('skip');
    expect(decidePromotionQuote({ ...READY, inFlightGeneration: 2 })).toBe('skip');
  });
});
