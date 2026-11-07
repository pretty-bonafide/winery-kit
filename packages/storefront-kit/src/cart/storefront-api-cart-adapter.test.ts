import { describe, expect, it, vi } from 'vitest';
import { CartRequestError } from './cart-types';
import type { CartTokenStorage } from './storefront-api-cart-adapter';
import { createStorefrontApiCartAdapter } from './storefront-api-cart-adapter';
import {
  normalizeStorefrontCartResponse,
  type StorefrontCartResponse,
  storefrontCartResponseSchema,
} from './storefront-api-schemas';

const CHECKOUT_RESPONSE = JSON.stringify({
  checkoutUrl: 'https://store.example.com/checkout/abc',
  sessionId: 'session-1',
});

function createMemoryTokenStorage(token: string | null = 'cart-token-1'): CartTokenStorage {
  let current = token;
  return {
    getCartToken: () => current,
    setCartToken: (value) => {
      current = value;
    },
    clearCartToken: () => {
      current = null;
    },
  };
}

function createAdapter() {
  const fetcher = vi.fn(
    async () => new Response(CHECKOUT_RESPONSE, { status: 200 }),
  ) as unknown as typeof fetch;

  const adapter = createStorefrontApiCartAdapter({
    baseUrl: 'https://api.example.com/public/v1',
    publishableKey: 'pk_test',
    tokenStorage: createMemoryTokenStorage(),
    fetcher,
  });

  return { adapter, fetcher: fetcher as ReturnType<typeof vi.fn> };
}

function requestBody(fetcher: ReturnType<typeof vi.fn>): unknown {
  const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string);
}

function createFailingAdapter(body: unknown, status = 400) {
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;

  return createStorefrontApiCartAdapter({
    baseUrl: 'https://api.example.com/public/v1',
    publishableKey: 'pk_test',
    tokenStorage: createMemoryTokenStorage(),
    fetcher,
  });
}

async function captureCartError(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(CartRequestError);
    return error as CartRequestError;
  }
  throw new Error('expected the cart request to throw');
}

describe('error mapping', () => {
  it('maps the exceeds_limit reason to allocation_exceeded with the quantity limit', async () => {
    const adapter = createFailingAdapter({
      code: 'BAD_REQUEST',
      message: 'Maximum available: 6',
      data: {
        reason: 'exceeds_limit',
        quantityLimit: { limit: 6, redeemed: 6, available: 0 },
      },
    });

    const error = await captureCartError(() =>
      adapter.addItem({ productId: 'prod_1', purchaseOptionId: 'var_1' }),
    );

    expect(error.code).toBe('allocation_exceeded');
    expect(error.quantityLimit).toEqual({ limit: 6, redeemed: 6, available: 0 });
  });

  it.each([
    ['insufficient_stock', 'item_unavailable'],
    ['out_of_stock', 'item_unavailable'],
    ['invalid_request', 'invalid_quantity'],
  ])('maps the %s reason to %s', async (reason, code) => {
    const adapter = createFailingAdapter({
      code: 'BAD_REQUEST',
      message: 'Request failed',
      data: { reason },
    });

    const error = await captureCartError(() =>
      adapter.addItem({ productId: 'prod_1', purchaseOptionId: 'var_1' }),
    );

    expect(error.code).toBe(code);
    expect(error.quantityLimit).toBeUndefined();
  });

  it('falls back to substring matching for unrecognized reasons', async () => {
    const adapter = createFailingAdapter({
      message: 'Allocation limit reached',
      data: { reason: 'entitlement_limit_reached' },
    });

    const error = await captureCartError(() =>
      adapter.addItem({ productId: 'prod_1', purchaseOptionId: 'var_1' }),
    );

    expect(error.code).toBe('allocation_exceeded');
  });
});

