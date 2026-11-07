import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartSnapshot } from '../cart/cart-types.js';
import { useAddToCart } from './use-add-to-cart.js';
import { useCartSidebar } from './use-cart-sidebar.js';
import { usePurchasePanel } from './use-purchase-panel.js';

// The hooks emit through the tracker; the cart store is a fixed snapshot so
// the hooks render without an adapter.
const mocks = vi.hoisted(() => {
  const cart: CartSnapshot = {
    id: 'cart-1',
    currency: 'USD',
    itemCount: 3,
    subtotal: 13500,
    checkoutUrl: '',
    lines: [],
    updatedAt: '2026-11-07T00:00:00.000Z',
  };
  const snapshot = {
    cart,
    error: null,
    isConfigured: true,
    isLoading: false,
    isMutating: false,
    isSidebarOpen: true,
    lineSync: {},
    persistedItemCount: null,
  };
  return {
    track: vi.fn(),
    fetchProduct: vi.fn(),
    cartStore: {
      subscribe: () => () => {},
      getSnapshot: () => snapshot,
      getServerSnapshot: () => snapshot,
      refresh: vi.fn(),
      addItem: vi.fn(),
      checkout: vi.fn(),
      openSidebar: vi.fn(),
      closeSidebar: vi.fn(),
      updateItem: vi.fn(),
      removeItem: vi.fn(),
    },
  };
});

