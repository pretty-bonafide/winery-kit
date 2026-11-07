import { describe, expect, it, vi } from 'vitest';
import {
  createCustomerContextClient,
  parseAvailabilityResponse,
  parseMembershipsResponse,
  parsePricingPreviewResponse,
  parsePurchaseContextResponse,
} from './customer-context';

const CONFIG = { baseUrl: 'https://api.example.com/public/v1/', publishableKey: 'pk_test' };

describe('parsePricingPreviewResponse', () => {
  it('normalizes pricing entries', () => {
    const result = parsePricingPreviewResponse({
      pricing: [
        {
          variationId: 'var_bottle',
          retailPrice: 5200,
          customerPrice: 4160,
          savings: { amount: 1040, basisPoints: 2000 },
          appliedPromotions: [
            { id: 'promo_member', name: 'Allocation Member Discount', description: '20% off' },
          ],
        },
      ],
    });

    expect(result).toEqual([
      {
        variationId: 'var_bottle',
        retailPrice: 5200,
        customerPrice: 4160,
        savings: { amount: 1040, basisPoints: 2000 },
        appliedPromotions: [
          { id: 'promo_member', name: 'Allocation Member Discount', description: '20% off' },
        ],
      },
    ]);
  });

  it('returns null on a malformed body', () => {
    expect(parsePricingPreviewResponse({ pricing: [{ variationId: '' }] })).toBeNull();
    expect(parsePricingPreviewResponse(null)).toBeNull();
  });
});

describe('parseAvailabilityResponse', () => {
  it('translates the wire status/grant into the panel domain model', () => {
    const result = parseAvailabilityResponse({
      availability: [
        {
          productVariationId: 'var_bottle',
          status: 'available',
          canAddToCart: true,
          canAddToWishlist: false,
          // `basis` is part of the live contract and is dropped at this boundary.
          quantityLimit: { limit: 6, redeemed: 6, available: 0, basis: 'per_customer' },
          grant: { name: '2022 release', endsAt: null },
        },
      ],
    });

    expect(result).toEqual([
      {
        productVariationId: 'var_bottle',
        permission: 'purchase',
        canAddToCart: true,
        canAddToWishlist: false,
        quantityLimit: { limit: 6, redeemed: 6, available: 0 },
        grantContext: { name: '2022 release', endsAt: null },
      },
    ]);
  });

  it('maps every availability status onto a purchase permission', () => {
    const permissionFor = (status: string) =>
      parseAvailabilityResponse({
        availability: [
          {
            productVariationId: 'var_bottle',
            status,
            canAddToCart: false,
            canAddToWishlist: false,
            quantityLimit: null,
          },
        ],
      })?.[0]?.permission;

    expect(permissionFor('available')).toBe('purchase');
    expect(permissionFor('by_request')).toBe('wishlist');
    // The entitlement gate survives the boundary — the retail ladder renders it
    // as `restricted`, distinct from the sold-out dead end.
    expect(permissionFor('restricted')).toBe('restricted');
    expect(permissionFor('sold_out')).toBe('unavailable');
  });

  it('defaults a missing grant to null', () => {
    const result = parseAvailabilityResponse({
      availability: [
        {
          productVariationId: 'var_bottle',
          status: 'restricted',
          canAddToCart: false,
          canAddToWishlist: false,
          quantityLimit: null,
        },
      ],
    });

    expect(result?.[0]?.grantContext).toBeNull();
  });

  it('returns null on an unknown status', () => {
    expect(
      parseAvailabilityResponse({
        availability: [
          {
            productVariationId: 'var_bottle',
            status: 'on_backorder',
            canAddToCart: false,
            canAddToWishlist: false,
            quantityLimit: null,
          },
        ],
      }),
    ).toBeNull();
  });
});

describe('parseMembershipsResponse', () => {
  it('normalizes memberships', () => {
    const result = parseMembershipsResponse({
      memberships: [
        { id: 'wcm_abc', clubId: 'club_123', clubName: '2022 Allocation', status: 'active' },
      ],
    });

    expect(result).toEqual([
      { id: 'wcm_abc', clubId: 'club_123', clubName: '2022 Allocation', status: 'active' },
    ]);
  });

  it('returns null on an unknown status', () => {
    expect(
      parseMembershipsResponse({
        memberships: [{ id: 'wcm_abc', clubId: 'club_123', clubName: 'Club', status: 'cancelled' }],
      }),
    ).toBeNull();
  });
});

