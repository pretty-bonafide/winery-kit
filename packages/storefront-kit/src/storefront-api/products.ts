import { z } from 'zod';

// Wire contract per docs/storefront-api-pdp-modifications.md M1: one `price` per
// variation (promotion-evaluated customer pricing comes from customer context reads,
// never from a second price field here), `unitName` is the display label, and
// `variations` array order is the contract (server-sorted volume-ascending).
// Product options (e.g. Color, Size) and each variation's option values are
// the non-wine axis: a merch variation carries `optionValues` + `derivedTitle`
// ("Navy + Mesh", "XS / blue") instead of a unit/volume.
const storefrontVariationOptionValueSchema = z
  .object({
    optionId: z.string().min(1),
    optionValueId: z.string().min(1),
  })
  .passthrough();

const storefrontVariationSchema = z
  .object({
    id: z.string().min(1),
    sku: z.string().nullable().optional(),
    price: z.number().nullable().optional(),
    isDefault: z.boolean().nullable().optional(),
    unitName: z.string().nullable().optional(),
    volumeMl: z.number().nullable().optional(),
    imageUrl: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    derivedTitle: z.string().nullable().optional(),
    optionValues: z.array(storefrontVariationOptionValueSchema).nullable().optional(),
  })
  .passthrough();

const storefrontProductOptionValueSchema = z
  .object({
    id: z.string().min(1),
    optionId: z.string().min(1),
    value: z.string(),
    position: z.number(),
  })
  .passthrough();

const storefrontProductOptionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    position: z.number(),
    values: z.array(storefrontProductOptionValueSchema).nullable().optional(),
  })
  .passthrough();

const storefrontProductSchema = z
  .object({
    id: z.string().min(1),
    slug: z.string().min(1),
    name: z.string().min(1),
    imageUrl: z.string().nullable().optional(),
    options: z.array(storefrontProductOptionSchema).nullable().optional(),
    defaultVariation: storefrontVariationSchema.nullable().optional(),
    variations: z.array(storefrontVariationSchema).nullable().optional(),
  })
  .passthrough();

const storefrontProductsSchema = z.array(storefrontProductSchema);

type StorefrontProductResponse = z.output<typeof storefrontProductSchema>;
type StorefrontVariationResponse = z.output<typeof storefrontVariationSchema>;
type StorefrontProductOptionResponse = z.output<typeof storefrontProductOptionSchema>;

/** One option value a variation carries (join onto `StorefrontProductOption.values`). */
export interface StorefrontVariationOptionValue {
  optionId: string;
  optionValueId: string;
}

export interface StorefrontProductVariation {
  id: string;
  sku?: string;
  price?: number;
  isDefault?: boolean;
  unitName?: string;
  volumeMl?: number;
  imageUrl?: string;
  /** Explicit variation title (wines: "750"). */
  title?: string;
  /** Title derived from the option values ("Navy + Mesh", "XS / blue"). */
  derivedTitle?: string;
  /** The option values this variation represents; absent/empty for wines. */
  optionValues?: StorefrontVariationOptionValue[];
}

export interface StorefrontProductOptionValue {
  id: string;
  optionId: string;
  value: string;
  position: number;
}

/** A product option axis (e.g. Color) with its values. */
export interface StorefrontProductOption {
  id: string;
  name: string;
  position: number;
  values: StorefrontProductOptionValue[];
}

export interface StorefrontProduct {
  id: string;
  slug: string;
  name: string;
  imageUrl?: string;
  /** Option axes (Color, Size…); absent when the product has none (wines). */
  options?: StorefrontProductOption[];
  defaultVariation?: StorefrontProductVariation;
  /** All sellable variations in server-sorted order — render as received. */
  variations: StorefrontProductVariation[];
}

// Config is injected by the site's imperative shell (its env-reading
// config module) — the kit never falls back to environment variables.
export interface FetchStorefrontProductOptions {
  baseUrl?: string;
  fetcher?: typeof fetch;
  origin?: string;
  publishableKey?: string;
}

export interface StorefrontProductSource {
  _id: string;
  storefrontProductSlug?: string;
}

export interface ConfiguredStorefrontProductFetchersOptions {
  getConfig: () => Pick<FetchStorefrontProductOptions, 'baseUrl' | 'publishableKey'> | undefined;
}

export interface ConfiguredStorefrontProductFetchers {
  fetchStorefrontProductBySlug: (
    slug: string | undefined,
    options?: FetchStorefrontProductOptions,
  ) => Promise<StorefrontProduct | null>;
  fetchStorefrontProducts: (
    options?: FetchStorefrontProductOptions,
  ) => Promise<StorefrontProduct[]>;
  fetchStorefrontProductsByWineId: (
    wines: StorefrontProductSource[] | null | undefined,
    options?: FetchStorefrontProductOptions,
  ) => Promise<Map<string, StorefrontProduct | null>>;
  isStorefrontProductApiConfigured: () => boolean;
}

