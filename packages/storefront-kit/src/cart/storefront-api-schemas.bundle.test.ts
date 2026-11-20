import { describe, expect, it } from 'vitest';
import { buildPurchasePanelView } from '../pdp/purchase-panel-state';
import type { StorefrontProductVariation } from '../storefront-api/products';
import {
  normalizeStorefrontCartResponse,
  storefrontCartResponseSchema,
} from './storefront-api-schemas';

// The GET /carts/current wire shape for a FIXED bundle: the bundle is one
// `catalog` item that also lists `components`, and the same wines appear again
// in the flat `items` list as `component` items hanging from the bundle item.
function componentItem(
  id: string,
  variationId: string,
  slug: string,
  storedName: string,
  quantity: number,
) {
  return {
    id,
    kind: 'component',
    parentItemId: 'item_box',
    productVariationId: variationId,
    productSlug: slug,
    name: storedName.slice(5),
    storedName,
    unitName: '750 ml',
    price: 4000,
    quantity,
  };
}

function bundleCart(boxes: number, extraItems: unknown[] = [], boxComponents?: unknown) {
  const roussanne = componentItem(
    'item_c1',
    'var_rouss',
    'roussanne-2024',
    '2024 Roussanne',
    3 * boxes,
  );
  const garnacha = componentItem(
    'item_c2',
    'var_garn',
    'garnacha-2024',
    '2024 Garnacha',
    3 * boxes,
  );
  return {
    id: 'draft_1',
    items: [
      {
        id: 'item_box',
        kind: 'catalog',
        parentItemId: null,
        productVariationId: 'var_box',
        productSlug: 'estate-six',
        name: 'Estate Six',
        storedName: 'Estate Six',
        unitName: null,
        price: 24000,
        quantity: boxes,
        components: boxComponents ?? [roussanne, garnacha],
      },
      roussanne,
      garnacha,
      ...extraItems,
    ],
  };
}

function normalize(response: unknown) {
  return normalizeStorefrontCartResponse(storefrontCartResponseSchema.parse(response));
}

describe('normalizeStorefrontCartResponse bundles', () => {
  it('turns a bundle into one line and its wines into a per-bundle caption, not lines', () => {
    const cart = normalize(bundleCart(2));

    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({
      id: 'item_box',
      title: 'Estate Six',
      quantity: 2,
      unitPrice: 24000,
      components: [
        { title: '2024 Roussanne', quantity: 3 },
        { title: '2024 Garnacha', quantity: 3 },
      ],
    });
  });

  it('counts a bundle once per unit, in the count and in the subtotal fallback', () => {
    const cart = normalize(
      bundleCart(2, [
        { id: 'item_hat', parentItemId: null, name: 'Hat', price: 3000, quantity: 1 },
      ]),
    );

    expect(cart.itemCount).toBe(3);
    expect(cart.subtotal).toBe(2 * 24000 + 3000);
  });

  it('keeps the caption per ONE bundle when the shopper changes the quantity', () => {
    const perBundle = [
      { title: '2024 Roussanne', quantity: 3 },
      { title: '2024 Garnacha', quantity: 3 },
    ];

    expect(normalize(bundleCart(1)).lines[0]?.components).toEqual(perBundle);
    expect(normalize(bundleCart(5)).lines[0]?.components).toEqual(perBundle);
  });

  it('treats an item with no parentItemId as a line, for a server that predates components', () => {
    const cart = normalize({
      id: 'draft_1',
      items: [{ id: 'item_1', name: 'Cabernet', price: 5200, quantity: 2 }],
    });

    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.components).toBeUndefined();
  });

  it.each([
    ['a malformed components value', 'not-an-array'],
    ['a component with no name', [{ quantity: 6 }]],
    ['a component that does not divide into the line quantity', [{ name: 'Wine', quantity: 5 }]],
    ['an empty list', []],
  ])('keeps the line and drops the caption for %s', (_label, components) => {
    const cart = normalize(bundleCart(2, [], components));

    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({ id: 'item_box', quantity: 2 });
    expect(cart.lines[0]?.components).toBeUndefined();
  });

  it('never matches a wine that is only in the cart as a bundle component', () => {
    const lines = normalize(bundleCart(1)).lines;
    const roussanne: StorefrontProductVariation = {
      id: 'var_rouss',
      sku: 'ROU24',
      price: 4000,
      isDefault: true,
      unitName: 'Bottle',
      volumeMl: 750,
    };

    expect(buildPurchasePanelView({ variations: [roussanne], cartLines: lines }).state).not.toBe(
      'in-cart',
    );
  });
});
