import { describe, expect, it } from 'vitest';
import { cardProductView, panelProductView, productViewToEmit } from './product-view.js';

const SEED = { slug: 'cab-2022', title: 'Cabernet 2022' };

describe('panelProductView', () => {
  it('is null while the product read is pending', () => {
    expect(panelProductView({ resolution: null, cartSeed: SEED })).toBeNull();
  });

  it('reports the resolved storefront slug and unit price on surface page', () => {
    expect(
      panelProductView({
        resolution: {
          variations: [],
          cartProduct: { productId: 'cabernet-2022', display: { unitPrice: 5200 } },
        },
        slug: 'cab-2022',
        cartSeed: SEED,
      }),
    ).toEqual({
      type: 'product_viewed',
      surface: 'page',
      productSlug: 'cabernet-2022',
      productName: 'Cabernet 2022',
      priceCents: 5200,
    });
  });

  it('falls back to the CMS join key for an unsellable product', () => {
    expect(
      panelProductView({ resolution: { variations: [], cartProduct: null }, cartSeed: SEED }),
    ).toMatchObject({ productSlug: 'cab-2022', priceCents: undefined });
  });

  it('is null with no slug to report', () => {
    expect(
      panelProductView({
        resolution: { variations: [], cartProduct: null },
        cartSeed: { title: 'Cabernet 2022' },
      }),
    ).toBeNull();
  });
});

describe('cardProductView', () => {
  it('is null until the input resolves', () => {
    expect(cardProductView(null)).toBeNull();
    expect(cardProductView(undefined)).toBeNull();
    expect(cardProductView({ productId: '' })).toBeNull();
  });

  it('reports the input product id, title and unit price on surface card', () => {
    expect(
      cardProductView({
        productId: 'cab-2022',
        purchaseOptionId: 'var-750',
        display: { title: 'Cabernet 2022', unitPrice: 4500 },
      }),
    ).toEqual({
      type: 'product_viewed',
      surface: 'card',
      productSlug: 'cab-2022',
      productName: 'Cabernet 2022',
      priceCents: 4500,
    });
  });
});

describe('productViewToEmit', () => {
  const view = cardProductView({ productId: 'cab-2022' });

  it('emits a resolved view once it has been seen', () => {
    expect(productViewToEmit({ view, seen: true, emitted: false })).toBe(view);
  });

  it('holds back an unseen, unresolved or already-emitted view', () => {
    expect(productViewToEmit({ view, seen: false, emitted: false })).toBeNull();
    expect(productViewToEmit({ view: null, seen: true, emitted: false })).toBeNull();
    expect(productViewToEmit({ view, seen: true, emitted: true })).toBeNull();
  });
});
