import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { CartSnapshot } from '../cart/cart-types.js';
import {
  normalizeStorefrontCartResponse,
  storefrontCartResponseSchema,
} from '../cart/storefront-api-schemas.js';
import { useCartLineQuantity } from './use-cart-line-quantity.js';

const mocks = vi.hoisted(() => ({ cart: null as CartSnapshot | null }));

vi.mock('./use-cart-store.js', () => ({ useCartStore: () => ({ cart: mocks.cart }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const component = {
  id: 'item_c1',
  kind: 'component',
  parentItemId: 'item_box',
  productVariationId: 'var_rouss',
  productSlug: 'roussanne-2024',
  name: 'Roussanne',
  storedName: '2024 Roussanne',
  price: 4000,
  quantity: 6,
};

function quantityOf(identity: Parameters<typeof useCartLineQuantity>[0]) {
  let quantity = -1;
  function Probe() {
    quantity = useCartLineQuantity(identity);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  act(() => root.render(createElement(Probe)));
  act(() => root.unmount());
  return quantity;
}

describe('useCartLineQuantity with a bundle in the cart', () => {
  it('reads zero for a wine that is only a bundle component, and the bundle for itself', () => {
    mocks.cart = normalizeStorefrontCartResponse(
      storefrontCartResponseSchema.parse({
        id: 'draft_1',
        items: [
          {
            id: 'item_box',
            kind: 'catalog',
            parentItemId: null,
            productVariationId: 'var_box',
            productSlug: 'estate-six',
            name: 'Estate Six',
            price: 24000,
            quantity: 2,
            components: [component],
          },
          component,
        ],
      }),
    );

    expect(quantityOf({ productId: 'roussanne-2024', purchaseOptionId: 'var_rouss' })).toBe(0);
    expect(quantityOf({ productId: 'estate-six', purchaseOptionId: 'var_box' })).toBe(2);
  });
});