describe('createCheckout', () => {
  it('sends utm params in the session body', async () => {
    const { adapter, fetcher } = createAdapter();

    const result = await adapter.createCheckout({ utm: { source: 'ig', campaign: 'spring' } });

    expect(requestBody(fetcher)).toEqual({ utm: { source: 'ig', campaign: 'spring' } });
    expect(result).toEqual({ url: 'https://store.example.com/checkout/abc' });
  });

  it('pins checkout redirects to the configured checkout origin', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            checkoutUrl: 'https://marketing.example.com/checkout/abc?session=1#payment',
            sessionId: 'session-1',
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const adapter = createStorefrontApiCartAdapter({
      baseUrl: 'https://api.example.com/public/v1',
      checkoutOrigin: 'https://store.example.com/ignored-path',
      publishableKey: 'pk_test',
      tokenStorage: createMemoryTokenStorage(),
      fetcher,
    });

    const result = await adapter.createCheckout();

    expect(result).toEqual({
      url: 'https://store.example.com/checkout/abc?session=1#payment',
    });
  });

  it('sends an empty body without utm params', async () => {
    const { adapter, fetcher } = createAdapter();

    await adapter.createCheckout();
    expect(requestBody(fetcher)).toEqual({});
  });

  it('sends an empty body when the utm record has no keys', async () => {
    const { adapter, fetcher } = createAdapter();

    await adapter.createCheckout({ utm: {} });
    expect(requestBody(fetcher)).toEqual({});
  });
});

