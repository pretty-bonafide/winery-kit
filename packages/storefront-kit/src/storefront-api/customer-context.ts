// Credentialed customer-context reads for the PDP. Most callers should use
// POST /purchase-context; the narrower pricing, memberships, and availability
// fetchers stay available for focused callers. Paths + wire shapes track the
// live contract at /api/public/v1/openapi.json (see
// docs/storefront-api-pdp-modifications.md for the design notes).
//
// These are browser-side progressive enhancements: the auth cookies are HttpOnly
// on the store origin, so only credentialed browser requests can carry them.
// Every fetcher degrades to `null` on failure — callers degrade to their
// lens's designed anonymous state and never block on these.
import { z } from 'zod';
import type { StorefrontApiConfig } from './config';

const savingsSchema = z.object({
  amount: z.number(),
  basisPoints: z.number(),
});

const appliedPromotionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullable().optional(),
  })
  .passthrough();

const pricingEntrySchema = z
  .object({
    variationId: z.string().min(1),
    retailPrice: z.number(),
    customerPrice: z.number(),
    savings: savingsSchema.nullable(),
    appliedPromotions: z.array(appliedPromotionSchema),
  })
  .passthrough();

const pricingPreviewResponseSchema = z.object({
  pricing: z.array(pricingEntrySchema),
});

const quantityLimitSchema = z.object({
  limit: z.number(),
  redeemed: z.number(),
  available: z.number(),
});

// Wire contract for POST /availability/customer: the store speaks `status` +
// `grant` (openapi.json). parseAvailabilityResponse translates these into the
// panel's domain model (`permission` + `grantContext`) at this boundary, so the
// pure view-model in pdp/purchase-panel-state.ts never sees the wire vocabulary.
const availabilityStatusSchema = z.enum(['available', 'sold_out', 'restricted', 'by_request']);

const availabilityEntrySchema = z
  .object({
    productVariationId: z.string().min(1),
    status: availabilityStatusSchema,
    canAddToCart: z.boolean(),
    canAddToWishlist: z.boolean(),
    quantityLimit: quantityLimitSchema.nullable(),
    grant: z.object({ name: z.string(), endsAt: z.string().nullable() }).nullable().optional(),
  })
  .passthrough();

const availabilityResponseSchema = z.object({
  availability: z.array(availabilityEntrySchema),
});

const membershipSchema = z
  .object({
    id: z.string().min(1),
    clubId: z.string().min(1),
    clubName: z.string().min(1),
    status: z.enum(['active', 'paused', 'hold_manual']),
  })
  .passthrough();

const membershipsResponseSchema = z.object({
  memberships: z.array(membershipSchema),
});

const purchaseContextResponseSchema = z.object({
  pricing: z.array(pricingEntrySchema),
  availability: z.array(availabilityEntrySchema),
  memberships: z.array(membershipSchema),
});

export interface VariationPricing {
  variationId: string;
  retailPrice: number;
  customerPrice: number;
  savings: { amount: number; basisPoints: number } | null;
  appliedPromotions: { id: string; name: string; description?: string }[];
}

export interface QuantityLimit {
  limit: number;
  redeemed: number;
  available: number;
}

export interface VariationAvailability {
  productVariationId: string;
  /** The panel's purchase permission, translated from the store's `status`:
   * - `purchase` — `available`: this visitor may buy (subject to canAddToCart
   *   and the quantity cap);
   * - `wishlist` — `by_request`: the request-to-purchase path;
   * - `restricted` — entitlement-gated: someone can buy this, not this visitor
   *   (anonymous, or signed in without an entitlement). The platform decides
   *   it from entitlements; sites never supply it;
   * - `unavailable` — `sold_out`: nobody can buy it now. */
  permission: 'purchase' | 'wishlist' | 'restricted' | 'unavailable';
  canAddToCart: boolean;
  canAddToWishlist: boolean;
  quantityLimit: QuantityLimit | null;
  grantContext: { name: string; endsAt: string | null } | null;
}

export interface CustomerMembership {
  id: string;
  clubId: string;
  clubName: string;
  status: 'active' | 'paused' | 'hold_manual';
}

export interface CustomerPurchaseContext {
  availability: VariationAvailability[];
  memberships: CustomerMembership[];
  pricing: VariationPricing[];
}

export interface CustomerContextClient {
  fetchPricingPreview(variationIds: string[]): Promise<VariationPricing[] | null>;
  fetchEntitlementAvailability(variationIds: string[]): Promise<VariationAvailability[] | null>;
  fetchMemberships(): Promise<CustomerMembership[] | null>;
  fetchPurchaseContext(variationIds: string[]): Promise<CustomerPurchaseContext | null>;
}

