import { describe, expect, it } from 'vitest';
import type { CartLine } from '../cart/cart-types';
import type { VariationAvailability, VariationPricing } from '../storefront-api/customer-context';
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

function availabilityRow(overrides: Partial<VariationAvailability> = {}): VariationAvailability {
  return {
    productVariationId: 'var_bottle',
    permission: 'purchase',
    canAddToCart: true,
    canAddToWishlist: false,
    quantityLimit: null,
    grantContext: null,
    ...overrides,
  };
}

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
  it('renders the anonymous multi-format purchasable state (scenario 02)', () => {
    const view = buildPurchasePanelView({ variations: [DEMI, BOTTLE, MAGNUM] });

    expect(view.state).toBe('purchasable');
    expect(view.memberBadge).toBeUndefined();
    expect(view.selectedVariationId).toBe('var_bottle');
    expect(view.formats).toEqual([
      { id: 'var_demi', name: 'DEMI', volume: '375 ML', price: '$30', retailPrice: undefined },
      { id: 'var_bottle', name: 'BOTTLE', volume: '750 ML', price: '$52', retailPrice: undefined },
      { id: 'var_magnum', name: 'MAGNUM', volume: '1.5 L', price: '$98', retailPrice: undefined },
    ]);
    expect(view.summary).toEqual({ layout: 'simple', price: '$52', caption: 'BOTTLE · 750 ML' });
    expect(view.canPurchase).toBe(true);
  });

  it('renders member pricing on cards and summary (scenario 05)', () => {
    const view = buildPurchasePanelView({
      variations: [DEMI, BOTTLE, MAGNUM],
      pricing: MEMBER_PRICING,
      memberships: [
        { id: 'wcm_1', clubId: 'club_1', clubName: '2022 Allocation', status: 'active' },
      ],
    });

    expect(view.memberBadge).toBe('SIGNED IN · 2022 ALLOCATION');
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

  it('renders single-format member pricing inline (scenario 01)', () => {
    const view = buildPurchasePanelView({
      variations: [BOTTLE],
      pricing: MEMBER_PRICING,
      memberships: [
        { id: 'wcm_1', clubId: 'club_1', clubName: '2022 Allocation', status: 'active' },
      ],
    });

    expect(view.formats).toBeUndefined();
    expect(view.summary.layout).toBe('member-inline');
    expect(view.summary.savingsNote).toBe('You save $10.40 (20%)');
    // The promotion's name renders verbatim beside the savings note (mock 02).
    expect(view.summary.promotionName).toBe('Allocation Member Discount');
  });

  it('surfaces the club upsell for non-members on a purchasable PDP', () => {
    // Both brand presentations ride the same facts: a primary label+price
    // and a secondary note+cta.
    const clubUpsell = {
      label: 'CLUB PRICE:',
      price: '$41.60',
      note: 'Cellar Club members pay $58.50 (save 10%)',
      cta: { label: 'JOIN THE WINE CLUB →', href: '/wine-club' },
    };

    const anonymous = buildPurchasePanelView({ variations: [BOTTLE], clubUpsell });
    expect(anonymous.state).toBe('purchasable');
    expect(anonymous.clubUpsell).toEqual(clubUpsell);

    const member = buildPurchasePanelView({
      variations: [BOTTLE],
      clubUpsell,
      memberships: [
        { id: 'wcm_1', clubId: 'club_1', clubName: '2022 Allocation', status: 'active' },
      ],
    });
    expect(member.clubUpsell).toBeUndefined();

    // Paused membership is not an active member — the upsell still markets.
    const lapsed = buildPurchasePanelView({
      variations: [BOTTLE],
      clubUpsell,
      memberships: [{ id: 'wcm_1', clubId: 'club_1', clubName: 'Club', status: 'paused' }],
    });
    expect(lapsed.clubUpsell).toEqual(clubUpsell);

    const soldOut = buildPurchasePanelView({
      variations: [BOTTLE],
      clubUpsell,
      availability: EXHAUSTED_AVAILABILITY,
    });
    expect(soldOut.state).toBe('unavailable');
    expect(soldOut.clubUpsell).toBeUndefined();

    const degraded = buildPurchasePanelView({
      variations: [],
      clubUpsell,
      fallbackPriceLabel: '$52',
      hasCartProduct: false,
    });
    expect(degraded.state).toBe('degraded');
    expect(degraded.clubUpsell).toBeUndefined();
  });

  it('renders restricted from the platform entitlement gate for an anonymous visitor (mock 06)', () => {
    const view = buildPurchasePanelView({
      variations: [BOTTLE],
      availability: [availabilityRow({ permission: 'restricted', canAddToCart: false })],
      publicQuantityLimit: 6,
    });

    expect(view.state).toBe('restricted');
    expect(view.scarcityStatus).toBe('LIMITED ALLOCATION');
    expect(view.scarcityCap).toBe('LIMIT 6 PER CUSTOMER');
    expect(view.scarcityNote).toBe(
      'Reserved for select members. Sign in to check your availability.',
    );
    expect(view.unavailableNote).toBeUndefined();
    // Gated, not gone — price stays full-strength but never purchasable.
    expect(view.summary.price).toBe('$52');
    expect(view.canPurchase).toBe(false);
  });

  it('renders purchasable for an entitled visitor on the same gated wine', () => {
    const view = buildPurchasePanelView({
      variations: [BOTTLE],
      availability: [
        availabilityRow({
          permission: 'purchase',
          canAddToCart: true,
          quantityLimit: { limit: 6, redeemed: 0, available: 6 },
        }),
      ],
    });

    expect(view.state).toBe('purchasable');
    expect(view.scarcityStatus).toBeUndefined();
    expect(view.canPurchase).toBe(true);
  });

  it('renders sold out as unavailable, never restricted', () => {
    const view = buildPurchasePanelView({
      variations: [BOTTLE],
      availability: [availabilityRow({ permission: 'unavailable', canAddToCart: false })],
    });

    expect(view.state).toBe('unavailable');
    expect(view.scarcityStatus).toBeUndefined();
    expect(view.unavailableNote).toBe('This wine is not currently available for purchase.');
  });

  it('resolves the gate per selected variation', () => {
    const availability = [
      availabilityRow({ productVariationId: 'var_bottle', permission: 'purchase' }),
      availabilityRow({
        productVariationId: 'var_magnum',
        permission: 'restricted',
        canAddToCart: false,
      }),
    ];

    expect(buildPurchasePanelView({ variations: [BOTTLE, MAGNUM], availability }).state).toBe(
      'purchasable',
    );
    expect(
      buildPurchasePanelView({
        variations: [BOTTLE, MAGNUM],
        availability,
        selectedVariationId: 'var_magnum',
      }).state,
    ).toBe('restricted');
  });

  it('renders by-request when the wishlist path is open — it outranks every dead end (mock 07)', () => {
    const byRequestAvailability: VariationAvailability[] = [
      availabilityRow({ permission: 'wishlist', canAddToCart: false, canAddToWishlist: true }),
    ];

    const view = buildPurchasePanelView({
      variations: [BOTTLE],
      availability: byRequestAvailability,
      requestCap: 2,
      requestHref: '/request/example-cabernet',
    });

    expect(view.state).toBe('by-request');
    expect(view.scarcityStatus).toBe('BY REQUEST');
    expect(view.scarcityCap).toBe('LIMIT 2 REQUESTS PER CUSTOMER');
    expect(view.scarcityNote).toBe(
      'Available by request. Submit a request to purchase — many requests are approved immediately.',
    );
    expect(view.requestCta).toEqual({
      label: 'REQUEST TO PURCHASE',
      href: '/request/example-cabernet',
    });
    expect(view.summary.price).toBe('$52');

    // No destination supplied → facts render, CTA does not.
    const withoutHref = buildPurchasePanelView({
      variations: [BOTTLE],
      availability: byRequestAvailability,
    });
    expect(withoutHref.state).toBe('by-request');
    expect(withoutHref.requestCta).toBeUndefined();

    // An open request path outranks the entitlement gate too.
    expect(
      buildPurchasePanelView({
        variations: [BOTTLE],
        availability: [
          availabilityRow({
            permission: 'restricted',
            canAddToCart: false,
            canAddToWishlist: true,
          }),
        ],
      }).state,
    ).toBe('by-request');
  });

  it('blocks a non-purchase permission even when canAddToCart is set', () => {
    expect(
      buildPurchasePanelView({
        variations: [BOTTLE],
        availability: [availabilityRow({ permission: 'wishlist', canAddToCart: true })],
      }).state,
    ).toBe('unavailable');
  });

  it('fails closed into degraded when the availability read failed', () => {
    const view = buildPurchasePanelView({
      variations: [BOTTLE],
      availability: null,
      availabilityReadFailed: true,
      hasCartProduct: true,
    });

    expect(view.state).toBe('degraded');
    expect(view.summary.price).toBe('$52');
    expect(view.canPurchase).toBe(false);

    // In flight / unknown → the purchasable default (the island keeps the CTA
    // pending until the read settles).
    expect(buildPurchasePanelView({ variations: [BOTTLE], hasCartProduct: true }).state).toBe(
      'purchasable',
    );
  });

  it('keeps in-cart ahead of the entitlement gate and a failed read', () => {
    expect(
      buildPurchasePanelView({
        variations: [BOTTLE],
        availability: [availabilityRow({ permission: 'restricted', canAddToCart: false })],
        cartLines: [BOTTLE_CART_LINE],
      }).state,
    ).toBe('in-cart');
    expect(
      buildPurchasePanelView({
        variations: [BOTTLE],
        availabilityReadFailed: true,
        cartLines: [BOTTLE_CART_LINE],
      }).state,
    ).toBe('in-cart');
  });

  describe('deprecated site-supplied `restricted` input', () => {
    it('escalates to restricted when there is no availability fact', () => {
      expect(buildPurchasePanelView({ variations: [BOTTLE], restricted: true }).state).toBe(
        'restricted',
      );
      expect(
        buildPurchasePanelView({
          variations: [BOTTLE],
          restricted: true,
          availabilityReadFailed: true,
        }).state,
      ).toBe('restricted');
    });

    it('never overrides any platform row — sold out, purchase, or the request path', () => {
      expect(
        buildPurchasePanelView({
          variations: [BOTTLE],
          restricted: true,
          availability: [availabilityRow({ permission: 'unavailable', canAddToCart: false })],
        }).state,
      ).toBe('unavailable');
      expect(
        buildPurchasePanelView({
          variations: [BOTTLE],
          restricted: true,
          availability: [availabilityRow({ permission: 'purchase' })],
        }).state,
      ).toBe('purchasable');
      expect(
        buildPurchasePanelView({
          variations: [BOTTLE],
          restricted: true,
          availability: [
            availabilityRow({
              permission: 'wishlist',
              canAddToCart: false,
              canAddToWishlist: true,
            }),
          ],
        }).state,
      ).toBe('by-request');
    });
  });

  it('omits the promotion name when the pricing preview applied no promotion', () => {
    const view = buildPurchasePanelView({
      variations: [BOTTLE],
      pricing: [
        {
          variationId: 'var_bottle',
          retailPrice: 5200,
          customerPrice: 4160,
          savings: { amount: 1040, basisPoints: 2000 },
          appliedPromotions: [],
        },
      ],
    });

    expect(view.summary.layout).toBe('member-inline');
    expect(view.summary.promotionName).toBeUndefined();
  });

  it('does not show a badge for paused memberships', () => {
    const view = buildPurchasePanelView({
      variations: [BOTTLE],
      memberships: [{ id: 'wcm_1', clubId: 'club_1', clubName: 'Club', status: 'paused' }],
    });

    expect(view.memberBadge).toBeUndefined();
  });

  it('renders the in-cart state with stepper data (scenario 03)', () => {
    const view = buildPurchasePanelView({
      variations: [BOTTLE],
      cartLines: [BOTTLE_CART_LINE],
    });

    expect(view.state).toBe('in-cart');
    expect(view.cartLine).toEqual({ id: 'line_1', quantity: 2 });
    expect(view.cartNote).toBe('2 bottles in your cart');
    expect(view.summary).toEqual({ layout: 'unit', price: '$52', unit: '/ bottle' });
  });

  it('renders the unavailable state from exhausted entitlements (scenario 04)', () => {
    const view = buildPurchasePanelView({
      variations: [BOTTLE],
      availability: EXHAUSTED_AVAILABILITY,
    });

    expect(view.state).toBe('unavailable');
    expect(view.entitlementStatus).toBe('0 OF 6 BOTTLES REMAINING');
    expect(view.unavailableNote).toBe("You've reached your allocation limit for the 2022 release.");
    expect(view.canPurchase).toBe(false);
  });

  it('never renders the system "universal" grant name in the unavailable note', () => {
    const view = buildPurchasePanelView({
      variations: [BOTTLE],
      availability: [
        {
          ...EXHAUSTED_AVAILABILITY[0],
          quantityLimit: { limit: 0, redeemed: 0, available: 0 },
          grantContext: { name: 'universal', endsAt: null },
        },
      ],
    });

    expect(view.state).toBe('unavailable');
    expect(view.unavailableNote).toBe('This wine is not currently available for purchase.');
  });

  it('prefers in-cart over unavailable for an already-carted variation', () => {
    const view = buildPurchasePanelView({
      variations: [BOTTLE],
      availability: EXHAUSTED_AVAILABILITY,
      cartLines: [BOTTLE_CART_LINE],
    });

    expect(view.state).toBe('in-cart');
    expect(view.canIncrement).toBe(false);
  });

  it('caps the stepper from the availability quantity limit', () => {
    const view = buildPurchasePanelView({
      variations: [BOTTLE],
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

  it('caps the stepper from an exceeds_limit cart error', () => {
    const view = buildPurchasePanelView({
      variations: [BOTTLE],
      cartLines: [BOTTLE_CART_LINE],
      errorQuantityLimit: { limit: 6, redeemed: 4, available: 2 },
    });

    expect(view.canIncrement).toBe(false);
  });

  it('falls back to the CMS price label without storefront variations', () => {
    const view = buildPurchasePanelView({ variations: [], fallbackPriceLabel: '$52' });

    expect(view.formats).toBeUndefined();
    expect(view.summary).toEqual({ layout: 'simple', price: '$52', caption: undefined });
    // No affirmative hasCartProduct fact — the mock-cart flow stays purchasable.
    expect(view.state).toBe('purchasable');
    expect(view.canPurchase).toBe(true);
  });

  it('renders the degraded state when no add-to-cart input could be wired (mock 05)', () => {
    const view = buildPurchasePanelView({
      variations: [],
      fallbackPriceLabel: '$52',
      hasCartProduct: false,
    });

    expect(view.state).toBe('degraded');
    expect(view.summary).toEqual({ layout: 'simple', price: '$52', caption: undefined });
    expect(view.canPurchase).toBe(false);
  });

  it('keeps sold-out availability facts ahead of the degraded wiring gap', () => {
    const view = buildPurchasePanelView({
      variations: [BOTTLE],
      availability: EXHAUSTED_AVAILABILITY,
      hasCartProduct: false,
    });

    expect(view.state).toBe('unavailable');
  });

  it('keeps purchasable with no read at all (direct view-model build)', () => {
    const view = buildPurchasePanelView({
      variations: [DEMI, BOTTLE, MAGNUM],
      pricing: null,
      availability: null,
      memberships: null,
    });

    expect(view.state).toBe('purchasable');
    expect(view.summary.price).toBe('$52');
    expect(view.formats?.every((format) => format.retailPrice === undefined)).toBe(true);
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