describe('parsePurchaseContextResponse', () => {
  it('normalizes pricing, availability, and memberships from the combined response', () => {
    const result = parsePurchaseContextResponse({
      pricing: [
        {
          variationId: 'var_bottle',
          retailPrice: 5200,
          customerPrice: 4160,
          savings: { amount: 1040, basisPoints: 2000 },
          appliedPromotions: [
            { id: 'promo_member', name: 'Allocation Member Discount', description: '20% off' },
          ],
        },
      ],
      availability: [
        {
          productVariationId: 'var_bottle',
          status: 'available',
          canAddToCart: true,
          canAddToWishlist: false,
          quantityLimit: { limit: 6, redeemed: 1, available: 5, basis: 'per_customer' },
          grant: { name: '2022 release', endsAt: null },
        },
      ],
      memberships: [
        { id: 'wcm_abc', clubId: 'club_123', clubName: '2022 Allocation', status: 'active' },
      ],
    });

    expect(result).toEqual({
      pricing: [
        {
          variationId: 'var_bottle',
          retailPrice: 5200,
          customerPrice: 4160,
          savings: { amount: 1040, basisPoints: 2000 },
          appliedPromotions: [
            { id: 'promo_member', name: 'Allocation Member Discount', description: '20% off' },
          ],
        },
      ],
      availability: [
        {
          productVariationId: 'var_bottle',
          permission: 'purchase',
          canAddToCart: true,
          canAddToWishlist: false,
          quantityLimit: { limit: 6, redeemed: 1, available: 5 },
          grantContext: { name: '2022 release', endsAt: null },
        },
      ],
      memberships: [
        { id: 'wcm_abc', clubId: 'club_123', clubName: '2022 Allocation', status: 'active' },
      ],
    });
  });

  it('carries the anonymous entitlement gate verbatim from the platform', () => {
    // What anonymous POST /purchase-context returns for a members-only wine.
    const result = parsePurchaseContextResponse({
      pricing: [],
      memberships: [],
      availability: [
        {
          productVariationId: 'var_bottle',
          status: 'restricted',
          canAddToCart: false,
          canAddToWishlist: false,
          quantityLimit: null,
          grant: null,
        },
      ],
    });

    expect(result?.availability).toEqual([
      {
        productVariationId: 'var_bottle',
        permission: 'restricted',
        canAddToCart: false,
        canAddToWishlist: false,
        quantityLimit: null,
        grantContext: null,
      },
    ]);
  });

  it('returns null when any combined block is malformed', () => {
    expect(
      parsePurchaseContextResponse({ pricing: [], availability: [], memberships: [] }),
    ).toEqual({
      pricing: [],
      availability: [],
      memberships: [],
    });
    expect(
      parsePurchaseContextResponse({
        pricing: [],
        availability: [{ productVariationId: 'var_bottle', status: 'unknown' }],
        memberships: [],
      }),
    ).toBeNull();
  });
});

describe('createCustomerContextClient', () => {
  it('sends credentialed POSTs with the publishable key', async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ pricing: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    const client = createCustomerContextClient(CONFIG, { fetcher });

    await client.fetchPricingPreview(['var_bottle']);

    const [url, init] = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.example.com/public/v1/pricing/preview');
    expect(init.credentials).toBe('include');
    expect(init.method).toBe('POST');
    expect((init.headers as Headers).get('X-Publishable-Key')).toBe('pk_test');
    expect(JSON.parse(init.body as string)).toEqual({ variationIds: ['var_bottle'] });
  });

  it('reads entitlement availability from POST /availability/customer', async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ availability: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    const client = createCustomerContextClient(CONFIG, { fetcher });

    await client.fetchEntitlementAvailability(['var_bottle']);

    const [url, init] = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.example.com/public/v1/availability/customer');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ variationIds: ['var_bottle'] });
  });

  it('degrades to null on network failure', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const client = createCustomerContextClient(CONFIG, { fetcher });

    expect(await client.fetchMemberships()).toBeNull();
  });

  it('degrades to null on a non-2xx response', async () => {
    const fetcher = vi.fn(
      async () => new Response('{}', { status: 500 }),
    ) as unknown as typeof fetch;
    const client = createCustomerContextClient(CONFIG, { fetcher });

    expect(await client.fetchEntitlementAvailability(['var_bottle'])).toBeNull();
  });

  it('reads combined customer context from POST /purchase-context', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ pricing: [], availability: [], memberships: [] }), {
          status: 200,
        }),
    ) as unknown as typeof fetch;
    const client = createCustomerContextClient(CONFIG, { fetcher });

    expect(await client.fetchPurchaseContext(['var_bottle'])).toEqual({
      pricing: [],
      availability: [],
      memberships: [],
    });

    const [url, init] = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.example.com/public/v1/purchase-context');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toEqual({ variationIds: ['var_bottle'] });
  });

  it('skips the request entirely for an empty id list', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const client = createCustomerContextClient(CONFIG, { fetcher });

    expect(await client.fetchPricingPreview([])).toEqual([]);
    expect(await client.fetchPurchaseContext([])).toEqual({
      availability: [],
      memberships: [],
      pricing: [],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
