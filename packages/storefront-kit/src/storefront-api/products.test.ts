import { describe, expect, it, vi } from 'vitest';
import {
  createConfiguredStorefrontProductFetchers,
  fetchStorefrontProductBySlug,
  fetchStorefrontProducts,
  fetchStorefrontProductsByWineId,
} from './products';

const CONFIG = {
  baseUrl: 'https://api.example.com/public/v1/',
  origin: 'https://winery.example',
  publishableKey: 'pk_test',
};

const PRODUCT = {
  id: 'prod_1',
  slug: 'estate-cabernet',
  name: 'Estate Cabernet',
  imageUrl: null,
  defaultVariation: {
    id: 'var_750',
    sku: 'CAB-750',
    price: 5200,
    isDefault: true,
    unitName: 'bottle',
    volumeMl: 750,
    imageUrl: null,
  },
  variations: [
    {
      id: 'var_750',
      sku: 'CAB-750',
      price: 5200,
      isDefault: true,
      unitName: 'bottle',
      volumeMl: 750,
      imageUrl: null,
    },
  ],
};

describe('fetchStorefrontProductBySlug', () => {
  it('reads and normalizes one product by slug', async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify(PRODUCT), { status: 200 }),
    ) as unknown as typeof fetch;

    const product = await fetchStorefrontProductBySlug('estate-cabernet', {
      ...CONFIG,
      fetcher,
    });

    expect(product).toMatchObject({
      id: 'prod_1',
      slug: 'estate-cabernet',
      defaultVariation: { id: 'var_750', unitName: 'bottle', volumeMl: 750 },
      variations: [{ id: 'var_750', unitName: 'bottle', volumeMl: 750 }],
    });
    const [url, init] = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.example.com/public/v1/products/estate-cabernet');
    expect((init.headers as Headers).get('X-Publishable-Key')).toBe('pk_test');
    expect((init.headers as Headers).get('Origin')).toBe('https://winery.example');
  });
});

describe('fetchStorefrontProducts', () => {
  it('reads and normalizes the product catalog', async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify([PRODUCT]), { status: 200 }),
    ) as unknown as typeof fetch;

    const products = await fetchStorefrontProducts({ ...CONFIG, fetcher });

    expect(products).toEqual([
      {
        id: 'prod_1',
        slug: 'estate-cabernet',
        name: 'Estate Cabernet',
        imageUrl: undefined,
        defaultVariation: {
          id: 'var_750',
          sku: 'CAB-750',
          price: 5200,
          isDefault: true,
          unitName: 'bottle',
          volumeMl: 750,
          imageUrl: undefined,
        },
        variations: [
          {
            id: 'var_750',
            sku: 'CAB-750',
            price: 5200,
            isDefault: true,
            unitName: 'bottle',
            volumeMl: 750,
            imageUrl: undefined,
          },
        ],
      },
    ]);
    expect((fetcher as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      'https://api.example.com/public/v1/products',
    );
  });
});

