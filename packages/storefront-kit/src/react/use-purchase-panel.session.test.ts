import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartSnapshot } from '../cart/cart-types.js';
import type { StorefrontProduct } from '../storefront-api/products.js';
import {
  PURCHASE_CONTEXT_DEADLINE_MS,
  type UsePurchasePanelOptions,
  usePurchasePanel,
} from './use-purchase-panel.js';

const mocks = vi.hoisted(() => {
  const cart: CartSnapshot = {
    id: 'cart-1',
    currency: 'USD',
    itemCount: 0,
    subtotal: 0,
    checkoutUrl: '',
    lines: [],
    updatedAt: '2026-11-20T00:00:00.000Z',
  };
  const snapshot = {
    cart,
    error: null,
    isConfigured: true,
    isLoading: false,
    isMutating: false,
    isSidebarOpen: false,
    lineSync: {},
    persistedItemCount: null,
  };
  return {
    fetchProduct: vi.fn(),
    contextConfigs: [] as { baseUrl: string }[],
    fetchContext: vi.fn(),
    directSession: vi.fn(),
    cartStore: {
      subscribe: () => () => {},
      getSnapshot: () => snapshot,
      getServerSnapshot: () => snapshot,
      refresh: vi.fn(),
      addItem: vi.fn(),
    },
  };
});