vi.mock('../analytics/tracker.js', () => ({ track: mocks.track }));
vi.mock('../cart/cart-store.js', () => ({ cartStore: mocks.cartStore }));
vi.mock('../storefront-api/products.js', () => ({
  fetchStorefrontProductBySlug: mocks.fetchProduct,
}));
vi.mock('../storefront-api/customer-context.js', () => ({
  createCustomerContextClient: () => ({ fetchPurchaseContext: () => Promise.resolve(null) }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A controllable IntersectionObserver: tests decide when the panel is on screen.
const observers: FakeIntersectionObserver[] = [];

class FakeIntersectionObserver {
  readonly targets = new Set<Element>();
  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    observers.push(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  fire(isIntersecting: boolean) {
    const entries = [...this.targets].map(
      (target) => ({ target, isIntersecting }) as IntersectionObserverEntry,
    );
    if (entries.length > 0) this.callback(entries, this as unknown as IntersectionObserver);
  }
}

vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

/** Attaches the panel to an element, then reports it on screen or not. */
function scrollPanel(panel: { viewRef: (node: Element | null) => void }, onScreen: boolean) {
  act(() => panel.viewRef(document.createElement('section')));
  act(() => {
    for (const observer of observers) observer.fire(onScreen);
  });
}

let root: Root | null = null;

function renderHook<T>(hook: () => T): { current: T } {
  const result = {} as { current: T };
  function Probe() {
    result.current = hook();
    return null;
  }
  root = createRoot(document.createElement('div'));
  act(() => root?.render(createElement(Probe)));
  return result;
}

beforeEach(() => {
  observers.length = 0;
  mocks.track.mockReset();
  mocks.cartStore.addItem.mockReset();
  mocks.cartStore.checkout.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

const INPUT = {
  productId: 'cab-2022',
  purchaseOptionId: 'var-750',
  quantity: 2,
  display: { title: 'Cabernet 2022', unitPrice: 4500 },
};

describe('useAddToCart', () => {
  it('emits product_added_to_cart after a successful add', async () => {
    mocks.cartStore.addItem.mockResolvedValue({});
    const hook = renderHook(() => useAddToCart());

    await act(() => hook.current.addToCart(INPUT));

    expect(mocks.track).toHaveBeenCalledExactlyOnceWith({
      type: 'product_added_to_cart',
      productSlug: 'cab-2022',
      productName: 'Cabernet 2022',
      priceCents: 4500,
      quantity: 2,
    });
  });

  it('defaults the reported quantity to the one added', async () => {
    mocks.cartStore.addItem.mockResolvedValue({});
    const hook = renderHook(() => useAddToCart());

    await act(() => hook.current.addToCart({ productId: 'cab-2022' }));

    expect(mocks.cartStore.addItem).toHaveBeenCalledWith({ productId: 'cab-2022', quantity: 1 });
    expect(mocks.track).toHaveBeenCalledWith(expect.objectContaining({ quantity: 1 }));
  });

  it('emits nothing when the add fails', async () => {
    mocks.cartStore.addItem.mockRejectedValue(new Error('item_unavailable'));
    const hook = renderHook(() => useAddToCart());

    await act(() => hook.current.addToCart(INPUT));

    expect(hook.current.status).toBe('error');
    expect(mocks.track).not.toHaveBeenCalled();
  });
});

describe('useCartSidebar', () => {
  it('emits checkout_started with the cart count and subtotal, then checks out', async () => {
    mocks.cartStore.checkout.mockResolvedValue(undefined);
    const hook = renderHook(() => useCartSidebar());

    await act(() => hook.current.checkout());

    expect(mocks.track).toHaveBeenCalledExactlyOnceWith({
      type: 'checkout_started',
      cartItemCount: 3,
      cartSubtotalCents: 13500,
    });
    expect(mocks.cartStore.checkout).toHaveBeenCalledTimes(1);
  });
});

describe('usePurchasePanel', () => {
  it('emits one product_viewed once the resolved (mock) panel scrolls into view', () => {
    const hook = renderHook(() =>
      usePurchasePanel({
        cartSeed: { slug: 'cab-2022', title: 'Cabernet 2022', fallbackUnitPriceCents: 4500 },
      }),
    );
    act(() => hook.current.selectFormat('cab-2022'));
    expect(hook.current.isProductPending).toBe(false);
    expect(mocks.track).not.toHaveBeenCalled();

    scrollPanel(hook.current, true);

    expect(mocks.track).toHaveBeenCalledExactlyOnceWith({
      type: 'product_viewed',
      productSlug: 'cab-2022',
      productName: 'Cabernet 2022',
      priceCents: 4500,
    });
  });

  it('emits product_viewed with the live slug and price once the storefront read resolves', async () => {
    mocks.fetchProduct.mockResolvedValue({
      id: 'p1',
      slug: 'cabernet-sauvignon-2022',
      name: 'Cabernet Sauvignon',
      defaultVariation: { id: 'var-750', price: 5200 },
      variations: [{ id: 'var-750', price: 5200 }],
    });
    const hook = renderHook(() =>
      usePurchasePanel({
        storefrontApi: { baseUrl: 'https://api.example.com', publishableKey: 'pk_test' },
        slug: 'cabernet-sauvignon-2022',
        cartSeed: { slug: 'cabernet-sauvignon-2022', title: 'Cabernet 2022' },
      }),
    );
    // Seen before the product lands: the view waits for the read.
    scrollPanel(hook.current, true);
    expect(mocks.track).not.toHaveBeenCalled();

    await act(async () => {});

    expect(mocks.track).toHaveBeenCalledExactlyOnceWith({
      type: 'product_viewed',
      productSlug: 'cabernet-sauvignon-2022',
      productName: 'Cabernet 2022',
      priceCents: 5200,
    });
  });

  it('emits nothing without a product slug to report', () => {
    const hook = renderHook(() => usePurchasePanel({ cartSeed: { title: 'Cabernet 2022' } }));
    scrollPanel(hook.current, true);
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it('emits nothing for a resolved panel that never comes on screen', () => {
    const hook = renderHook(() =>
      usePurchasePanel({ cartSeed: { slug: 'cab-2022', title: 'Cabernet 2022' } }),
    );
    scrollPanel(hook.current, false);
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it('emits nothing when the site never attaches viewRef', () => {
    renderHook(() => usePurchasePanel({ cartSeed: { slug: 'cab-2022', title: 'Cabernet 2022' } }));
    expect(observers).toHaveLength(0);
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it('reports a view once, even when the panel scrolls in again', () => {
    const hook = renderHook(() =>
      usePurchasePanel({ cartSeed: { slug: 'cab-2022', title: 'Cabernet 2022' } }),
    );
    scrollPanel(hook.current, true);
    scrollPanel(hook.current, true);
    expect(mocks.track).toHaveBeenCalledTimes(1);
    expect(observers[0]?.options?.threshold).toBe(0.5);
  });
});