export async function fetchStorefrontProductBySlug(
  slug: string | undefined,
  options: FetchStorefrontProductOptions = {},
): Promise<StorefrontProduct | null> {
  const { baseUrl, publishableKey } = options;

  if (!slug || !baseUrl || !publishableKey) return null;

  const url = `${normalizeBaseUrl(baseUrl)}/products/${encodeURIComponent(slug)}`;
  const response = await safeFetch(options.fetcher ?? fetch, {
    origin: options.origin,
    publishableKey,
    url,
  });

  // A failed product read degrades the PDP to unavailable; with the cart island
  // as the only product reader, this console breadcrumb (slug + failure class)
  // is the single operational signal for a bad CMS slug, an origin-allowlist /
  // publishable-key problem, or a 5xx — never let it fail silently.
  if (!response) {
    console.error(`[storefront] product read failed (network/blocked): "${slug}" ${url}`);
    return null;
  }
  if (!response.ok) {
    console.error(
      `[storefront] product read "${slug}" -> ${response.status} ${response.statusText} ${url}`,
    );
    return null;
  }

  try {
    const parsed = storefrontProductSchema.safeParse(await response.json());
    if (!parsed.success) {
      console.error(`[storefront] product read "${slug}" returned an unexpected body ${url}`);
      return null;
    }

    return normalizeStorefrontProduct(parsed.data);
  } catch {
    console.error(`[storefront] product read "${slug}" returned invalid JSON ${url}`);
    return null;
  }
}

export async function fetchStorefrontProducts(
  options: FetchStorefrontProductOptions = {},
): Promise<StorefrontProduct[]> {
  const { baseUrl, publishableKey } = options;

  if (!baseUrl || !publishableKey) return [];

  const url = `${normalizeBaseUrl(baseUrl)}/products`;
  const response = await safeFetch(options.fetcher ?? fetch, {
    origin: options.origin,
    publishableKey,
    url,
  });

  if (!response) {
    console.error(`[storefront] product catalog read failed (network/blocked): ${url}`);
    return [];
  }
  if (!response.ok) {
    console.error(
      `[storefront] product catalog read -> ${response.status} ${response.statusText} ${url}`,
    );
    return [];
  }

  try {
    const parsed = storefrontProductsSchema.safeParse(await response.json());
    if (!parsed.success) {
      console.error(`[storefront] product catalog read returned an unexpected body ${url}`);
      return [];
    }

    return parsed.data.map(normalizeStorefrontProduct);
  } catch {
    console.error(`[storefront] product catalog read returned invalid JSON ${url}`);
    return [];
  }
}

export async function fetchStorefrontProductsByWineId(
  wines: StorefrontProductSource[] | null | undefined,
  options: FetchStorefrontProductOptions = {},
) {
  const wineList = wines ?? [];
  if (wineList.length === 0) return new Map<string, StorefrontProduct | null>();

  const productsBySlug = new Map(
    (await fetchStorefrontProducts(options)).map((product) => [product.slug, product]),
  );

  return new Map(
    wineList.map((wine) => [
      wine._id,
      wine.storefrontProductSlug ? (productsBySlug.get(wine.storefrontProductSlug) ?? null) : null,
    ]),
  );
}

export function createConfiguredStorefrontProductFetchers({
  getConfig,
}: ConfiguredStorefrontProductFetchersOptions): ConfiguredStorefrontProductFetchers {
  function withSiteConfig(options: FetchStorefrontProductOptions = {}) {
    const config = getConfig();
    return {
      baseUrl: config?.baseUrl,
      publishableKey: config?.publishableKey,
      ...options,
    };
  }

  return {
    fetchStorefrontProductBySlug: (slug, options) =>
      fetchStorefrontProductBySlug(slug, withSiteConfig(options)),
    fetchStorefrontProducts: (options) => fetchStorefrontProducts(withSiteConfig(options)),
    fetchStorefrontProductsByWineId: (wines, options) =>
      fetchStorefrontProductsByWineId(wines, withSiteConfig(options)),
    isStorefrontProductApiConfigured: () => {
      const config = getConfig();
      return Boolean(config?.baseUrl && config?.publishableKey);
    },
  };
}

interface SafeFetchOptions {
  origin?: string;
  publishableKey: string;
  url: string;
}

function safeFetch(fetcher: typeof fetch, options: SafeFetchOptions) {
  return Promise.resolve()
    .then(() =>
      fetcher(options.url, {
        headers: createProductRequestHeaders(options),
      }),
    )
    .catch(() => null);
}

function normalizeStorefrontProduct(product: StorefrontProductResponse): StorefrontProduct {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    imageUrl: product.imageUrl ?? undefined,
    options: product.options?.map(normalizeStorefrontProductOption),
    defaultVariation: product.defaultVariation
      ? normalizeStorefrontVariation(product.defaultVariation)
      : undefined,
    variations: (product.variations ?? []).map(normalizeStorefrontVariation),
  };
}

function normalizeStorefrontVariation(
  variation: StorefrontVariationResponse,
): StorefrontProductVariation {
  return {
    id: variation.id,
    sku: variation.sku ?? undefined,
    price: variation.price ?? undefined,
    isDefault: variation.isDefault ?? undefined,
    unitName: variation.unitName ?? undefined,
    volumeMl: variation.volumeMl ?? undefined,
    imageUrl: variation.imageUrl ?? undefined,
    title: variation.title ?? undefined,
    derivedTitle: variation.derivedTitle ?? undefined,
    optionValues: variation.optionValues?.map(({ optionId, optionValueId }) => ({
      optionId,
      optionValueId,
    })),
  };
}

function normalizeStorefrontProductOption(
  option: StorefrontProductOptionResponse,
): StorefrontProductOption {
  return {
    id: option.id,
    name: option.name,
    position: option.position,
    values: (option.values ?? []).map(({ id, optionId, value, position }) => ({
      id,
      optionId,
      value,
      position,
    })),
  };
}

function createProductRequestHeaders(options: SafeFetchOptions) {
  const headers = new Headers({ Accept: 'application/json' });

  headers.set('X-Publishable-Key', options.publishableKey);
  if (options.origin) {
    headers.set('Origin', options.origin);
  }

  return headers;
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '');
}
