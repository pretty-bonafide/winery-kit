import { describe, expect, it } from 'vitest';
import type { CartLine } from '../cart/cart-types';
import type {
  CustomerMembership,
  VariationAvailability,
  VariationPricing,
} from '../storefront-api/customer-context';
import type { StorefrontProductVariation } from '../storefront-api/products';
import {
  buildPurchasePanelView,
  buildSelectedCartInput,
  formatSavingsNote,
  formatVolume,
  resolveSelectedVariation,
} from './purchase-panel-state';

const DEMI: StorefrontProductVariation = {
  id: 'var_demi',
  sku: 'EXC22-375',
  price: 3000,
  unitName: 'Demi',
  volumeMl: 375,
};

const BOTTLE: StorefrontProductVariation = {
  id: 'var_bottle',
  sku: 'EXC22-750',
  price: 5200,
  isDefault: true,
  unitName: 'Bottle',
  volumeMl: 750,
};

const MAGNUM: StorefrontProductVariation = {
  id: 'var_magnum',
  sku: 'EXC22-1500',
  price: 9800,
  unitName: 'Magnum',
  volumeMl: 1500,
};

const MEMBER_PRICING: VariationPricing[] = [
  {
    variationId: 'var_bottle',
    retailPrice: 5200,
    customerPrice: 4160,
    savings: { amount: 1040, basisPoints: 2000 },
    appliedPromotions: [{ id: 'promo_member', name: 'Allocation Member Discount' }],
  },
];

const ACTIVE_MEMBERSHIPS: CustomerMembership[] = [
  { id: 'wcm_1', clubId: 'club_1', clubName: 'Reserve Allocation', status: 'active' },
];

const ALLOCATED_AVAILABILITY: VariationAvailability[] = [
  {
    productVariationId: 'var_bottle',
    permission: 'purchase',
    canAddToCart: true,
    canAddToWishlist: false,
    quantityLimit: { limit: 6, redeemed: 2, available: 4 },
    grantContext: { name: '2024 Release', endsAt: null },
  },
];

const EXHAUSTED_AVAILABILITY: VariationAvailability[] = [
  {
    productVariationId: 'var_bottle',
    permission: 'purchase',
    canAddToCart: false,
    canAddToWishlist: false,
    quantityLimit: { limit: 6, redeemed: 6, available: 0 },
    grantContext: { name: '2022 release', endsAt: null },
  },
];

const BOTTLE_CART_LINE: CartLine = {
  id: 'line_1',
  productId: 'prod_123',
  purchaseOptionId: 'var_bottle',
  title: 'Example Cabernet',
  quantity: 2,
  unitPrice: 5200,
};

describe('formatVolume', () => {
  it.each([
    [375, '375 ML'],
    [750, '750 ML'],
    [1000, '1 L'],
    [1500, '1.5 L'],
    [null, ''],
    [undefined, ''],
  ])('formats %s as %s', (volumeMl, expected) => {
    expect(formatVolume(volumeMl)).toBe(expected);
  });
});

describe('formatSavingsNote', () => {
  it('formats amount and basis points', () => {
    expect(formatSavingsNote({ amount: 1040, basisPoints: 2000 })).toBe('You save $10.40 (20%)');
    expect(formatSavingsNote({ amount: 650, basisPoints: 1250 })).toBe('You save $6.50 (12.5%)');
  });
});

describe('resolveSelectedVariation', () => {
  it('prefers the explicit selection, then the default, then the first', () => {
    const variations = [DEMI, BOTTLE, MAGNUM];
    expect(resolveSelectedVariation(variations, 'var_magnum')?.id).toBe('var_magnum');
    expect(resolveSelectedVariation(variations)?.id).toBe('var_bottle');
    expect(resolveSelectedVariation([DEMI, MAGNUM])?.id).toBe('var_demi');
  });
});

