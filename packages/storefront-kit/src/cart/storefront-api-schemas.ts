import { z } from 'zod';
import type { CartPromotionView, CartSnapshot } from './cart-types';

export const storefrontCartCreateResponseSchema = z.object({
  cartToken: z.string().min(1),
  draftId: z.string().min(1),
});

const storefrontCartLineSchema = z
  .object({
    id: z.string().min(1),
    productVariationId: z.string().min(1).nullable().optional(),
    productSlug: z.string().min(1).nullable().optional(),
    sku: z.string().nullable().optional(),
    name: z.string().min(1),
    unitName: z.string().nullable().optional(),
    storedName: z.string().nullable().optional(),
    listPrice: z.number().optional(),
    basePrice: z.number().optional(),
    price: z.number().optional(),
    imageUrl: z.string().nullable().optional(),
    quantity: z.number().int().min(0),
  })
  .passthrough();

export const storefrontCartResponseSchema = z
  .object({
    id: z.string().min(1),
    items: z.array(storefrontCartLineSchema),
    subtotal: z.number().optional(),
    expiresAt: z.string().nullable().optional(),
  })
  .passthrough();

const storefrontPromotionProgressSchema = z
  .object({
    promotionId: z.string().min(1),
    message: z.string().min(1),
    percentComplete: z.number(),
    remainingRequirement: z
      .object({
        type: z.enum(['amount', 'quantity']),
        value: z.number(),
      })
      .optional(),
    hasFreeShipping: z.boolean(),
  })
  .passthrough();

const storefrontAppliedPromotionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    hasFreeShipping: z.boolean(),
  })
  .passthrough();

const storefrontPromotionDisplaySchema = z
  .object({
    progress: z.array(storefrontPromotionProgressSchema),
    appliedPromotions: z.array(storefrontAppliedPromotionSchema),
  })
  .passthrough();

const storefrontQuoteDraftSchema = z
  .object({
    calculation: z
      .object({
        promotionDisplay: storefrontPromotionDisplaySchema,
      })
      .passthrough(),
  })
  .passthrough();

const storefrontQuoteResponseSchema = z
  .object({
    drafts: z.array(storefrontQuoteDraftSchema).optional(),
    promotionDisplay: storefrontPromotionDisplaySchema.optional(),
  })
  .passthrough();

export const storefrontCheckoutSessionResponseSchema = z.object({
  checkoutUrl: z.string().url(),
  sessionId: z.string().min(1),
});

export type StorefrontCartCreateResponse = z.output<typeof storefrontCartCreateResponseSchema>;
export type StorefrontCartResponse = z.output<typeof storefrontCartResponseSchema>;
export type StorefrontCheckoutSessionResponse = z.output<
  typeof storefrontCheckoutSessionResponseSchema
>;
type StorefrontPromotionDisplay = z.output<typeof storefrontPromotionDisplaySchema>;

interface NormalizeStorefrontCartOptions {
  now?: () => Date;
}

export function normalizeStorefrontCartResponse(
  response: StorefrontCartResponse,
  options: NormalizeStorefrontCartOptions = {},
): CartSnapshot {
  const lines = response.items.map((item) => {
    const unitPrice = item.price ?? item.basePrice ?? item.listPrice ?? 0;
    const productId = item.productSlug ?? item.productVariationId ?? item.id;
    const title = cartLineTitle(item);

    return {
      id: item.id,
      productId,
      purchaseOptionId: item.productVariationId ?? undefined,
      variantId: item.productVariationId ?? undefined,
      sku: item.sku ?? undefined,
      title,
      quantity: item.quantity,
      unitPrice,
      imageUrl: item.imageUrl ?? undefined,
    };
  });
  const subtotal =
    response.subtotal ?? lines.reduce((total, line) => total + line.unitPrice * line.quantity, 0);

  return {
    id: response.id,
    currency: 'USD',
    itemCount: lines.reduce((total, line) => total + line.quantity, 0),
    subtotal,
    checkoutUrl: '',
    lines,
    updatedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
}

export function normalizeStorefrontQuotePromotions(response: unknown): CartPromotionView[] {
  const parsed = storefrontQuoteResponseSchema.safeParse(response);
  if (!parsed.success) return [];

  const displays: StorefrontPromotionDisplay[] = [];
  if (parsed.data.promotionDisplay) displays.push(parsed.data.promotionDisplay);
  for (const draft of parsed.data.drafts ?? []) {
    displays.push(draft.calculation.promotionDisplay);
  }

  const applied = dedupeBy(
    displays.flatMap((display) =>
      display.appliedPromotions.map(
        (promotion): CartPromotionView => ({
          id: promotion.id,
          title: promotion.name,
          applied: true,
        }),
      ),
    ),
    (promotion) => promotion.id,
  );
  const appliedIds = new Set(applied.map((promotion) => promotion.id));
  const progress = dedupeBy(
    displays.flatMap((display) =>
      display.progress.map(
        (promotion): CartPromotionView => ({
          id: promotion.promotionId,
          title: promotion.hasFreeShipping ? 'Free shipping' : 'Promotion',
          applied: false,
          nudge: promotion.message,
          progress: Math.max(0, Math.min(1, promotion.percentComplete / 100)),
        }),
      ),
    ),
    (promotion) => promotion.id,
  ).filter((promotion) => !appliedIds.has(promotion.id));

  return [...progress, ...applied];
}

// storedName is the platform's composed display name for the line ("2022
// Estate Reserve Magnum 1.5 L", "Anniversary Logo Hat — Black"), so it wins.
// Without one, fall back to name + unitName — which alone cannot name an option
// variation (merch has unitName null). optionValues is deliberately not read.
function cartLineTitle(item: StorefrontCartResponse['items'][number]): string {
  const storedName = item.storedName?.trim();
  if (storedName) return storedName;
  return item.unitName ? `${item.name} ${item.unitName}` : item.name;
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = key(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
