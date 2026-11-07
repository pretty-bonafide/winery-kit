import { afterEach, describe, expect, it, vi } from 'vitest';

const CONFIG = { baseUrl: 'https://api.example.com/public/v1/', publishableKey: 'pk_test' };

async function loadStore() {
  vi.resetModules();
  return import('./customer-commerce-store');
}

function purchaseContextResponse() {
  return {
    pricing: [
      {
        variationId: 'var_a',
        retailPrice: 5200,
        customerPrice: 4160,
        savings: { amount: 1040, basisPoints: 2000 },
        appliedPromotions: [],
      },
    ],
    availability: [
      {
        productVariationId: 'var_a',
        status: 'available',
        canAddToCart: true,
        canAddToWishlist: false,
        quantityLimit: { limit: 6, redeemed: 1, available: 5, basis: 'per_customer' },
      },
    ],
    memberships: [{ id: 'mem_1', clubId: 'club_1', clubName: 'Allocation', status: 'active' }],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('customerCommerceStore', () => {
  it('batches customer commerce reads for the configured variation ids', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify(purchaseContextResponse()), { status: 200 });
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetcher);
    const { customerCommerceStore } = await loadStore();

    customerCommerceStore.configure({
      storefrontApi: CONFIG,
      variationIds: ['var_b', 'var_a', 'var_a'],
    });
    await customerCommerceStore.refresh();

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.example.com/public/v1/purchase-context');
    expect(JSON.parse(init.body as string)).toEqual({ variationIds: ['var_a', 'var_b'] });
    expect(customerCommerceStore.getSnapshot()).toMatchObject({
      availability: [
        {
          canAddToCart: true,
          permission: 'purchase',
          productVariationId: 'var_a',
        },
      ],
      error: null,
      isConfigured: true,
      isLoading: false,
      memberships: [{ clubName: 'Allocation' }],
      pricing: [{ variationId: 'var_a', customerPrice: 4160 }],
      variationIds: ['var_a', 'var_b'],
    });
  });

  it('does not fetch without storefront API configuration', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetcher);
    const { customerCommerceStore } = await loadStore();

    customerCommerceStore.configure({ variationIds: ['var_a'] });
    await customerCommerceStore.refresh();

    expect(fetcher).not.toHaveBeenCalled();
    expect(customerCommerceStore.getSnapshot()).toMatchObject({
      availability: null,
      isConfigured: true,
      isLoading: false,
      memberships: null,
      pricing: null,
      variationIds: ['var_a'],
    });
  });

  it('does not refetch when the effective configuration is unchanged', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify(purchaseContextResponse()), { status: 200 });
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetcher);
    const { customerCommerceStore } = await loadStore();

    customerCommerceStore.configure({ storefrontApi: CONFIG, variationIds: ['var_b', 'var_a'] });
    await customerCommerceStore.refresh();
    customerCommerceStore.configure({ storefrontApi: CONFIG, variationIds: ['var_a', 'var_b'] });

    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
