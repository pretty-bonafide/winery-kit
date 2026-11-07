// Functional core for local-first cart math. These pure reducers compute the
// next cart snapshot for a mutation BEFORE the network round-trip, so the UI can
// update immediately and reconcile with the authoritative server snapshot when
// it arrives. The imperative shell (`cart-store`) owns the side effects; this
// module owns the math and is exhaustively unit-tested.
import type { AddToCartInput, CartLine, CartSnapshot } from './cart-types.js';

/** Identity used to merge a re-add into an existing line. Mirrors the mock
 * cart store's keying so optimistic merges match what the server would do. */
export function cartLineKey(parts: {
  productId?: string;
  purchaseOptionId?: string;
  variantId?: string;
  sku?: string;
}): string {
  if (parts.purchaseOptionId) return `purchaseOption:${parts.purchaseOptionId}`;
  if (parts.variantId) return `variant:${parts.variantId}`;
  if (parts.sku) return `sku:${parts.sku}`;
  return parts.productId ? `product:${parts.productId}` : '';
}

type CartLineIdentity = {
  productId?: string;
  purchaseOptionId?: string;
  variantId?: string;
  sku?: string;
};

/** Whether `a` and `b` are the same purchasable line. The most specific id
 * both sides carry decides alone: purchaseOptionId, then variantId, then sku.
 * productId is the product slug, shared by every variation (a 750 and its
 * magnum, a hat's three colours), so it only decides for legacy lines where
 * neither side carries a variation id. */
export function sameCartLine(a: CartLineIdentity, b: CartLineIdentity): boolean {
  if (a.purchaseOptionId && b.purchaseOptionId) return a.purchaseOptionId === b.purchaseOptionId;
  if (a.variantId && b.variantId) return a.variantId === b.variantId;
  if (a.sku && b.sku) return a.sku === b.sku;
  if (hasVariationId(a) || hasVariationId(b)) return false;
  return !!a.productId && a.productId === b.productId;
}

function hasVariationId(line: CartLineIdentity): boolean {
  return Boolean(line.purchaseOptionId || line.variantId);
}

/** Temporary id for an optimistically-added line. Deterministic (derived from
 * the line key) so a second add of the same product merges rather than
 * duplicating. The id is replaced by the real one when the server snapshot
 * reconciles, so it only needs to be stable within the optimistic window. */
export function optimisticLineId(input: AddToCartInput): string {
  return `opt:${cartLineKey(input)}`;
}

/** True for ids minted by `optimisticLineId` — i.e. lines the server has not
 * acknowledged yet. The shell uses this to avoid sending edits that reference an
 * id the server does not know. */
export function isOptimisticLineId(id: string): boolean {
  return id.startsWith('opt:');
}

function normalizeQuantity(quantity: number, fallback: number): number {
  return Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : fallback;
}

/** Active lines (quantity > 0) and the totals derived from them. Wishlist /
 * discount enrichment is presentation-only and lives in the view-model, so the
 * snapshot subtotal stays a plain charged sum here. */
function withTotals(cart: CartSnapshot, lines: CartLine[], now: () => string): CartSnapshot {
  const active = lines.filter((line) => line.quantity > 0);
  return {
    ...cart,
    lines: active,
    itemCount: active.reduce((total, line) => total + line.quantity, 0),
    subtotal: active.reduce((total, line) => total + line.quantity * line.unitPrice, 0),
    updatedAt: now(),
  };
}

const defaultNow = () => new Date().toISOString();

export interface ApplyOptions {
  now?: () => string;
}

/** Optimistically add `input` to `cart`: merge into the matching line or append
 * a new one using the caller-supplied display facts (title/price/image). */
export function applyAddItem(
  cart: CartSnapshot,
  input: AddToCartInput,
  options: ApplyOptions = {},
): CartSnapshot {
  const now = options.now ?? defaultNow;
  const quantity = Math.max(1, normalizeQuantity(input.quantity ?? 1, 1));
  const lines = cart.lines.map((line) => ({ ...line }));
  const existing = lines.find((line) => sameCartLine(line, input));

  if (existing) {
    existing.quantity += quantity;
  } else {
    lines.push({
      id: optimisticLineId(input),
      productId: input.productId,
      purchaseOptionId: input.purchaseOptionId,
      variantId: input.variantId,
      sku: input.sku,
      title: input.display?.title ?? 'Item',
      quantity,
      unitPrice: input.display?.unitPrice ?? 0,
      imageUrl: input.display?.imageUrl,
    });
  }

  return withTotals(cart, lines, now);
}

/** Optimistically set a line's quantity (0 removes it). Unknown ids are a no-op
 * so a stale edit can never inflate the cart. */
export function applyUpdateItem(
  cart: CartSnapshot,
  lineId: string,
  quantity: number,
  options: ApplyOptions = {},
): CartSnapshot {
  const now = options.now ?? defaultNow;
  const lines = cart.lines.map((line) =>
    line.id === lineId ? { ...line, quantity: normalizeQuantity(quantity, line.quantity) } : line,
  );
  return withTotals(cart, lines, now);
}

/** Optimistically drop a line. */
export function applyRemoveItem(
  cart: CartSnapshot,
  lineId: string,
  options: ApplyOptions = {},
): CartSnapshot {
  const now = options.now ?? defaultNow;
  const lines = cart.lines.filter((line) => line.id !== lineId);
  return withTotals(cart, lines, now);
}