describe('fetchStorefrontProductsByWineId', () => {
  it('uses one catalog read to map CMS wine ids to storefront products', async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify([PRODUCT]), { status: 200 }),
    ) as unknown as typeof fetch;

    const products = await fetchStorefrontProductsByWineId(
      [
        { _id: 'wine_1', storefrontProductSlug: 'estate-cabernet' },
        { _id: 'wine_2', storefrontProductSlug: 'missing' },
        { _id: 'wine_3' },
      ],
      { ...CONFIG, fetcher },
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(products.get('wine_1')?.slug).toBe('estate-cabernet');
    expect(products.get('wine_2')).toBeNull();
    expect(products.get('wine_3')).toBeNull();
  });

  it('does not read the catalog for an empty wine list', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;

    expect(await fetchStorefrontProductsByWineId([], { ...CONFIG, fetcher })).toEqual(new Map());
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('createConfiguredStorefrontProductFetchers', () => {
  it('binds fetchers to site public config', async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify([PRODUCT]), { status: 200 }),
    ) as unknown as typeof fetch;
    const fetchers = createConfiguredStorefrontProductFetchers({
      getConfig: () => ({ baseUrl: CONFIG.baseUrl, publishableKey: CONFIG.publishableKey }),
    });

    const products = await fetchers.fetchStorefrontProducts({ fetcher });

    expect(products).toHaveLength(1);
    const [, init] = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).get('Authorization')).toBeNull();
    expect((init.headers as Headers).get('X-Publishable-Key')).toBe(CONFIG.publishableKey);
    expect(fetchers.isStorefrontProductApiConfigured()).toBe(true);
  });

  it('degrades as unconfigured when the site config resolver is empty', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const fetchers = createConfiguredStorefrontProductFetchers({
      getConfig: () => undefined,
    });

    expect(await fetchers.fetchStorefrontProducts({ fetcher })).toEqual([]);
    expect(fetchers.isStorefrontProductApiConfigured()).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

// Representative response for GET /products/anniversary-logo-hat (trimmed).
const HAT_OPTION_ID = 'opt_color';
const hatVariation = (
  id: string,
  sku: string,
  derivedTitle: string,
  sortOrder: number,
  optionValueId: string,
) => ({
  id,
  price: 3200,
  sku,
  title: null,
  derivedTitle,
  unitName: null,
  volumeMl: null,
  sortOrder,
  optionValues: [{ optionId: HAT_OPTION_ID, optionValueId }],
});
const HAT_NAVY = hatVariation('var_hat_navy', 'LOGOHAT-NAVY', 'Navy + Mesh', 0, 'optval_navy');
const HAT_RESPONSE = {
  id: 'prod_hat',
  slug: 'anniversary-logo-hat',
  name: 'Anniversary Logo Hat',
  category: 'merchandise',
  options: [
    {
      id: HAT_OPTION_ID,
      productId: 'prod_hat',
      name: 'Color',
      position: 0,
      values: [
        { id: 'optval_navy', optionId: HAT_OPTION_ID, value: 'Navy + Mesh', position: 0 },
        { id: 'optval_black', optionId: HAT_OPTION_ID, value: 'Black', position: 1 },
        {
          id: 'optval_olive',
          optionId: HAT_OPTION_ID,
          value: 'Olive + White',
          position: 2,
        },
      ],
    },
  ],
  defaultVariation: HAT_NAVY,
  variations: [
    HAT_NAVY,
    hatVariation('var_hat_black', 'LOGOHAT-BLACK', 'Black', 1, 'optval_black'),
    hatVariation('var_hat_olive', 'LOGOHAT-OLIVE', 'Olive + White', 2, 'optval_olive'),
  ],
};

const WINE_RESPONSE = {
  id: 'prod_wine',
  slug: '2022-syrah',
  name: '2022 Syrah',
  options: [],
  defaultVariation: {
    id: 'var_750',
    price: 6000,
    title: '750',
    derivedTitle: null,
    unitName: '750 mL bottle',
    volumeMl: 750,
    optionValues: [],
  },
  variations: [
    {
      id: 'var_750',
      price: 6000,
      title: '750',
      derivedTitle: null,
      unitName: '750 mL bottle',
      volumeMl: 750,
      optionValues: [],
    },
    {
      id: 'var_1500',
      price: 13000,
      title: '1500',
      derivedTitle: null,
      unitName: 'Magnum 1.5 L',
      volumeMl: 1500,
      optionValues: [],
    },
  ],
};

async function readProduct(body: unknown) {
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify(body), { status: 200 }),
  ) as unknown as typeof fetch;
  return fetchStorefrontProductBySlug('any', { ...CONFIG, fetcher });
}

describe('product options on the product read', () => {
  it('parses options and per-variation option values for a merch product', async () => {
    const product = await readProduct(HAT_RESPONSE);

    expect(product?.options).toEqual([
      {
        id: HAT_OPTION_ID,
        name: 'Color',
        position: 0,
        values: [
          {
            id: 'optval_navy',
            optionId: HAT_OPTION_ID,
            value: 'Navy + Mesh',
            position: 0,
          },
          { id: 'optval_black', optionId: HAT_OPTION_ID, value: 'Black', position: 1 },
          {
            id: 'optval_olive',
            optionId: HAT_OPTION_ID,
            value: 'Olive + White',
            position: 2,
          },
        ],
      },
    ]);
    expect(product?.variations).toHaveLength(3);
    expect(product?.variations[1]).toStrictEqual({
      id: 'var_hat_black',
      sku: 'LOGOHAT-BLACK',
      price: 3200,
      isDefault: undefined,
      unitName: undefined,
      volumeMl: undefined,
      imageUrl: undefined,
      title: undefined,
      derivedTitle: 'Black',
      optionValues: [{ optionId: HAT_OPTION_ID, optionValueId: 'optval_black' }],
    });
    expect(product?.defaultVariation?.derivedTitle).toBe('Navy + Mesh');
  });

  it('parses a wine with no options, keeping title beside unitName', async () => {
    const product = await readProduct(WINE_RESPONSE);

    expect(product?.options).toEqual([]);
    expect(
      product?.variations.map(({ title, unitName, volumeMl, optionValues }) => ({
        title,
        unitName,
        volumeMl,
        optionValues,
      })),
    ).toEqual([
      { title: '750', unitName: '750 mL bottle', volumeMl: 750, optionValues: [] },
      { title: '1500', unitName: 'Magnum 1.5 L', volumeMl: 1500, optionValues: [] },
    ]);
    expect(product?.variations[0]?.derivedTitle).toBeUndefined();
  });

  it('leaves options undefined when the response omits them', async () => {
    const product = await readProduct(PRODUCT);

    expect(product?.options).toBeUndefined();
    expect(product?.variations[0]?.optionValues).toBeUndefined();
  });
});