describe('buildPurchasePanelView', () => {
  it('renders the members-only state for anonymous visitors (price visible, no purchase CTA)', () => {
    const view = buildPurchasePanelView({
      lens: 'allocation',
      variations: [DEMI, BOTTLE, MAGNUM],
      isAuthenticated: false,
    });

    expect(view.state).toBe('members-only');
    expect(view.memberBadge).toBeUndefined();
    expect(view.selectedVariationId).toBe('var_bottle');
    expect(view.formats).toEqual([
      { id: 'var_demi', name: 'DEMI', volume: '375 ML', price: '$30', retailPrice: undefined },
      { id: 'var_bottle', name: 'BOTTLE', volume: '750 ML', price: '$52', retailPrice: undefined },
      { id: 'var_magnum', name: 'MAGNUM', volume: '1.5 L', price: '$98', retailPrice: undefined },
    ]);
    expect(view.summary).toEqual({ layout: 'simple', price: '$52', caption: 'BOTTLE · 750 ML' });
    expect(view.membersOnlyNote).toBe(
      'Reserved for select members. Sign in to check your availability.',
    );
    expect(view.waitingListCta).toEqual({ label: 'JOIN THE WAITING LIST', href: '/waiting-list' });
    expect(view.canPurchase).toBe(false);
  });

  it('renders the members-only state for authenticated non-members', () => {
    const view = buildPurchasePanelView({
      lens: 'allocation',
      variations: [BOTTLE],
      isAuthenticated: true,
      memberships: [],
      availability: [],
    });

    expect(view.state).toBe('members-only');
    expect(view.memberBadge).toBeUndefined();
    expect(view.summary.price).toBe('$52');
    expect(view.membersOnlyNote).toBe(
      'Reserved for select members. Sign in to check your availability.',
    );
    expect(view.waitingListCta).toEqual({ label: 'JOIN THE WAITING LIST', href: '/waiting-list' });
    expect(view.canPurchase).toBe(false);
  });

  it('renders the purchasable state for a member with the wine in their allocation', () => {
    const view = buildPurchasePanelView({
      lens: 'allocation',
      variations: [BOTTLE],
      isAuthenticated: true,
      memberships: ACTIVE_MEMBERSHIPS,
      availability: ALLOCATED_AVAILABILITY,
    });

    expect(view.state).toBe('purchasable');
    expect(view.memberBadge).toBe('SIGNED IN · RESERVE ALLOCATION');
    expect(view.entitlementStatus).toBe('4 OF 6 BOTTLES REMAINING');
    expect(view.grantName).toBe('2024 Release');
    expect(view.membersOnlyNote).toBeUndefined();
    expect(view.waitingListCta).toBeUndefined();
    expect(view.canPurchase).toBe(true);
  });

  it('renders member pricing on cards and summary for an allocated member', () => {
    const view = buildPurchasePanelView({
      lens: 'allocation',
      variations: [DEMI, BOTTLE, MAGNUM],
      isAuthenticated: true,
      pricing: MEMBER_PRICING,
      memberships: ACTIVE_MEMBERSHIPS,
      availability: ALLOCATED_AVAILABILITY,
    });

    expect(view.state).toBe('purchasable');
    expect(view.memberBadge).toBe('SIGNED IN · RESERVE ALLOCATION');
    expect(view.formats?.[1]).toEqual({
      id: 'var_bottle',
      name: 'BOTTLE',
      volume: '750 ML',
      price: '$41.60',
      retailPrice: '$52',
    });
    expect(view.summary).toEqual({
      layout: 'member-stacked',
      price: '$41.60',
      retailPrice: '$52',
      caption: 'BOTTLE · 750 ML',
      savingsNote: 'You save $10.40 (20%)',
      promotionName: 'Allocation Member Discount',
    });
  });

  it('renders single-format member pricing inline', () => {
    const view = buildPurchasePanelView({
      lens: 'allocation',
      variations: [BOTTLE],
      isAuthenticated: true,
      pricing: MEMBER_PRICING,
      memberships: ACTIVE_MEMBERSHIPS,
      availability: ALLOCATED_AVAILABILITY,
    });

    expect(view.formats).toBeUndefined();
    expect(view.summary.layout).toBe('member-inline');
    expect(view.summary.savingsNote).toBe('You save $10.40 (20%)');
  });

  it('renders by-request for a member whose only path is a purchase request (mock 04B)', () => {
    const view = buildPurchasePanelView({
      lens: 'allocation',
      variations: [BOTTLE],
      isAuthenticated: true,
      memberships: ACTIVE_MEMBERSHIPS,
      availability: [
        {
          productVariationId: 'var_bottle',
          permission: 'wishlist',
          canAddToCart: false,
          canAddToWishlist: true,
          quantityLimit: null,
          grantContext: { name: 'Spring 2026 Release', endsAt: null },
        },
      ],
      requestCap: 2,
      requestHref: 'https://store.example.test/request',
    });

    expect(view.state).toBe('by-request');
    expect(view.scarcityStatus).toBe('BY REQUEST');
    expect(view.scarcityCap).toBe('LIMIT 2 REQUESTS PER CUSTOMER');
    expect(view.requestCta).toEqual({
      label: 'REQUEST TO PURCHASE',
      href: 'https://store.example.test/request',
    });
    // Full-strength price: purchase is plausible on approval.
    expect(view.summary.price).toBe('$52');
    expect(view.canPurchase).toBe(false);
  });

  it('carries the public cap on the members-only scarcity row when supplied', () => {
    const view = buildPurchasePanelView({
      lens: 'allocation',
      variations: [BOTTLE],
      isAuthenticated: false,
      publicQuantityLimit: 6,
    });

    expect(view.state).toBe('members-only');
    expect(view.scarcityStatus).toBe('LIMITED ALLOCATION');
    expect(view.scarcityCap).toBe('LIMIT 6 PER CUSTOMER');
  });

  it('does not show a badge for paused memberships and falls back to members-only', () => {
    const view = buildPurchasePanelView({
      lens: 'allocation',
      variations: [BOTTLE],
      isAuthenticated: true,
      memberships: [{ id: 'wcm_1', clubId: 'club_1', clubName: 'Club', status: 'paused' }],
      availability: ALLOCATED_AVAILABILITY,
    });

    expect(view.memberBadge).toBeUndefined();
    expect(view.state).toBe('members-only');
  });

  it('renders the in-cart state with stepper data for a member', () => {
    const view = buildPurchasePanelView({
      lens: 'allocation',
      variations: [BOTTLE],
      isAuthenticated: true,
      memberships: ACTIVE_MEMBERSHIPS,
      availability: ALLOCATED_AVAILABILITY,
      cartLines: [BOTTLE_CART_LINE],
    });

    expect(view.state).toBe('in-cart');
    expect(view.cartLine).toEqual({ id: 'line_1', quantity: 2 });
    expect(view.cartNote).toBe('2 bottles in your cart');
    expect(view.summary).toEqual({ layout: 'unit', price: '$52', unit: '/ bottle' });
    expect(view.canIncrement).toBe(true);
  });

  it('renders the not-allocated state from exhausted entitlements', () => {
    const view = buildPurchasePanelView({
      lens: 'allocation',
      variations: [BOTTLE],
      isAuthenticated: true,
      memberships: ACTIVE_MEMBERSHIPS,
      availability: EXHAUSTED_AVAILABILITY,
    });

    expect(view.state).toBe('not-allocated');
    expect(view.entitlementStatus).toBe('0 OF 6 BOTTLES REMAINING');
    expect(view.unavailableNote).toBe("You've reached your allocation limit for the 2022 release.");
    expect(view.grantName).toBe('2022 release');
    expect(view.waitingListCta).toBeUndefined();
    expect(view.canPurchase).toBe(false);
  });

  it('renders the not-allocated state for a member with no entitlement for the wine', () => {
    const view = buildPurchasePanelView({
      lens: 'allocation',
      variations: [BOTTLE],
      isAuthenticated: true,
      memberships: ACTIVE_MEMBERSHIPS,
      availability: [],
    });

    expect(view.state).toBe('not-allocated');
    expect(view.entitlementStatus).toBeUndefined();
    expect(view.unavailableNote).toBe('Not in your current allocation');
    expect(view.canPurchase).toBe(false);
  });

  it('renders the not-allocated state when permission is not purchase', () => {
    const view = buildPurchasePanelView({
      lens: 'allocation',
      variations: [BOTTLE],
      isAuthenticated: true,
      memberships: ACTIVE_MEMBERSHIPS,
      availability: [
        {
          ...ALLOCATED_AVAILABILITY[0],
          permission: 'wishlist',
          canAddToCart: false,
        },
      ],
    });

    expect(view.state).toBe('not-allocated');
    expect(view.canPurchase).toBe(false);
  });

  it('never renders the system "universal" grant name in the not-allocated note', () => {
    const view = buildPurchasePanelView({
      lens: 'allocation',
      variations: [BOTTLE],
      isAuthenticated: true,
      memberships: ACTIVE_MEMBERSHIPS,
      availability: [
        {
          ...EXHAUSTED_AVAILABILITY[0],
          quantityLimit: { limit: 0, redeemed: 0, available: 0 },
          grantContext: { name: 'universal', endsAt: null },
        },
      ],
    });

    expect(view.state).toBe('not-allocated');
    expect(view.grantName).toBeUndefined();
    expect(view.unavailableNote).toBe('Not in your current allocation');
  });

  it('prefers in-cart over not-allocated for an already-carted variation', () => {
    const view = buildPurchasePanelView({
      lens: 'allocation',
      variations: [BOTTLE],
      isAuthenticated: true,
      memberships: ACTIVE_MEMBERSHIPS,
      availability: EXHAUSTED_AVAILABILITY,
      cartLines: [BOTTLE_CART_LINE],
    });

    expect(view.state).toBe('in-cart');
    expect(view.canIncrement).toBe(false);
  });

  it('caps the stepper from the availability quantity limit', () => {
    const view = buildPurchasePanelView({
      lens: 'allocation',
      variations: [BOTTLE],
      isAuthenticated: true,
      memberships: ACTIVE_MEMBERSHIPS,
      availability: [
        {
          ...EXHAUSTED_AVAILABILITY[0],
          canAddToCart: true,
          quantityLimit: { limit: 6, redeemed: 2, available: 4 },
        },
      ],
      cartLines: [BOTTLE_CART_LINE],
    });

    expect(view.canIncrement).toBe(true);
  });

  it('caps the stepper from an exceeds_limit cart error (allocation_exceeded refresh)', () => {
    const view = buildPurchasePanelView({
      lens: 'allocation',
      variations: [BOTTLE],
      isAuthenticated: true,
      memberships: ACTIVE_MEMBERSHIPS,
      availability: ALLOCATED_AVAILABILITY,
      cartLines: [BOTTLE_CART_LINE],
      errorQuantityLimit: { limit: 6, redeemed: 4, available: 2 },
    });

    expect(view.state).toBe('in-cart');
    expect(view.canIncrement).toBe(false);
  });

  it('falls back to the CMS price label without storefront variations', () => {
    const view = buildPurchasePanelView({
      lens: 'allocation',
      variations: [],
      isAuthenticated: false,
      fallbackPriceLabel: '$52',
    });

    expect(view.formats).toBeUndefined();
    expect(view.summary).toEqual({ layout: 'simple', price: '$52', caption: undefined });
    expect(view.state).toBe('members-only');
    expect(view.canPurchase).toBe(false);
  });

  it('degrades to the members-only retail render when customer reads are null (fetch failed)', () => {
    const view = buildPurchasePanelView({
      lens: 'allocation',
      variations: [DEMI, BOTTLE, MAGNUM],
      isAuthenticated: false,
      pricing: null,
      availability: null,
      memberships: null,
    });

    expect(view.state).toBe('members-only');
    expect(view.summary.price).toBe('$52');
    expect(view.formats?.every((format) => format.retailPrice === undefined)).toBe(true);
  });

  it('degrades to members-only (never purchase, never not-allocated) for a member when the availability read failed', () => {
    const view = buildPurchasePanelView({
      lens: 'allocation',
      variations: [BOTTLE],
      isAuthenticated: true,
      memberships: ACTIVE_MEMBERSHIPS,
      availability: null,
    });

    // A failed read carries no entitlement facts: asserting "Not in your
    // current allocation" would fabricate one, so the view stays members-only.
    expect(view.state).toBe('members-only');
    expect(view.canPurchase).toBe(false);
    expect(view.unavailableNote).toBeUndefined();
  });

  it('asserts not-allocated only from a loaded availability response missing the variation', () => {
    const view = buildPurchasePanelView({
      lens: 'allocation',
      variations: [BOTTLE],
      isAuthenticated: true,
      memberships: ACTIVE_MEMBERSHIPS,
      // Loaded response that simply has no entitlement row for this variation.
      availability: [],
    });

    expect(view.state).toBe('not-allocated');
    expect(view.unavailableNote).toBe('Not in your current allocation');
  });

  it('renders the degraded state for an allocated member when no add-to-cart input could be wired', () => {
    const view = buildPurchasePanelView({
      lens: 'allocation',
      variations: [BOTTLE],
      isAuthenticated: true,
      memberships: ACTIVE_MEMBERSHIPS,
      availability: ALLOCATED_AVAILABILITY,
      hasCartProduct: false,
    });

    expect(view.state).toBe('degraded');
    expect(view.canPurchase).toBe(false);
  });

  it('keeps the members-only gate ahead of the degraded wiring gap', () => {
    const view = buildPurchasePanelView({
      lens: 'allocation',
      variations: [BOTTLE],
      isAuthenticated: false,
      hasCartProduct: false,
    });

    expect(view.state).toBe('members-only');
  });

  it('keeps not-allocated entitlement facts ahead of the degraded wiring gap', () => {
    const view = buildPurchasePanelView({
      lens: 'allocation',
      variations: [BOTTLE],
      isAuthenticated: true,
      memberships: ACTIVE_MEMBERSHIPS,
      availability: EXHAUSTED_AVAILABILITY,
      hasCartProduct: false,
    });

    expect(view.state).toBe('not-allocated');
  });

  it('keeps the in-cart state for a carted line even when the session has lapsed', () => {
    // Pins the documented ladder order: a held cart line outranks the
    // membership gate, so a mid-session auth blip cannot strand the cart UI.
    const view = buildPurchasePanelView({
      lens: 'allocation',
      variations: [BOTTLE],
      isAuthenticated: false,
      cartLines: [BOTTLE_CART_LINE],
    });

    expect(view.state).toBe('in-cart');
  });
});

describe('buildSelectedCartInput', () => {
  it('swaps the variation identifiers and unit price onto the base input', () => {
    const input = buildSelectedCartInput(
      {
        productId: 'prod_123',
        purchaseOptionId: 'var_bottle',
        variantId: 'var_bottle',
        sku: 'EXC22-750',
        quantity: 1,
        display: { title: 'Example Cabernet', unitPrice: 5200, imageUrl: 'img' },
      },
      MAGNUM,
    );

    expect(input.purchaseOptionId).toBe('var_magnum');
    expect(input.variantId).toBe('var_magnum');
    expect(input.sku).toBe('EXC22-1500');
    expect(input.display).toEqual({ title: 'Example Cabernet', unitPrice: 9800, imageUrl: 'img' });
  });

  it('prefers the customer price for display when pricing is known', () => {
    const input = buildSelectedCartInput(
      { productId: 'prod_123', display: { unitPrice: 5200 } },
      BOTTLE,
      MEMBER_PRICING[0],
    );

    expect(input.display?.unitPrice).toBe(4160);
  });
});