vi.mock('../analytics/tracker.js', () => ({ track: vi.fn() }));
vi.mock('../cart/cart-store.js', () => ({ cartStore: mocks.cartStore }));
vi.mock('../storefront-api/products.js', () => ({
  fetchStorefrontProductBySlug: mocks.fetchProduct,
}));
vi.mock('../storefront-api/customer-context.js', () => ({
  createCustomerContextClient: (config: { baseUrl: string }) => {
    mocks.contextConfigs.push(config);
    return { fetchPurchaseContext: mocks.fetchContext };
  },
}));
vi.mock('../storefront-api/auth.js', () => ({
  createStorefrontAuthClient: () => ({ getSession: mocks.directSession }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal(
  'IntersectionObserver',
  class {
    observe() {}
    disconnect() {}
    unobserve() {}
  },
);

const DIRECT = { baseUrl: 'https://platform.test/api/public/v1', publishableKey: 'pk' };
const PROXY = { baseUrl: 'https://site.test/api/store', publishableKey: 'pk' };
const VARIATION = { id: 'var_1', sku: 'sku', price: 5000, isDefault: true, unitName: 'Bottle' };
const PRODUCT: StorefrontProduct = {
  id: 'prod',
  slug: 'wine',
  name: 'Wine',
  defaultVariation: VARIATION,
  variations: [VARIATION],
};
const MEMBER_CONTEXT = {
  pricing: [],
  memberships: [{ id: 'm', clubId: 'c', clubName: 'Club', status: 'active' }],
  availability: [
    {
      productVariationId: 'var_1',
      permission: 'purchase',
      canAddToCart: true,
      canAddToWishlist: false,
      quantityLimit: null,
      grantContext: null,
    },
  ],
};
const DENIED_CONTEXT = {
  pricing: [],
  memberships: [],
  availability: [
    {
      productVariationId: 'var_1',
      permission: 'unavailable',
      status: 'restricted',
      canAddToCart: false,
      canAddToWishlist: false,
      quantityLimit: null,
      grantContext: null,
    },
  ],
};

let root: Root | null = null;

function mount(options: Partial<UsePurchasePanelOptions>) {
  const result = {} as { current: ReturnType<typeof usePurchasePanel> };
  let current = options;
  function Probe() {
    result.current = usePurchasePanel({
      storefrontApi: DIRECT,
      slug: 'wine',
      cartSeed: { slug: 'wine', title: 'Wine' },
      ...current,
    });
    return null;
  }
  root = createRoot(document.createElement('div'));
  const render = () => act(async () => root?.render(createElement(Probe)));
  return {
    result,
    render,
    update: (next: Partial<UsePurchasePanelOptions>) => {
      current = { ...current, ...next };
      return render();
    },
  };
}

beforeEach(() => {
  mocks.contextConfigs.length = 0;
  mocks.fetchProduct.mockReset().mockResolvedValue(PRODUCT);
  mocks.fetchContext.mockReset().mockResolvedValue(DENIED_CONTEXT);
  mocks.directSession.mockReset().mockResolvedValue({ status: 'anonymous' });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe('usePurchasePanel without a site session (the 0.7.1 behaviour)', () => {
  it('reads the purchase context from storefrontApi as soon as the product resolves (retail)', async () => {
    const panel = mount({});
    await panel.render();

    expect(mocks.fetchContext).toHaveBeenCalledTimes(1);
    expect(mocks.contextConfigs).toEqual([DIRECT]);
    expect(mocks.directSession).not.toHaveBeenCalled();
    // Without a site session who is signed in is unknown: a denial is unavailable.
    expect(panel.result.current.view.state).toBe('unavailable');
    expect(panel.result.current.view.signInCta).toBeUndefined();
    expect(panel.result.current.addDisabled).toBe(true);
  });

  it('enables the buy button as soon as the product resolves when nothing denies it', async () => {
    mocks.fetchContext.mockReturnValue(new Promise(() => {}));
    const panel = mount({ signInHref: '/api/auth/login' });
    await panel.render();

    expect(panel.result.current.addDisabled).toBe(false);
    expect(panel.result.current.view.signInCta).toBeUndefined();
  });

  it('gates the allocation lens on its own direct session read', async () => {
    const panel = mount({ lens: 'allocation' });
    await panel.render();

    expect(mocks.directSession).toHaveBeenCalledTimes(1);
    expect(mocks.fetchContext).not.toHaveBeenCalled();
    expect(panel.result.current.view.state).toBe('members-only');
  });

  it('uses customerContextApi for the read when given, with no other change', async () => {
    const panel = mount({ customerContextApi: PROXY });
    await panel.render();

    expect(mocks.contextConfigs).toEqual([PROXY]);
  });
});

describe('usePurchasePanel with a site session', () => {
  it('reads nothing until the session is known, then reads once through the proxy', async () => {
    const panel = mount({ customerContextApi: PROXY, session: { status: 'pending' } });
    await panel.render();
    expect(panel.result.current.isProductPending).toBe(false);
    expect(mocks.fetchContext).not.toHaveBeenCalled();

    await panel.update({ session: { status: 'anonymous' } });

    expect(mocks.fetchContext).toHaveBeenCalledTimes(1);
    expect(mocks.contextConfigs).toEqual([PROXY]);
    expect(panel.result.current.view.state).toBe('members-only');
  });

  it('tells a signed-in customer the platform denies from an anonymous one', async () => {
    const panel = mount({ session: { status: 'authenticated' }, signInHref: '/api/auth/login' });
    await panel.render();

    expect(panel.result.current.isAuthenticated).toBe(true);
    expect(panel.result.current.view.state).toBe('not-allocated');
    expect(panel.result.current.view.signInCta).toBeUndefined();
  });

  it('resolves an allocation wine for a signed-in member without the direct session read', async () => {
    mocks.fetchContext.mockResolvedValue(MEMBER_CONTEXT);
    const panel = mount({
      lens: 'allocation',
      customerContextApi: PROXY,
      session: { status: 'pending' },
    });
    await panel.render();
    await panel.update({ session: { status: 'authenticated' } });

    expect(mocks.directSession).not.toHaveBeenCalled();
    expect(mocks.contextConfigs).toEqual([PROXY]);
    expect(panel.result.current.view.state).toBe('purchasable');
  });

  it('never reads for an anonymous visitor on the allocation lens', async () => {
    const panel = mount({ lens: 'allocation', session: { status: 'anonymous' } });
    await panel.render();

    expect(mocks.fetchContext).not.toHaveBeenCalled();
    expect(mocks.directSession).not.toHaveBeenCalled();
    expect(panel.result.current.view.state).toBe('members-only');
  });
});

const deferred = <T>() => {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe('usePurchasePanel with a site session: the buy button waits for the answer', () => {
  it('stays pending while the session is pending, then until the first read settles', async () => {
    const read = deferred<unknown>();
    mocks.fetchContext.mockReturnValue(read.promise);
    const panel = mount({ session: { status: 'pending' } });
    await panel.render();
    expect(panel.result.current.addDisabled).toBe(true);

    await panel.update({ session: { status: 'anonymous' } });
    expect(mocks.fetchContext).toHaveBeenCalledTimes(1);
    expect(panel.result.current.addDisabled).toBe(true);

    await act(async () => read.resolve(MEMBER_CONTEXT));
    expect(panel.result.current.addDisabled).toBe(false);
    expect(panel.result.current.view.state).toBe('purchasable');
  });

  it('shows a visitor the platform denies no enabled button, before or after the answer', async () => {
    const read = deferred<unknown>();
    mocks.fetchContext.mockReturnValue(read.promise);
    const panel = mount({ session: { status: 'anonymous' } });
    await panel.render();
    expect(panel.result.current.addDisabled).toBe(true);

    await act(async () => read.resolve(DENIED_CONTEXT));
    expect(panel.result.current.view.state).toBe('members-only');
    expect(panel.result.current.addDisabled).toBe(true);
  });

  it('fails open when the first read fails: the button is enabled, the platform still refuses the add', async () => {
    mocks.fetchContext.mockResolvedValue(null);
    const panel = mount({ session: { status: 'anonymous' } });
    await panel.render();

    expect(panel.result.current.view.state).toBe('purchasable');
    expect(panel.result.current.addDisabled).toBe(false);
  });
});

describe('usePurchasePanel with a site session: it settles once per mounted panel', () => {
  it('shows and reads nothing visitor-scoped before the session settles', async () => {
    const panel = mount({ session: { status: 'pending' } });
    await panel.render();

    expect(mocks.fetchContext).not.toHaveBeenCalled();
    expect(panel.result.current.view.memberBadge).toBeUndefined();
    expect(panel.result.current.view.signInCta).toBeUndefined();
    expect(panel.result.current.addDisabled).toBe(true);
    // A pending session reads as `false` on the result, not "unknown".
    expect(panel.result.current.isAuthenticated).toBe(false);
  });

  it('freezes the first settled status: a later change is logged once, never recovered from', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.fetchContext.mockResolvedValue(MEMBER_CONTEXT);
    const panel = mount({ session: { status: 'pending' } });
    await panel.render();
    await panel.update({ session: { status: 'authenticated' } });
    expect(panel.result.current.view.state).toBe('purchasable');
    expect(error).not.toHaveBeenCalled();

    await panel.update({ session: { status: 'anonymous' } });
    await panel.update({ session: { status: 'pending' } });
    await panel.update({ session: { status: 'authenticated' } });
    await panel.update({ session: { status: 'anonymous' } });

    // Nothing changed, nothing was re-read, and the site was told once.
    expect(panel.result.current.view.state).toBe('purchasable');
    expect(panel.result.current.isAuthenticated).toBe(true);
    expect(mocks.fetchContext).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain('settle');
    expect(String(error.mock.calls[0][0])).toContain('key');
  });

  it('is correct on a remount: a new panel (a React key on the visitor) starts clean', async () => {
    mocks.fetchContext.mockResolvedValueOnce(MEMBER_CONTEXT).mockResolvedValueOnce(DENIED_CONTEXT);
    const first = mount({ session: { status: 'authenticated' } });
    await first.render();
    expect(first.result.current.view.state).toBe('purchasable');
    act(() => root?.unmount());

    const second = mount({ session: { status: 'anonymous' } });
    await second.render();

    expect(second.result.current.view.state).toBe('members-only');
    expect(second.result.current.view.memberBadge).toBeUndefined();
  });
});

describe('usePurchasePanel with a site session: a rejected read', () => {
  it('settles like a null answer: logged, fails open, the button is not left pending', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.fetchContext.mockRejectedValue(new Error('network down'));
    const panel = mount({ session: { status: 'anonymous' } });
    await panel.render();

    expect(panel.result.current.view.state).toBe('purchasable');
    expect(panel.result.current.addDisabled).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('rejected'), expect.any(Error));
  });
});

describe('usePurchasePanel with a site session: a read that never answers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fails open at the deadline, logged, and ignores the late answer', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let answer: (context: typeof DENIED_CONTEXT) => void = () => undefined;
    mocks.fetchContext.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    vi.useFakeTimers();
    const panel = mount({ session: { status: 'anonymous' } });
    await panel.render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(panel.result.current.addDisabled).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PURCHASE_CONTEXT_DEADLINE_MS);
    });

    expect(panel.result.current.view.state).toBe('purchasable');
    expect(panel.result.current.addDisabled).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('exceeded'));

    await act(async () => {
      answer(DENIED_CONTEXT);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(panel.result.current.view.state).toBe('purchasable');
    error.mockRestore();
  });

  it('logs once on the allocation lens when a null answer arrives after the deadline', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let answer: (context: null) => void = () => undefined;
    mocks.fetchContext.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    vi.useFakeTimers();
    const panel = mount({ lens: 'allocation', session: { status: 'authenticated' } });
    await panel.render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PURCHASE_CONTEXT_DEADLINE_MS);
    });
    await act(async () => {
      answer(null);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('exceeded'));
    error.mockRestore();
  });
});

describe('usePurchasePanel with a site session: config objects are compared by value', () => {
  it('reads once when a caller rebuilds equal config objects on every render', async () => {
    const panel = mount({ session: { status: 'anonymous' }, customerContextApi: { ...PROXY } });
    await panel.render();
    for (let i = 0; i < 3; i += 1) {
      await panel.update({
        storefrontApi: { ...DIRECT },
        customerContextApi: { ...PROXY },
      });
    }

    expect(mocks.fetchContext).toHaveBeenCalledTimes(1);
  });
});
