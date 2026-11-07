import { describe, expect, it } from 'vitest';
import type {
  StorefrontProductOption,
  StorefrontProductVariation,
} from '../storefront-api/products';
import {
  buildPurchasePanelView,
  resolveCartProduct,
  resolveVariationForOptionValue,
} from './purchase-panel-state';

// Anniversary Logo Hat — one Color option, three variations.
const COLOR = 'opt_color';
const NAVY = 'val_navy';
const BLACK = 'val_black';
const OLIVE = 'val_olive';

const HAT_OPTIONS: StorefrontProductOption[] = [
  {
    id: COLOR,
    name: 'Color',
    position: 0,
    values: [
      // Deliberately out of order: the view sorts by position.
      { id: OLIVE, optionId: COLOR, value: 'Olive + White', position: 2 },
      { id: NAVY, optionId: COLOR, value: 'Navy + Mesh', position: 0 },
      { id: BLACK, optionId: COLOR, value: 'Black', position: 1 },
    ],
  },
];

const hat = (id: string, derivedTitle: string, valueId: string): StorefrontProductVariation => ({
  id,
  price: 3200,
  sku: `HAT-${id}`,
  derivedTitle,
  optionValues: [{ optionId: COLOR, optionValueId: valueId }],
});

const HAT_VARIATIONS = [
  hat('var_navy', 'Navy + Mesh', NAVY),
  hat('var_black', 'Black', BLACK),
  hat('var_olive', 'Olive + White', OLIVE),
];

// Size × Color partial grid: no M / blue variation exists.
const SIZE = 'opt_size';
const TEE_COLOR = 'opt_tee_color';
const XS = 'val_xs';
const M = 'val_m';
const BLUE = 'val_blue';
const RED = 'val_red';

const TEE_OPTIONS: StorefrontProductOption[] = [
  {
    id: TEE_COLOR,
    name: 'Color',
    position: 1,
    values: [
      { id: BLUE, optionId: TEE_COLOR, value: 'blue', position: 0 },
      { id: RED, optionId: TEE_COLOR, value: 'red', position: 1 },
    ],
  },
  {
    id: SIZE,
    name: 'Size',
    position: 0,
    values: [
      { id: XS, optionId: SIZE, value: 'XS', position: 0 },
      { id: M, optionId: SIZE, value: 'M', position: 1 },
    ],
  },
];

const tee = (id: string, sizeId: string, colorId: string, derivedTitle: string) => ({
  id,
  price: 2500,
  derivedTitle,
  optionValues: [
    { optionId: SIZE, optionValueId: sizeId },
    { optionId: TEE_COLOR, optionValueId: colorId },
  ],
});

const TEE_VARIATIONS: StorefrontProductVariation[] = [
  tee('var_xs_blue', XS, BLUE, 'XS / blue'),
  tee('var_xs_red', XS, RED, 'XS / red'),
  tee('var_m_red', M, RED, 'M / red'),
];

const WINE_VARIATIONS: StorefrontProductVariation[] = [
  { id: 'var_750', price: 6000, title: '750', unitName: '750 mL bottle', volumeMl: 750 },
  { id: 'var_1500', price: 13000, title: '1500', unitName: 'Magnum 1.5 L', volumeMl: 1500 },
];

