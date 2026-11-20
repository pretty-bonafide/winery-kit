import type { PurchasePanelView } from '@pretty-good/storefront-kit/pdp';
import { describe, expect, it, vi } from 'vitest';
import { renderOrUnavailable } from './purchase-panel-states.js';

const view = (overrides: Partial<PurchasePanelView>): PurchasePanelView => ({
  state: 'members-only',
  summary: { layout: 'simple', price: '$52' },
  canIncrement: true,
  canPurchase: false,
  ...overrides,
});

describe('renderOrUnavailable: a retail denial the site has not designed', () => {
  it('uses the site renderer when there is one', () => {
    const own = vi.fn(() => 'own');
    const unavailable = vi.fn(() => 'unavailable');

    expect(renderOrUnavailable(own, unavailable, view({}))).toBe('own');
    expect(unavailable).not.toHaveBeenCalled();
  });

  it("falls back to the site's unavailable render, as an unavailable view with the 0.7.1 note", () => {
    const unavailable = vi.fn(() => 'unavailable');

    expect(renderOrUnavailable(undefined, unavailable, view({ membersOnlyNote: 'members' }))).toBe(
      'unavailable',
    );
    expect(unavailable).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'unavailable',
        canPurchase: false,
        unavailableNote: 'This wine is not currently available for purchase.',
      }),
    );
  });

  it('keeps a not-allocated note the view already carries', () => {
    const unavailable = vi.fn(() => 'unavailable');

    renderOrUnavailable(
      undefined,
      unavailable,
      view({ state: 'not-allocated', unavailableNote: 'Not in your current allocation' }),
    );

    expect(unavailable).toHaveBeenCalledWith(
      expect.objectContaining({ unavailableNote: 'Not in your current allocation' }),
    );
  });

  it('renders nothing only when the site has neither renderer (an allocation site)', () => {
    expect(renderOrUnavailable(undefined, undefined, view({}))).toBeNull();
  });
});