export interface CustomerContextClientOptions {
  fetcher?: typeof fetch;
}

export function createCustomerContextClient(
  config: StorefrontApiConfig,
  options: CustomerContextClientOptions = {},
): CustomerContextClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const fetcher = options.fetcher ?? fetch;

  async function request(path: string, body?: unknown): Promise<unknown | null> {
    const headers = new Headers({
      Accept: 'application/json',
      'X-Publishable-Key': config.publishableKey,
    });

    const init: RequestInit = {
      credentials: 'include',
      headers,
      method: body === undefined ? 'GET' : 'POST',
    };

    if (body !== undefined) {
      headers.set('Content-Type', 'application/json');
      init.body = JSON.stringify(body);
    }

    try {
      const response = await fetcher(`${baseUrl}${path}`, init);
      if (!response.ok) return null;
      return (await response.json()) as unknown;
    } catch {
      return null;
    }
  }

  return {
    async fetchPricingPreview(variationIds) {
      if (variationIds.length === 0) return [];
      return parsePricingPreviewResponse(await request('/pricing/preview', { variationIds }));
    },

    async fetchEntitlementAvailability(variationIds) {
      if (variationIds.length === 0) return [];
      return parseAvailabilityResponse(await request('/availability/customer', { variationIds }));
    },

    async fetchMemberships() {
      return parseMembershipsResponse(await request('/memberships'));
    },

    async fetchPurchaseContext(variationIds) {
      if (variationIds.length === 0) return { availability: [], memberships: [], pricing: [] };
      return parsePurchaseContextResponse(await request('/purchase-context', { variationIds }));
    },
  };
}

export function parsePricingPreviewResponse(body: unknown): VariationPricing[] | null {
  const parsed = pricingPreviewResponseSchema.safeParse(body);
  if (!parsed.success) return null;

  return normalizePricingEntries(parsed.data.pricing);
}

function normalizePricingEntries(
  entries: z.output<typeof pricingEntrySchema>[],
): VariationPricing[] {
  return entries.map((entry) => ({
    variationId: entry.variationId,
    retailPrice: entry.retailPrice,
    customerPrice: entry.customerPrice,
    savings: entry.savings,
    appliedPromotions: entry.appliedPromotions.map((promotion) => ({
      id: promotion.id,
      name: promotion.name,
      description: promotion.description ?? undefined,
    })),
  }));
}

// The store's availability `status` maps one-to-one onto the panel's purchase
// `permission` (renamed into the panel's vocabulary at this boundary). Only
// `purchase` is purchasable; `restricted` is kept distinct from `unavailable`
// because the retail ladder renders the entitlement gate (LIMITED ALLOCATION)
// differently from a sold-out dead end.
const STATUS_TO_PERMISSION: Record<
  z.infer<typeof availabilityStatusSchema>,
  VariationAvailability['permission']
> = {
  available: 'purchase',
  by_request: 'wishlist',
  restricted: 'restricted',
  sold_out: 'unavailable',
};

export function parseAvailabilityResponse(body: unknown): VariationAvailability[] | null {
  const parsed = availabilityResponseSchema.safeParse(body);
  if (!parsed.success) return null;

  return normalizeAvailabilityEntries(parsed.data.availability);
}

function normalizeAvailabilityEntries(
  entries: z.output<typeof availabilityEntrySchema>[],
): VariationAvailability[] {
  return entries.map((entry) => ({
    productVariationId: entry.productVariationId,
    permission: STATUS_TO_PERMISSION[entry.status],
    canAddToCart: entry.canAddToCart,
    canAddToWishlist: entry.canAddToWishlist,
    quantityLimit: entry.quantityLimit,
    grantContext: entry.grant ?? null,
  }));
}

export function parseMembershipsResponse(body: unknown): CustomerMembership[] | null {
  const parsed = membershipsResponseSchema.safeParse(body);
  if (!parsed.success) return null;

  return normalizeMembershipEntries(parsed.data.memberships);
}

function normalizeMembershipEntries(
  entries: z.output<typeof membershipSchema>[],
): CustomerMembership[] {
  return entries.map((membership) => ({
    id: membership.id,
    clubId: membership.clubId,
    clubName: membership.clubName,
    status: membership.status,
  }));
}

export function parsePurchaseContextResponse(body: unknown): CustomerPurchaseContext | null {
  const parsed = purchaseContextResponseSchema.safeParse(body);
  if (!parsed.success) return null;

  return {
    availability: normalizeAvailabilityEntries(parsed.data.availability),
    memberships: normalizeMembershipEntries(parsed.data.memberships),
    pricing: normalizePricingEntries(parsed.data.pricing),
  };
}
