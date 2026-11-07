// The client-side cart-product resolution (the island self-fetches the product
// from the CMS join key, then merges the CMS display seed with the live
// product). These pure builders replace the old per-site server builders.
import { describe, expect, it } from 'vitest';
import type { StorefrontProduct, StorefrontProductVariation } from '../storefront-api/products';
import {
  buildMockCartProduct,
  buildSelectedCartInput,
  buildStorefrontCartProduct,
  type CartProductSeed,
  resolveCartProduct,
} from './purchase-panel-state';

const SEED: CartProductSeed = {
  slug: 'example-cabernet-2022',
  title: 'Example Cabernet 2022',
  imageUrl: 'https://cms.example/cms-bottle.jpg',
  fallbackUnitPriceCents: 5200,
};

const DEFAULT_VARIATION = {
  id: 'var_bottle',
  sku: 'EXC22-750',
  price: 4800,
  isDefault: true,
  unitName: 'Bottle',
  volumeMl: 750,
};

const PRODUCT: StorefrontProduct = {
  id: 'prod_1',
  slug: 'example-cabernet-2022',
  name: 'Example Cabernet',
  imageUrl: 'https://store.example/store-bottle.jpg',
  defaultVariation: DEFAULT_VARIATION,
  variations: [
    { id: 'var_demi', sku: 'EXC22-375', price: 3000, unitName: 'Demi', volumeMl: 375 },
    DEFAULT_VARIATION,
  ],
};

describe('buildStorefrontCartProduct', () => {
  it('merges store ids/sku/price with the CMS title, preferring the store image', () => {
    expect(buildStorefrontCartProduct(SEED, PRODUCT)).toEqual({
      productId: 'example-cabernet-2022',
      purchaseOptionId: 'var_bottle',
      variantId: 'var_bottle',
      sku: 'EXC22-750',
      quantity: 1,
      display: {
        imageUrl: 'https://store.example/store-bottle.jpg',
        title: 'Example Cabernet 2022',
        unitPrice: 4800,
      },
    });
  });

  it('falls back to the CMS image when the store carries none', () => {
    const product: StorefrontProduct = {
      ...PRODUCT,
      imageUrl: undefined,
      defaultVariation: { ...DEFAULT_VARIATION, imageUrl: undefined },
    };
    expect(buildStorefrontCartProduct(SEED, product)?.display?.imageUrl).toBe(
      'https://cms.example/cms-bottle.jpg',
    );
  });

  it('returns null (→ degraded) when the product is missing or has no priced default', () => {
    expect(buildStorefrontCartProduct(SEED, null)).toBeNull();
    expect(
      buildStorefrontCartProduct(SEED, {
        ...PRODUCT,
        defaultVariation: { ...DEFAULT_VARIATION, price: undefined },
      }),
    ).toBeNull();
  });
});

describe('buildMockCartProduct', () => {
  it('synthesizes a cart input from the CMS seed alone', () => {
    expect(buildMockCartProduct(SEED)).toEqual({
      productId: 'example-cabernet-2022',
      purchaseOptionId: 'example-cabernet-2022',
      quantity: 1,
      display: {
        imageUrl: 'https://cms.example/cms-bottle.jpg',
        title: 'Example Cabernet 2022',
        unitPrice: 5200,
      },
    });
  });

  it('returns null without a join key (no slug → nothing to add)', () => {
    expect(buildMockCartProduct({ ...SEED, slug: undefined })).toBeNull();
  });
});

describe('resolveCartProduct', () => {
  it('live: yields the store variations (server-sorted) + merged cart product', () => {
    const resolved = resolveCartProduct(SEED, PRODUCT, { configured: true });
    expect(resolved.variations.map((v) => v.id)).toEqual(['var_demi', 'var_bottle']);
    expect(resolved.cartProduct?.productId).toBe('example-cabernet-2022');
  });

  it('live: a lone default variation still yields a one-entry list', () => {
    const resolved = resolveCartProduct(SEED, { ...PRODUCT, variations: [] }, { configured: true });
    expect(resolved.variations.map((v) => v.id)).toEqual(['var_bottle']);
  });

  it('live: a failed/empty product read degrades (no variations, no cart product)', () => {
    const resolved = resolveCartProduct(SEED, null, { configured: true });
    expect(resolved.variations).toEqual([]);
    expect(resolved.cartProduct).toBeNull();
  });

  it('mock: synthesizes a single variation matching the cart input so in-cart detection works', () => {
    const resolved = resolveCartProduct(SEED, null, { configured: false });
    expect(resolved.cartProduct?.purchaseOptionId).toBe('example-cabernet-2022');
    expect(resolved.variations).toEqual([
      { id: 'example-cabernet-2022', price: 5200, unitName: 'Bottle' },
    ]);
  });
});

// A product with options (merch): the optimistic line must say which variation
// was added, since the hat's variations carry no unitName.
describe('cart line title for a product with options', () => {
  const HAT_SEED: CartProductSeed = {
    slug: 'anniversary-logo-hat',
    title: 'Anniversary Logo Hat',
  };
  const hat = (id: string, derivedTitle: string): StorefrontProductVariation => ({
    id,
    sku: `HAT-${id}`,
    price: 3200,
    derivedTitle,
    optionValues: [{ optionId: 'opt_color', optionValueId: `val_${id}` }],
  });
  const NAVY = { ...hat('var_navy', 'Navy + Mesh'), isDefault: true };
  const BLACK = hat('var_black', 'Black');
  const HAT: StorefrontProduct = {
    id: 'prod_hat',
    slug: 'anniversary-logo-hat',
    name: 'Anniversary Logo Hat',
    defaultVariation: NAVY,
    variations: [NAVY, BLACK],
  };

  it('the base input carries the default variation label', () => {
    expect(buildStorefrontCartProduct(HAT_SEED, HAT)?.display?.title).toBe(
      'Anniversary Logo Hat — Navy + Mesh',
    );
  });

  it('the selected variation (Black) re-titles the add input', () => {
    const { cartProduct } = resolveCartProduct(HAT_SEED, HAT, { configured: true });
    if (!cartProduct) throw new Error('expected a cart product');
    const input = buildSelectedCartInput(cartProduct, BLACK, undefined, HAT_SEED.title);
    expect(input.purchaseOptionId).toBe('var_black');
    expect(input.display?.title).toBe('Anniversary Logo Hat — Black');
  });

  it('an option variation with no resolvable label keeps the bare seed title', () => {
    const { cartProduct } = resolveCartProduct(HAT_SEED, HAT, { configured: true });
    if (!cartProduct) throw new Error('expected a cart product');
    const unlabelled: StorefrontProductVariation = { ...BLACK, derivedTitle: undefined };
    expect(
      buildSelectedCartInput(cartProduct, unlabelled, undefined, HAT_SEED.title).display?.title,
    ).toBe('Anniversary Logo Hat');
  });

  it('a wine keeps the bare CMS title for any selected format', () => {
    const { cartProduct } = resolveCartProduct(SEED, PRODUCT, { configured: true });
    if (!cartProduct) throw new Error('expected a cart product');
    const demi = PRODUCT.variations[0] as StorefrontProductVariation;
    expect(cartProduct.display?.title).toBe('Example Cabernet 2022');
    expect(buildSelectedCartInput(cartProduct, demi, undefined, SEED.title).display?.title).toBe(
      'Example Cabernet 2022',
    );
  });
});
