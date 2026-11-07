// Shell wiring for the retail lens's purchase-context read: the CTA waits for
// the read, the platform's entitlement gate reaches the view, and a failed read
// fails closed. The ladder itself is covered in pdp/purchase-panel-state.*.test.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerPurchaseContext } from '../storefront-api/customer-context';
import type { StorefrontProduct } from '../storefront-api/products';
import { type UsePurchasePanelResult, usePurchasePanel } from './use-purchase-panel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  fetchStorefrontProductBySlug: vi.fn(),
  fetchPurchaseContext: vi.fn(),
}));

vi.mock('../storefront-api/products', () => ({
  fetchStorefrontProductBySlug: mocks.fetchStorefrontProductBySlug,
}));
vi.mock('../storefront-api/customer-context', () => ({
  createCustomerContextClient: () => ({ fetchPurchaseContext: mocks.fetchPurchaseContext }),
}));
vi.mock('./use-cart-store', () => ({
  useCartStore: () => ({ cart: null, isConfigured: true, isLoading: false, isMutating: false }),
}));

const PRODUCT: StorefrontProduct = {
  id: 'prod_1',
  slug: 'example-cabernet-2022',
  name: 'Example Cabernet',
  defaultVariation: { id: 'var_bottle', sku: 'EXC22-750', price: 5200, isDefault: true },
  variations: [],
};

function context(
  availability: CustomerPurchaseContext['availability'],
): CustomerPurchaseContext {
  return { availability, memberships: [], pricing: [] };
}

const mounted: Root[] = [];

async function renderPanel(): Promise<{ current: UsePurchasePanelResult }> {
  const result = {} as { current: UsePurchasePanelResult };
  function Probe() {
    result.current = usePurchasePanel({
      storefrontApi: { baseUrl: 'https://store.example.test/api', publishableKey: 'pk_test' },
      slug: PRODUCT.slug,
      cartSeed: { slug: PRODUCT.slug, title: 'Example Cabernet 2022' },
    });
    return null;
  }

  const root = createRoot(document.createElement('div'));
  mounted.push(root);
  await act(async () => {
    root.render(createElement(Probe));
  });
  await flush();
  return result;
}

function flush() {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchStorefrontProductBySlug.mockResolvedValue(PRODUCT);
});

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount());
  vi.restoreAllMocks();
});

describe('usePurchasePanel — retail purchase-context read', () => {
  it('keeps the CTA pending (disabled, add label) while the read is in flight', async () => {
    mocks.fetchPurchaseContext.mockReturnValue(new Promise(() => {}));
    const panel = await renderPanel();

    expect(panel.current.isProductPending).toBe(false);
    expect(panel.current.addDisabled).toBe(true);
    expect(panel.current.addLabel).toBe('ADD TO CART');
  });

  it('renders the platform entitlement gate for an anonymous visitor', async () => {
    mocks.fetchPurchaseContext.mockResolvedValue(
      context([
        {
          productVariationId: 'var_bottle',
          permission: 'restricted',
          canAddToCart: false,
          canAddToWishlist: false,
          quantityLimit: null,
          grantContext: null,
        },
      ]),
    );
    const panel = await renderPanel();

    expect(panel.current.view.state).toBe('restricted');
    expect(panel.current.addDisabled).toBe(true);
  });

  it('enables the CTA once the platform says this visitor may buy', async () => {
    mocks.fetchPurchaseContext.mockResolvedValue(
      context([
        {
          productVariationId: 'var_bottle',
          permission: 'purchase',
          canAddToCart: true,
          canAddToWishlist: false,
          quantityLimit: null,
          grantContext: null,
        },
      ]),
    );
    const panel = await renderPanel();

    expect(panel.current.view.state).toBe('purchasable');
    expect(panel.current.addDisabled).toBe(false);
  });

  it('fails closed into degraded, loudly, when the read fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.fetchPurchaseContext.mockResolvedValue(null);
    const panel = await renderPanel();

    expect(panel.current.view.state).toBe('degraded');
    expect(panel.current.addDisabled).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(
      'usePurchasePanel: purchase context unavailable — rendering the degraded state.',
    );
  });
});
