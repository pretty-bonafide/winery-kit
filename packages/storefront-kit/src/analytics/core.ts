// Pure core of the top-of-funnel analytics module: config resolution and the
// fixed event schema. No SDK, no globals — the shell (tracker.ts / client.ts)
// reads storage and talks to Amplitude.
import { UTM_KEYS, type UtmParams } from '../utm/core.js';

export type AmplitudeServerZone = 'US' | 'EU';

export interface InitAnalyticsOptions {
  /** The winery's own Amplitude browser API key (one project per winery).
   * Omit it (undefined) to run without analytics; an empty string is a
   * misconfiguration and throws. */
  apiKey?: string;
  /** Stable site id reported on every event, e.g. `paco`. */
  site: string;
  /** Default: `US`. */
  serverZone?: AmplitudeServerZone;
}

export type AnalyticsConfig =
  | { enabled: false }
  | { enabled: true; apiKey: string; site: string; serverZone: AmplitudeServerZone };

/**
 * Analytics is optional config: an absent key is a deliberate "off". A key or
 * site that is present but blank, or an unknown server zone, is a provisioning
 * mistake and throws naming the option (RULES.md §5).
 */
export function resolveAnalyticsConfig(options: InitAnalyticsOptions): AnalyticsConfig {
  const site = options.site?.trim();
  if (!site) throw new Error('initAnalytics: `site` is required and must be non-empty.');

  const serverZone = options.serverZone ?? 'US';
  if (serverZone !== 'US' && serverZone !== 'EU') {
    throw new Error(`initAnalytics: unknown \`serverZone\` "${serverZone}" (expected US or EU).`);
  }

  if (options.apiKey === undefined) return { enabled: false };

  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new Error(
      'initAnalytics: `apiKey` is an empty string — set PUBLIC_AMPLITUDE_API_KEY or omit it to disable analytics.',
    );
  }

  return { enabled: true, apiKey, site, serverZone };
}

export type AnalyticsEventType =
  | 'page_viewed'
  | 'product_viewed'
  | 'product_added_to_cart'
  | 'checkout_started';

export type AnalyticsEventProperties = Record<string, string | number>;

export interface AnalyticsEvent {
  eventType: AnalyticsEventType;
  eventProperties: AnalyticsEventProperties;
}

export interface PageViewedInput {
  type: 'page_viewed';
  path: string;
}

export interface ProductViewedInput {
  type: 'product_viewed';
  productSlug: string;
  productName?: string;
  priceCents?: number;
}

export interface ProductAddedToCartInput {
  type: 'product_added_to_cart';
  productSlug: string;
  productName?: string;
  priceCents?: number;
  quantity: number;
}

export interface CheckoutStartedInput {
  type: 'checkout_started';
  cartItemCount: number;
  cartSubtotalCents: number;
}

export type AnalyticsEventInput =
  | PageViewedInput
  | ProductViewedInput
  | ProductAddedToCartInput
  | CheckoutStartedInput;

export interface AnalyticsContext {
  site: string;
  /** The visitor's stored acquisition, reported unchanged (RULES.md §3). */
  utm: UtmParams | null;
}

/**
 * Builds the Amplitude event for one input, or null when the input can't
 * describe a real event (no product slug, a non-positive quantity, a path that
 * isn't one). Optional fields that don't validate (a fractional price, a blank
 * name) are left off rather than sinking the event. Money stays in cents.
 */
export function buildAnalyticsEvent(
  input: AnalyticsEventInput,
  context: AnalyticsContext,
): AnalyticsEvent | null {
  const properties = buildEventProperties(input);
  if (!properties) return null;

  return {
    eventType: input.type,
    eventProperties: { site: context.site, ...utmProperties(context.utm), ...properties },
  };
}

function buildEventProperties(input: AnalyticsEventInput): AnalyticsEventProperties | null {
  switch (input.type) {
    case 'page_viewed': {
      const path = normalizePath(input.path);
      return path ? { path } : null;
    }
    case 'product_viewed':
      return productProperties(input);
    case 'product_added_to_cart': {
      const product = productProperties(input);
      if (!product || !isPositiveInteger(input.quantity)) return null;
      return { ...product, quantity: input.quantity };
    }
    case 'checkout_started':
      if (!isCount(input.cartItemCount) || !isCount(input.cartSubtotalCents)) return null;
      return {
        cart_item_count: input.cartItemCount,
        cart_subtotal_cents: input.cartSubtotalCents,
      };
  }
}

function productProperties(input: {
  productSlug: string;
  productName?: string;
  priceCents?: number;
}): AnalyticsEventProperties | null {
  const slug = input.productSlug?.trim();
  if (!slug) return null;

  const properties: AnalyticsEventProperties = { product_slug: slug };
  const name = input.productName?.trim();
  if (name) properties.product_name = name;
  if (input.priceCents !== undefined && isCount(input.priceCents)) {
    properties.price_cents = input.priceCents;
  }
  return properties;
}

/** Path only: the query string (which carries UTMs) and hash are dropped — the
 * acquisition is reported once, as `utm_*` properties. */
function normalizePath(raw: string): string | null {
  const path = raw?.trim().split(/[?#]/, 1)[0];
  return path?.startsWith('/') ? path : null;
}

function utmProperties(utm: UtmParams | null): AnalyticsEventProperties {
  const properties: AnalyticsEventProperties = {};
  if (!utm) return properties;
  for (const key of UTM_KEYS) {
    const value = utm[key];
    if (value) properties[`utm_${key}`] = value;
  }
  return properties;
}

function isCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
