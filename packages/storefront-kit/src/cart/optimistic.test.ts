import { describe, expect, it } from 'vitest';
import type { AddToCartInput, CartSnapshot } from './cart-types';
import {
  applyAddItem,
  applyRemoveItem,
  applyUpdateItem,
  cartLineKey,
  isOptimisticLineId,
  optimisticLineId,
  sameCartLine,
} from './optimistic';

const FIXED_NOW = () => '2026-01-01T00:00:00.000Z';
const opts = { now: FIXED_NOW };

function emptyCart(): CartSnapshot {
  return {
    id: 'cart-1',
    currency: 'USD',
    itemCount: 0,
    subtotal: 0,
    checkoutUrl: '',
    lines: [],
    updatedAt: '2025-12-31T00:00:00.000Z',
  };
}

function cartWith(...lines: CartSnapshot['lines']): CartSnapshot {
  const active = lines.filter((line) => line.quantity > 0);
  return {
    ...emptyCart(),
    lines: active,
    itemCount: active.reduce((total, line) => total + line.quantity, 0),
    subtotal: active.reduce((total, line) => total + line.quantity * line.unitPrice, 0),
  };
}

const cab: AddToCartInput = {
  productId: 'p-cab',
  purchaseOptionId: 'v-cab',
  quantity: 1,
  display: { title: '2022 Cabernet', unitPrice: 4500, imageUrl: 'cab.jpg' },
};

describe('cartLineKey', () => {
  it('uses the most specific purchasable identity and product id only as fallback', () => {
    expect(cartLineKey({ productId: 'p', purchaseOptionId: 'v' })).toBe('purchaseOption:v');
    expect(cartLineKey({ productId: 'p-a', purchaseOptionId: 'v' })).toBe(
      cartLineKey({ productId: 'p-b', purchaseOptionId: 'v' }),
    );
    expect(cartLineKey({ productId: 'p', sku: 's' })).toBe('sku:s');
    expect(cartLineKey({ productId: 'p' })).toBe('product:p');
  });
});

describe('sameCartLine', () => {
  it('matches on any overlapping stable identity', () => {
    expect(
      sameCartLine(
        { productId: 'slug-cab', sku: 'CAB-750' },
        { productId: 'prod-cab', purchaseOptionId: 'var-cab', sku: 'CAB-750' },
      ),
    ).toBe(true);
    expect(
      sameCartLine(
        { productId: 'slug-cab', purchaseOptionId: 'var-cab' },
        { productId: 'prod-cab', purchaseOptionId: 'var-cab' },
      ),
    ).toBe(true);
    expect(sameCartLine({ productId: 'a' }, { productId: 'b' })).toBe(false);
  });

  it('never matches two variations of one product on the shared slug', () => {
    expect(
      sameCartLine(
        { productId: 'paso-hat', purchaseOptionId: 'var-navy', variantId: 'var-navy' },
        { productId: 'paso-hat', purchaseOptionId: 'var-black', variantId: 'var-black' },
      ),
    ).toBe(false);
    expect(
      sameCartLine({ productId: 'paso-hat', variantId: 'var-navy' }, { productId: 'paso-hat' }),
    ).toBe(false);
  });

  it('matches legacy lines without variation ids by productId', () => {
    expect(sameCartLine({ productId: 'slug-cab' }, { productId: 'slug-cab' })).toBe(true);
  });
});

describe('optimisticLineId', () => {
  it('is deterministic and detectable', () => {
    const id = optimisticLineId(cab);
    expect(id).toBe('opt:purchaseOption:v-cab');
    expect(isOptimisticLineId(id)).toBe(true);
    expect(isOptimisticLineId('line_real')).toBe(false);
  });
});

describe('applyAddItem', () => {
  it('appends a new line from display facts and recomputes totals', () => {
    const next = applyAddItem(emptyCart(), cab, opts);
    expect(next.lines).toHaveLength(1);
    expect(next.lines[0]).toMatchObject({
      id: 'opt:purchaseOption:v-cab',
      title: '2022 Cabernet',
      unitPrice: 4500,
      quantity: 1,
      imageUrl: 'cab.jpg',
    });
    expect(next.itemCount).toBe(1);
    expect(next.subtotal).toBe(4500);
    expect(next.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('merges a re-add into the matching line instead of duplicating', () => {
    const once = applyAddItem(emptyCart(), cab, opts);
    const twice = applyAddItem(once, { ...cab, quantity: 2 }, opts);
    expect(twice.lines).toHaveLength(1);
    expect(twice.lines[0].quantity).toBe(3);
    expect(twice.itemCount).toBe(3);
    expect(twice.subtotal).toBe(13500);
  });

  it('adds a second variation of the same product as its own line', () => {
    const bottle: AddToCartInput = {
      productId: '2022-estate-reserve',
      purchaseOptionId: 'var-750',
      variantId: 'var-750',
      sku: '22RESERVE750',
      display: { title: '2022 Estate Reserve', unitPrice: 7000 },
    };
    const magnum: AddToCartInput = {
      productId: '2022-estate-reserve',
      purchaseOptionId: 'var-1500',
      variantId: 'var-1500',
      sku: '22RESERVE1500',
      display: { title: '2022 Estate Reserve', unitPrice: 21000 },
    };
    const next = applyAddItem(applyAddItem(emptyCart(), bottle, opts), magnum, opts);
    expect(next.lines.map((line) => [line.purchaseOptionId, line.quantity])).toEqual([
      ['var-750', 1],
      ['var-1500', 1],
    ]);
    expect(next.subtotal).toBe(28000);
  });

  it('defaults quantity to 1 and clamps fractional/zero input up to 1', () => {
    expect(applyAddItem(emptyCart(), { ...cab, quantity: undefined }, opts).itemCount).toBe(1);
    expect(applyAddItem(emptyCart(), { ...cab, quantity: 0 }, opts).itemCount).toBe(1);
  });

  it('does not mutate the input cart', () => {
    const cart = emptyCart();
    applyAddItem(cart, cab, opts);
    expect(cart.lines).toHaveLength(0);
  });
});

describe('applyUpdateItem', () => {
  it('sets a line quantity and recomputes totals', () => {
    const start = applyAddItem(emptyCart(), cab, opts);
    const next = applyUpdateItem(start, 'opt:purchaseOption:v-cab', 4, opts);
    expect(next.lines[0].quantity).toBe(4);
    expect(next.itemCount).toBe(4);
    expect(next.subtotal).toBe(18000);
  });

  it('removes the line when quantity drops to 0', () => {
    const start = applyAddItem(emptyCart(), cab, opts);
    const next = applyUpdateItem(start, 'opt:purchaseOption:v-cab', 0, opts);
    expect(next.lines).toHaveLength(0);
    expect(next.itemCount).toBe(0);
    expect(next.subtotal).toBe(0);
  });

  it('is a no-op for an unknown line id', () => {
    const start = applyAddItem(emptyCart(), cab, opts);
    const next = applyUpdateItem(start, 'missing', 9, opts);
    expect(next.itemCount).toBe(1);
  });
});

describe('applyRemoveItem', () => {
  it('drops the line and recomputes totals', () => {
    const start = cartWith(
      { id: 'a', productId: 'pa', title: 'A', quantity: 2, unitPrice: 1000 },
      { id: 'b', productId: 'pb', title: 'B', quantity: 1, unitPrice: 3000 },
    );
    const next = applyRemoveItem(start, 'a', opts);
    expect(next.lines).toHaveLength(1);
    expect(next.lines[0].id).toBe('b');
    expect(next.itemCount).toBe(1);
    expect(next.subtotal).toBe(3000);
  });
});