describe('buildPurchasePanelView — product options', () => {
  it('renders the hat as one Color option group in position order, replacing formats', () => {
    const view = buildPurchasePanelView({ variations: HAT_VARIATIONS, options: HAT_OPTIONS });

    expect(view.formats).toBeUndefined();
    expect(view.selectedVariationId).toBe('var_navy');
    expect(view.options).toEqual([
      {
        id: COLOR,
        name: 'Color',
        values: [
          { id: NAVY, label: 'Navy + Mesh', selected: true, available: true },
          { id: BLACK, label: 'Black', selected: false, available: true },
          { id: OLIVE, label: 'Olive + White', selected: false, available: true },
        ],
      },
    ]);
  });

  it('follows the selected variation', () => {
    const view = buildPurchasePanelView({
      variations: HAT_VARIATIONS,
      options: HAT_OPTIONS,
      selectedVariationId: 'var_black',
    });

    expect(view.options?.[0]?.values.map((value) => value.selected)).toEqual([false, true, false]);
    expect(view.summary.price).toBe('$32');
  });

  it('keeps every value some variation carries available on a partial grid', () => {
    const view = buildPurchasePanelView({
      variations: TEE_VARIATIONS,
      options: TEE_OPTIONS,
      selectedVariationId: 'var_xs_blue',
    });

    expect(view.formats).toBeUndefined();
    expect(view.options?.map((option) => option.name)).toEqual(['Size', 'Color']);
    // XS / blue selected: M / blue does not exist, but M / red does, so M
    // stays reachable (the resolver lands on M / red).
    expect(view.options?.[0]?.values).toEqual([
      { id: XS, label: 'XS', selected: true, available: true },
      { id: M, label: 'M', selected: false, available: true },
    ]);
    expect(view.options?.[1]?.values).toEqual([
      { id: BLUE, label: 'blue', selected: true, available: true },
      { id: RED, label: 'red', selected: false, available: true },
    ]);
  });

  it('keeps both variations of a diagonal 2×2 grid reachable', () => {
    // Only S / Red (default) and M / Blue exist.
    const variations: StorefrontProductVariation[] = [
      { ...tee('var_s_red', 'val_s', RED, 'S / red'), isDefault: true },
      tee('var_m_blue', M, BLUE, 'M / blue'),
    ];
    const options: StorefrontProductOption[] = [
      {
        id: SIZE,
        name: 'Size',
        position: 0,
        values: [
          { id: 'val_s', optionId: SIZE, value: 'S', position: 0 },
          { id: M, optionId: SIZE, value: 'M', position: 1 },
        ],
      },
      {
        id: TEE_COLOR,
        name: 'Color',
        position: 1,
        values: [
          { id: RED, optionId: TEE_COLOR, value: 'red', position: 0 },
          { id: BLUE, optionId: TEE_COLOR, value: 'blue', position: 1 },
        ],
      },
    ];
    const view = buildPurchasePanelView({ variations, options });

    expect(view.selectedVariationId).toBe('var_s_red');
    expect(
      view.options?.flatMap((option) => option.values.map((value) => value.available)),
    ).toEqual([true, true, true, true]);
    expect(resolveVariationForOptionValue(variations, 'var_s_red', SIZE, M)?.id).toBe('var_m_blue');
    expect(resolveVariationForOptionValue(variations, 'var_s_red', TEE_COLOR, BLUE)?.id).toBe(
      'var_m_blue',
    );
  });

  it('marks a value no variation carries unavailable', () => {
    const options: StorefrontProductOption[] = [
      {
        ...HAT_OPTIONS[0],
        values: [
          ...HAT_OPTIONS[0].values,
          { id: 'val_red', optionId: COLOR, value: 'Red', position: 3 },
        ],
      } as StorefrontProductOption,
    ];
    const view = buildPurchasePanelView({ variations: HAT_VARIATIONS, options });

    expect(view.options?.[0]?.values.at(-1)).toEqual({
      id: 'val_red',
      label: 'Red',
      selected: false,
      available: false,
    });
  });

  it('keeps the wine path unchanged: no options, formats labelled by unitName', () => {
    const view = buildPurchasePanelView({ variations: WINE_VARIATIONS, options: [] });

    expect(view.options).toBeUndefined();
    expect(view.formats).toEqual([
      {
        id: 'var_750',
        name: '750 ML BOTTLE',
        volume: '750 ML',
        price: '$60',
        retailPrice: undefined,
      },
      {
        id: 'var_1500',
        name: 'MAGNUM 1.5 L',
        volume: '1.5 L',
        price: '$130',
        retailPrice: undefined,
      },
    ]);
  });

  it('labels an option variation by derivedTitle, then title, when unitName is absent', () => {
    const optionValues = [{ optionId: COLOR, optionValueId: NAVY }];
    const view = buildPurchasePanelView({
      variations: [
        { id: 'a', price: 100, derivedTitle: 'Navy', title: 'ignored', optionValues },
        { id: 'b', price: 100, title: 'Gift Box', optionValues },
        { id: 'c', price: 100, optionValues },
      ],
    });

    expect(view.formats?.map((format) => format.name)).toEqual(['NAVY', 'GIFT BOX', '']);
  });

  it('keeps the unitName-only label and caption for a variation without option values', () => {
    const view = buildPurchasePanelView({
      variations: [
        { id: 'a', price: 100, title: '750', derivedTitle: 'ignored', volumeMl: 750 },
        { id: 'b', price: 200, title: '1500', volumeMl: 1500, optionValues: [] },
      ],
    });

    expect(view.formats?.map((format) => format.name)).toEqual(['', '']);
    expect(view.summary.caption).toBe('750 ML');
  });
});

describe('resolveVariationForOptionValue', () => {
  it('swaps one value on the current selection', () => {
    expect(resolveVariationForOptionValue(HAT_VARIATIONS, 'var_navy', COLOR, OLIVE)?.id).toBe(
      'var_olive',
    );
    expect(resolveVariationForOptionValue(TEE_VARIATIONS, 'var_xs_blue', TEE_COLOR, RED)?.id).toBe(
      'var_xs_red',
    );
  });

  it('resolves against the default variation when nothing is selected yet', () => {
    expect(resolveVariationForOptionValue(HAT_VARIATIONS, undefined, COLOR, BLACK)?.id).toBe(
      'var_black',
    );
  });

  it('falls back to the first variation carrying the value when the swap has no variation', () => {
    // XS / blue → M: M / blue is missing, so land on M / red.
    expect(resolveVariationForOptionValue(TEE_VARIATIONS, 'var_xs_blue', SIZE, M)?.id).toBe(
      'var_m_red',
    );
  });

  it('returns undefined when no variation carries the value', () => {
    expect(
      resolveVariationForOptionValue(HAT_VARIATIONS, 'var_navy', COLOR, 'val_red'),
    ).toBeUndefined();
  });
});

describe('resolveCartProduct — options', () => {
  const seed = { slug: 'paso-hat', title: 'Logo Hat', fallbackUnitPriceCents: 3200 };

  it('carries the product options through the live resolution', () => {
    const resolved = resolveCartProduct(
      seed,
      {
        id: 'prod_hat',
        slug: 'paso-hat',
        name: 'Logo Hat',
        options: HAT_OPTIONS,
        defaultVariation: HAT_VARIATIONS[0],
        variations: HAT_VARIATIONS,
      },
      { configured: true },
    );

    expect(resolved.options).toBe(HAT_OPTIONS);
  });

  it('yields no options for the mock (seed-only) resolution', () => {
    expect(resolveCartProduct(seed, null, { configured: false }).options).toBeUndefined();
  });
});