describe('getCart / getPromotions', () => {
  it('reads cart lines without quoting promotions', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 'draft_1',
            items: [
              {
                id: 'item_1',
                productVariationId: 'var_1',
                name: 'Cabernet',
                price: 5200,
                quantity: 2,
              },
            ],
            subtotal: 10400,
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const adapter = createStorefrontApiCartAdapter({
      baseUrl: 'https://api.example.com/public/v1',
      publishableKey: 'pk_test',
      tokenStorage: createMemoryTokenStorage('cart-token-1'),
      fetcher,
    });

    const cart = await adapter.getCart();

    expect(cart.itemCount).toBe(2);
    expect('promotions' in cart).toBe(false);
    const urls = (fetcher as ReturnType<typeof vi.fn>).mock.calls.map(([url]) => String(url));
    expect(urls).toEqual(['https://api.example.com/public/v1/carts/current']);
  });

  it('getPromotions quotes the cart and normalizes order promotions', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/carts/current')) {
        return new Response(
          JSON.stringify({
            id: 'draft_1',
            items: [
              {
                id: 'item_1',
                productVariationId: 'var_1',
                productSlug: 'cabernet',
                name: 'Cabernet',
                unitName: '750ml',
                price: 5200,
                quantity: 2,
              },
            ],
            subtotal: 10400,
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          drafts: [
            {
              calculation: {
                promotionDisplay: {
                  progress: [
                    {
                      promotionId: 'promo_free_ship',
                      message: 'Add $20.00 more for FREE ground shipping',
                      percentComplete: 60,
                      hasFreeShipping: true,
                    },
                  ],
                  appliedPromotions: [
                    {
                      id: 'promo_spring',
                      name: 'Spring Sale',
                      description: 'Save on the spring release',
                      hasFreeShipping: false,
                    },
                  ],
                },
              },
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const adapter = createStorefrontApiCartAdapter({
      baseUrl: 'https://api.example.com/public/v1',
      publishableKey: 'pk_test',
      tokenStorage: createMemoryTokenStorage('cart-token-1'),
      fetcher,
    });

    const promotions = await adapter.getPromotions?.();

    expect(promotions).toEqual([
      {
        id: 'promo_free_ship',
        title: 'Free shipping',
        applied: false,
        nudge: 'Add $20.00 more for FREE ground shipping',
        progress: 0.6,
      },
      {
        id: 'promo_spring',
        title: 'Spring Sale',
        applied: true,
      },
    ]);
    const quoteCall = (fetcher as ReturnType<typeof vi.fn>).mock.calls.find(([url]) =>
      String(url).endsWith('/checkout/quote'),
    );
    expect(quoteCall?.[1]).toMatchObject({ method: 'POST' });
    expect((quoteCall?.[1] as RequestInit).headers).toBeInstanceOf(Headers);
    expect(((quoteCall?.[1] as RequestInit).headers as Headers).get('X-Cart-Token')).toBe(
      'cart-token-1',
    );
  });

  it('resets the cart when the platform rejects the cart token (401)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tokenStorage = createMemoryTokenStorage('stale-token');
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ code: 'UNAUTHORIZED', status: 401, message: 'Invalid cart token' }),
          { status: 401 },
        ),
    ) as unknown as typeof fetch;
    const adapter = createStorefrontApiCartAdapter({
      baseUrl: 'https://api.example.com/public/v1',
      publishableKey: 'pk_test',
      tokenStorage,
      fetcher,
    });

    const cart = await adapter.getCart();

    expect(cart.itemCount).toBe(0);
    expect(tokenStorage.getCartToken()).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('cart token rejected'));
    consoleError.mockRestore();
  });

  it('does NOT reset the cart on the token_expired refresh contract', async () => {
    const tokenStorage = createMemoryTokenStorage('valid-cart-token');
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ error: 'token_expired' }), { status: 401 }),
    ) as unknown as typeof fetch;
    const adapter = createStorefrontApiCartAdapter({
      baseUrl: 'https://api.example.com/public/v1',
      publishableKey: 'pk_test',
      tokenStorage,
      fetcher,
    });

    const error = await captureCartError(() => adapter.getCart());

    expect(error.code).toBe('authentication_required');
    expect(error.reason).toBe('token_expired');
    expect(tokenStorage.getCartToken()).toBe('valid-cart-token');
  });

  it('getPromotions rejects when the quote fails, so the store can retry it', async () => {
    const fetcher = vi.fn(
      async () => new Response('{}', { status: 500 }),
    ) as unknown as typeof fetch;
    const adapter = createStorefrontApiCartAdapter({
      baseUrl: 'https://api.example.com/public/v1',
      publishableKey: 'pk_test',
      tokenStorage: createMemoryTokenStorage('cart-token-1'),
      fetcher,
    });

    await expect(adapter.getPromotions?.()).rejects.toBeInstanceOf(CartRequestError);
  });

  it('getPromotions makes no request without a cart token', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const adapter = createStorefrontApiCartAdapter({
      baseUrl: 'https://api.example.com/public/v1',
      publishableKey: 'pk_test',
      tokenStorage: createMemoryTokenStorage(null),
      fetcher,
    });

    await expect(adapter.getPromotions?.()).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('normalizeStorefrontCartResponse line titles', () => {
  function titleOf(item: Record<string, unknown>): string | undefined {
    const response: StorefrontCartResponse = storefrontCartResponseSchema.parse({
      id: 'draft_1',
      items: [{ id: 'item_1', quantity: 1, price: 3200, ...item }],
    });
    return normalizeStorefrontCartResponse(response).lines[0]?.title;
  }

  it('titles an option (merch) line from storedName when unitName is null', () => {
    expect(
      titleOf({
        name: 'Anniversary Logo Hat',
        unitName: null,
        storedName: 'Anniversary Logo Hat — Black',
      }),
    ).toBe('Anniversary Logo Hat — Black');
  });

  it('keeps the name + unitName title for a wine line without storedName', () => {
    expect(titleOf({ name: '2022 Estate Reserve', unitName: 'Magnum 1.5 L' })).toBe(
      '2022 Estate Reserve Magnum 1.5 L',
    );
  });

  it('titles a wine line with storedName identically to the name + unitName rule', () => {
    const withStoredName = titleOf({
      name: '2022 Estate Reserve',
      unitName: 'Magnum 1.5 L',
      storedName: '2022 Estate Reserve Magnum 1.5 L',
    });
    expect(withStoredName).toBe('2022 Estate Reserve Magnum 1.5 L');
    expect(withStoredName).toBe(titleOf({ name: '2022 Estate Reserve', unitName: 'Magnum 1.5 L' }));
  });

  it('falls back to name + unitName when storedName is empty or blank', () => {
    expect(titleOf({ name: '2022 Estate Reserve', unitName: 'Magnum 1.5 L', storedName: '' })).toBe(
      '2022 Estate Reserve Magnum 1.5 L',
    );
    expect(titleOf({ name: 'Logo Hat', unitName: null, storedName: '   ' })).toBe('Logo Hat');
  });
});

describe('cart token rejection self-heal (mutations)', () => {
  const INVALID_TOKEN_BODY = JSON.stringify({
    code: 'UNAUTHORIZED',
    status: 401,
    message: 'Invalid cart token',
  });

  function createRotatedSecretHarness() {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tokenStorage = createMemoryTokenStorage('stale-token');
    const itemPosts: string[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const token = (init?.headers as Headers | undefined)?.get('X-Cart-Token');
      if (url.endsWith('/carts') && method === 'POST') {
        return new Response(JSON.stringify({ cartToken: 'fresh-token', draftId: 'draft_2' }), {
          status: 200,
        });
      }
      if (url.endsWith('/carts/current/items') && method === 'POST') {
        itemPosts.push(token ?? '<none>');
        if (token !== 'fresh-token') return new Response(INVALID_TOKEN_BODY, { status: 401 });
        return new Response(JSON.stringify({ draftId: 'draft_2', itemId: 'item_1' }), {
          status: 200,
        });
      }
      if (url.endsWith('/carts/current')) {
        return new Response(JSON.stringify({ id: 'draft_2', items: [], subtotal: 0 }), {
          status: 200,
        });
      }
      if (url.endsWith('/checkout/quote')) return new Response('{}', { status: 500 });
      if (token !== 'fresh-token') return new Response(INVALID_TOKEN_BODY, { status: 401 });
      return new Response(CHECKOUT_RESPONSE, { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = createStorefrontApiCartAdapter({
      baseUrl: 'https://api.example.com/public/v1',
      publishableKey: 'pk_test',
      tokenStorage,
      fetcher,
    });
    return { adapter, tokenStorage, itemPosts, consoleError };
  }

  it('addItem retries once with a freshly minted cart', async () => {
    const { adapter, tokenStorage, itemPosts, consoleError } = createRotatedSecretHarness();

    const cart = await adapter.addItem({ productId: 'prod_1', purchaseOptionId: 'var_1' });

    expect(itemPosts).toEqual(['stale-token', 'fresh-token']);
    expect(tokenStorage.getCartToken()).toBe('fresh-token');
    expect(cart.itemCount).toBe(0);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('cart token rejected'));
    consoleError.mockRestore();
  });

  it('updateItem resets to an empty cart instead of erroring forever', async () => {
    const { adapter, tokenStorage, consoleError } = createRotatedSecretHarness();

    const cart = await adapter.updateItem('item_1', 2);

    expect(cart.itemCount).toBe(0);
    expect(tokenStorage.getCartToken()).toBeNull();
    consoleError.mockRestore();
  });

  it('removeItem resets to an empty cart instead of erroring forever', async () => {
    const { adapter, tokenStorage, consoleError } = createRotatedSecretHarness();

    const cart = await adapter.removeItem('item_1');

    expect(cart.itemCount).toBe(0);
    expect(tokenStorage.getCartToken()).toBeNull();
    consoleError.mockRestore();
  });

  it('createCheckout resets and surfaces a human retry message', async () => {
    const { adapter, tokenStorage, consoleError } = createRotatedSecretHarness();

    const error = await captureCartError(() => adapter.createCheckout());

    expect(error.code).toBe('cart_unavailable');
    expect(error.message).toContain('reset');
    expect(tokenStorage.getCartToken()).toBeNull();
    consoleError.mockRestore();
  });
});
