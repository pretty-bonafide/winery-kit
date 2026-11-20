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

  it('asserts restricted only from the affirmative offer flag (mock 06)', () => {
    const view = buildPurchasePanelView({
      variations: [BOTTLE],
      restricted: true,
      publicQuantityLimit: 6,
    });

    expect(view.state).toBe('restricted');
    expect(view.scarcityStatus).toBe('LIMITED ALLOCATION');
    expect(view.scarcityCap).toBe('LIMIT 6 PER CUSTOMER');
    expect(view.scarcityNote).toBe(
      'Reserved for select members. Sign in to check your availability.',
    );
    // Gated, not gone — price stays full-strength but never purchasable.
    expect(view.summary.price).toBe('$52');
    expect(view.canPurchase).toBe(false);

    // Unknown gate → the public catalog default.
    expect(buildPurchasePanelView({ variations: [BOTTLE] }).state).toBe('purchasable');
  });

  it('lets affirmative purchase facts override the restricted gate (entitled visitor)', () => {
    const view = buildPurchasePanelView({
      variations: [BOTTLE],
      restricted: true,
      availability: [
        {
          productVariationId: 'var_bottle',
          permission: 'purchase',
          canAddToCart: true,
          canAddToWishlist: false,
          quantityLimit: { limit: 6, redeemed: 0, available: 6 },
          grantContext: null,
        },
      ],
    });

    expect(view.state).toBe('purchasable');
    expect(view.scarcityStatus).toBeUndefined();
  });

  it('renders by-request when the wishlist path is open — it outranks every dead end (mock 07)', () => {
    const byRequestAvailability: VariationAvailability[] = [
      {
        productVariationId: 'var_bottle',
        permission: 'wishlist',
        canAddToCart: false,
        canAddToWishlist: true,
        quantityLimit: null,
        grantContext: null,
      },
    ];

    const view = buildPurchasePanelView({
      variations: [BOTTLE],
      restricted: true, // by-request still wins over restricted
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
  });

  describe('a permission the platform denies this visitor', () => {
    // The anonymous read for a wine with no public purchase permission:
    // status restricted → permission unavailable, nothing in the cap.
    const DENIED: VariationAvailability[] = [
      {
        productVariationId: 'var_bottle',
        permission: 'unavailable',
        canAddToCart: false,
        canAddToWishlist: false,
        quantityLimit: null,
        grantContext: null,
      },
    ];

    it('is members-only for an anonymous visitor: the members sentence, sign in, the waiting list', () => {
      const view = buildPurchasePanelView({
        variations: [BOTTLE],
        availability: DENIED,
        isAuthenticated: false,
        waitingListHref: '/membership',
        signInHref: '/api/auth/login',
      });

      expect(view.state).toBe('members-only');
      expect(view.membersOnlyNote).toBe(
        'Reserved for select members. Sign in to check your availability.',
      );
      expect(view.signInCta).toEqual({ label: 'SIGN IN', href: '/api/auth/login' });
      expect(view.waitingListCta).toEqual({
        label: 'JOIN THE WAITING LIST',
        href: '/membership',
      });
      expect(view.unavailableNote).toBeUndefined();
      expect(view.canPurchase).toBe(false);
      // The price stays visible: gated, not gone.
      expect(view.summary.price).toBe('$52');
    });

    it('is not-allocated for a signed-in customer: the allocation copy and the waiting list, no sign-in', () => {
      const view = buildPurchasePanelView({
        variations: [BOTTLE],
        availability: DENIED,
        isAuthenticated: true,
        waitingListHref: '/membership',
        signInHref: '/api/auth/login',
      });

      expect(view.state).toBe('not-allocated');
      expect(view.unavailableNote).toBe('Not in your current allocation');
      expect(view.waitingListCta).toEqual({
        label: 'JOIN THE WAITING LIST',
        href: '/membership',
      });
      expect(view.signInCta).toBeUndefined();
      expect(view.membersOnlyNote).toBeUndefined();
      expect(view.canPurchase).toBe(false);
    });

    it('offers only what the site wired: no sign-in href, no sign-in action; no waiting-list href, no waiting-list CTA', () => {
      const anonymous = buildPurchasePanelView({
        variations: [BOTTLE],
        availability: DENIED,
        isAuthenticated: false,
      });
      expect(anonymous.state).toBe('members-only');
      expect(anonymous.signInCta).toBeUndefined();
      expect(anonymous.waitingListCta).toBeUndefined();

      const signedIn = buildPurchasePanelView({
        variations: [BOTTLE],
        availability: DENIED,
        isAuthenticated: true,
      });
      expect(signedIn.state).toBe('not-allocated');
      expect(signedIn.waitingListCta).toBeUndefined();
    });

    it('stays unavailable, exactly as 0.7.1, when who is signed in is unknown', () => {
      const view = buildPurchasePanelView({
        variations: [BOTTLE],
        availability: DENIED,
        waitingListHref: '/membership',
        signInHref: '/api/auth/login',
      });

      expect(view.state).toBe('unavailable');
      expect(view.unavailableNote).toBe('This wine is not currently available for purchase.');
      expect(view.signInCta).toBeUndefined();
      expect(view.waitingListCta).toBeUndefined();
      expect(view.membersOnlyNote).toBeUndefined();
    });

    it('offers SIGN IN only to a visitor known to be signed out', () => {
      const base = { variations: [BOTTLE], availability: DENIED, signInHref: '/api/auth/login' };
      expect(buildPurchasePanelView({ ...base, isAuthenticated: false }).signInCta).toBeDefined();
      expect(buildPurchasePanelView(base).signInCta).toBeUndefined();
      expect(buildPurchasePanelView({ ...base, isAuthenticated: true }).signInCta).toBeUndefined();
    });

    it('does not read a named grant as a used-up allocation for a retail denial', () => {
      const granted: VariationAvailability[] = [
        { ...DENIED[0], grantContext: { name: '2024 Release', endsAt: null } },
      ];
      expect(
        buildPurchasePanelView({
          variations: [BOTTLE],
          availability: granted,
          isAuthenticated: true,
        }).unavailableNote,
      ).toBe('Not in your current allocation');
    });

    it('keeps an open request path ahead of it, for either visitor', () => {
      const requestable: VariationAvailability[] = [{ ...DENIED[0], canAddToWishlist: true }];
      for (const isAuthenticated of [false, true]) {
        const view = buildPurchasePanelView({
          variations: [BOTTLE],
          availability: requestable,
          isAuthenticated,
          signInHref: '/api/auth/login',
          waitingListHref: '/membership',
        });
        expect(view.state).toBe('by-request');
        expect(view.signInCta).toBeUndefined();
        expect(view.waitingListCta).toBeUndefined();
      }
    });

    it('keeps an explicit restricted input on the restricted state', () => {
      for (const isAuthenticated of [false, true]) {
        const view = buildPurchasePanelView({
          variations: [BOTTLE],
          availability: DENIED,
          restricted: true,
          isAuthenticated,
          signInHref: '/api/auth/login',
        });
        expect(view.state).toBe('restricted');
        expect(view.signInCta).toBeUndefined();
      }
    });

    it('keeps a used-up cap unavailable, even when the permission also reads denied', () => {
      for (const isAuthenticated of [false, true]) {
        expect(
          buildPurchasePanelView({
            variations: [BOTTLE],
            availability: EXHAUSTED_AVAILABILITY,
            isAuthenticated,
            signInHref: '/api/auth/login',
            waitingListHref: '/membership',
          }),
        ).toMatchObject({ state: 'unavailable', signInCta: undefined, waitingListCta: undefined });

        const capAndDenied: VariationAvailability[] = [
          { ...DENIED[0], quantityLimit: { limit: 6, redeemed: 6, available: 0 } },
        ];
        expect(
          buildPurchasePanelView({
            variations: [BOTTLE],
            availability: capAndDenied,
            isAuthenticated,
          }).state,
        ).toBe('unavailable');
      }
    });

    it('treats a denied add-to-cart with no cap as the same denial', () => {
      const blocked: VariationAvailability[] = [
        { ...DENIED[0], permission: 'purchase', canAddToCart: false },
      ];
      expect(
        buildPurchasePanelView({
          variations: [BOTTLE],
          availability: blocked,
          isAuthenticated: false,
        }).state,
      ).toBe('members-only');
    });

    it('keeps a sold-out wine unavailable, for either visitor', () => {
      const soldOut: VariationAvailability[] = [{ ...DENIED[0], status: 'sold_out' }];
      for (const isAuthenticated of [false, true]) {
        expect(
          buildPurchasePanelView({
            variations: [BOTTLE],
            availability: soldOut,
            isAuthenticated,
            signInHref: '/api/auth/login',
          }),
        ).toMatchObject({ state: 'unavailable', signInCta: undefined });
      }
      // The wire status `restricted` is the denial.
      const restricted: VariationAvailability[] = [{ ...DENIED[0], status: 'restricted' }];
      expect(
        buildPurchasePanelView({
          variations: [BOTTLE],
          availability: restricted,
          isAuthenticated: false,
        }).state,
      ).toBe('members-only');
    });

    it('keeps in-cart ahead of it', () => {
      const view = buildPurchasePanelView({
        variations: [BOTTLE],
        availability: DENIED,
        cartLines: [BOTTLE_CART_LINE],
      });
      expect(view.state).toBe('in-cart');
    });

    it('is not asserted without an availability read', () => {
      expect(buildPurchasePanelView({ variations: [BOTTLE] }).state).toBe('purchasable');
      expect(
        buildPurchasePanelView({ variations: [BOTTLE], availability: null, isAuthenticated: true })
          .state,
      ).toBe('purchasable');
    });
  });

  describe('the retail ladder, row by row', () => {
    const open = { ...EXHAUSTED_AVAILABILITY[0], canAddToCart: true, quantityLimit: null };
    const denied = { ...open, permission: 'unavailable' as const, canAddToCart: false };
    const requestable = { ...denied, permission: 'wishlist' as const, canAddToWishlist: true };
    const capped = EXHAUSTED_AVAILABILITY[0];
    const soldOut = { ...denied, status: 'sold_out' as const };
    // The cap alone blocks: the add-to-cart flag still says yes.
    const capOnly = { ...open, quantityLimit: { limit: 6, redeemed: 6, available: 0 } };

    // [name, input, anonymous state, signed-in state, unknown (no session) state]
    it.each([
      [
        'in the cart, denied',
        { availability: [denied], cartLines: [BOTTLE_CART_LINE] },
        'in-cart',
        'in-cart',
        'in-cart',
      ],
      [
        'open request path',
        { availability: [requestable], restricted: true },
        'by-request',
        'by-request',
        'by-request',
      ],
      [
        'restricted input, denied',
        { availability: [denied], restricted: true },
        'restricted',
        'restricted',
        'restricted',
      ],
      ['restricted input, no read', { restricted: true }, 'restricted', 'restricted', 'restricted'],
      ['denied', { availability: [denied] }, 'members-only', 'not-allocated', 'unavailable'],
      ['used-up cap', { availability: [capped] }, 'unavailable', 'unavailable', 'unavailable'],
      [
        'cap alone (canAddToCart true)',
        { availability: [capOnly] },
        'unavailable',
        'unavailable',
        'unavailable',
      ],
      ['sold out', { availability: [soldOut] }, 'unavailable', 'unavailable', 'unavailable'],
      ['open', { availability: [open] }, 'purchasable', 'purchasable', 'purchasable'],
      ['no read', {}, 'purchasable', 'purchasable', 'purchasable'],
      ['no cart input', { hasCartProduct: false }, 'degraded', 'degraded', 'degraded'],
    ] as const)('%s', (_, input, anonymous, signedIn, unknown) => {
      const base = { variations: [BOTTLE], ...input } as Parameters<
        typeof buildPurchasePanelView
      >[0];
      expect(buildPurchasePanelView({ ...base, isAuthenticated: false }).state).toBe(anonymous);
      expect(buildPurchasePanelView({ ...base, isAuthenticated: true }).state).toBe(signedIn);
      expect(buildPurchasePanelView(base).state).toBe(unknown);
    });
  });

  it('keeps in-cart ahead of the restricted gate', () => {
    const view = buildPurchasePanelView({
      variations: [BOTTLE],
      restricted: true,
      cartLines: [BOTTLE_CART_LINE],
    });

    expect(view.state).toBe('in-cart');
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

  it('degrades to retail when pricing and availability are null (fetch failed)', () => {
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
