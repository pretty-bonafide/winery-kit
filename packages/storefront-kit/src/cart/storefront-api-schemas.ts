import { z } from 'zod';
import type { CartLine, CartLineComponent, CartPromotionView, CartSnapshot } from './cart-types.js';

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
    // The bundle item a `kind: "component"` item hangs from; null on every line
    // the shopper bought. Absent on a server that predates components.
    parentItemId: z.string().nullable().optional(),
  })
  .passthrough();

// A bundle item's `components` is read apart from the cart response schema so a
// malformed one costs the caption, never the cart.
const storefrontBundleComponentsSchema = z.array(
  z
    .object({
      name: z.string().min(1),
      unitName: z.string().nullable().optional(),
      storedName: z.string().nullable().optional(),
      quantity: z.number().int().positive(),
    })
    .passthrough(),
);

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
  // The flat item list also carries each wine inside a bundle as a component
  // item hanging from the bundle item. The bundle's own item holds the price
  // and quantity, so the components are not lines: counting them would double
  // the bottles and the money.
  const lines = response.items.filter((item) => item.parentItemId == null).map(normalizeCartLine);
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

function normalizeCartLine(item: StorefrontCartResponse['items'][number]): CartLine {
  return {
    id: item.id,
    productId: item.productSlug ?? item.productVariationId ?? item.id,
    purchaseOptionId: item.productVariationId ?? undefined,
    variantId: item.productVariationId ?? undefined,
    sku: item.sku ?? undefined,
    title: cartLineTitle(item),
    quantity: item.quantity,
    unitPrice: item.price ?? item.basePrice ?? item.listPrice ?? 0,
    imageUrl: item.imageUrl ?? undefined,
    components: bundleComponentsOf(item),
  };
}

// What ONE bundle holds, from the bundle item's own `components`. Each component
// item's quantity is the bundle line's quantity × its count per bundle, so the
// per-bundle count is the quotient. All or nothing: a partial list would caption
// a box as holding fewer wines than it does, so any component that cannot be
// read (or does not divide evenly) leaves the line without a caption.
function bundleComponentsOf(
  item: StorefrontCartResponse['items'][number],
): CartLineComponent[] | undefined {
  if (item.components === undefined || item.quantity === 0) return undefined;
  const parsed = storefrontBundleComponentsSchema.safeParse(item.components);
  if (!parsed.success || parsed.data.length === 0) return undefined;
  if (parsed.data.some((component) => component.quantity % item.quantity !== 0)) return undefined;

  return parsed.data.map((component) => ({
    title: cartLineTitle(component),
    quantity: component.quantity / item.quantity,
  }));
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
function cartLineTitle(item: {
  name: string;
  unitName?: string | null;
  storedName?: string | null;
}): string {
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
