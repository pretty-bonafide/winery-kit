import type { UtmParams } from '../utm/core.js';

export type CartCurrency = 'USD';

export type CartErrorCode =
  | 'cart_request_failed'
  | 'cart_unavailable'
  | 'checkout_unavailable'
  | 'invalid_quantity'
  | 'item_unavailable'
  | 'price_changed'
  | 'allocation_exceeded'
  | 'authentication_required';

/** Entitlement remaining-quantity block mirrored from the storefront API
 * (`data.quantityLimit` on `exceeds_limit` errors and the availability read —
 * see docs/storefront-api-pdp-modifications.md M4/M5). */
export interface CartQuantityLimit {
  limit: number;
  redeemed: number;
  available: number;
}

export interface CartErrorPayload {
  code: CartErrorCode;
  message: string;
  status?: number;
  recoverable?: boolean;
  /** Present on allocation_exceeded errors when the API reports the customer's
   * remaining entitlement — lets the PDP stepper cap quantity client-side. */
  quantityLimit?: CartQuantityLimit;
  /** The platform's raw error reason/code (lowercased) when the body carried
   * one — distinguishes 401 variants (`token_expired` refresh contract vs a
   * rejected cart token) that map to the same CartErrorCode. */
  reason?: string;
}

export interface CartLine {
  id: string;
  productId: string;
  purchaseOptionId?: string;
  variantId?: string;
  sku?: string;
  title: string;
  quantity: number;
  unitPrice: number;
  imageUrl?: string;
}

export interface CartSnapshot {
  id: string;
  currency: CartCurrency;
  itemCount: number;
  subtotal: number;
  checkoutUrl: string;
  lines: CartLine[];
  /** Order-level promotions normalized from the cart quote/calculation response.
   * Absent until quoted (see `CartAdapter.getPromotions`). */
  promotions?: CartPromotionView[];
  updatedAt: string;
}

/** How a line participates in the offer — drives the stepper's third cell and
 * the line's badges. `purchase` buys within the limit; `at-limit` has reached
 * the purchase limit so further taps add to the wishlist (a request, never
 * charged); `wishlist-only` is request-only (max purchase 0). */
export type CartLineMode = 'purchase' | 'at-limit' | 'wishlist-only';

export interface CartLineDiscount {
  kind: 'member' | 'sale';
  /** Short tag rendered beside the price, e.g. "MEMBER −20%" / "SALE −33%". */
  label: string;
  /** Optional savings sentence, e.g. "You save $9.00 a bottle · Club Member Pricing". */
  note?: string;
}

export interface CartLineStockBadge {
  kind: 'sold-out' | 'low-stock' | 'by-request';
  label: string;
}

/** Presentation view-model the shared `CartSidebar` renders. Sites map their
 * `CartLine` (plus any commerce enrichment) into this shape. The wishlist,
 * discount, format, and stock fields are all optional — the component degrades
 * to a plain purchase line when they are absent, so a site can adopt the
 * component before the wishlist/entitlement data pipeline exists. */
export interface CartLineView {
  id: string;
  productId: string;
  title: string;
  imageUrl?: string;
  /** Bottle format / unit, e.g. "750ML" — rendered as a badge by the name. */
  format?: string;
  /** Live / charged unit price, in cents. */
  unitPrice: number;
  /** List price in cents; struck through when greater than `unitPrice`. */
  listPrice?: number;
  discount?: CartLineDiscount;
  /** Guaranteed / charged quantity. */
  purchaseQty: number;
  /** Effective purchase limit = min(offer max, stock). Reaching it flips the
   * stepper's plus into the wishlist heart. */
  purchaseLimit?: number;
  /** Requested beyond the limit — never charged at checkout. */
  wishlistQty?: number;
  mode: CartLineMode;
  stockBadge?: CartLineStockBadge;
  /** Local persistence state for fast cart UIs. The shared cart store only emits
   * failed states for actionable recovery; host apps may pass pending when they
   * intentionally want to surface background persistence. */
  syncStatus?: 'pending' | 'failed';
  syncMessage?: string;
}

/** A cart-level (order) promotion rendered in the sidebar. Scope is automatic,
 * threshold-driven offers: a nudge toward the threshold while unmet, and a
 * savings/perk line once applied. The component renders whatever list it is
 * given and shows nothing when the list is empty. */
export interface CartPromotionView {
  id: string;
  /** Customer-facing name, e.g. "Free shipping over $150" or "15% off 6+ bottles". */
  title: string;
  /** Threshold met → applied to the order total. */
  applied: boolean;
  /** Shown while unmet — the nudge toward the threshold, e.g.
   * "Add $20 more for free shipping" or "Add 1 more bottle to save 15%". */
  nudge?: string;
  /** 0..1 progress toward the threshold; drives an optional progress bar. */
  progress?: number;
  /** Order savings in cents when applied. Omit for non-monetary perks (free
   * shipping, a free gift) — those render as an applied perk with no amount. */
  savings?: number;
}

export interface AddToCartInput {
  productId: string;
  /** Canonical purchasable unit id. Required by the public storefront API adapter. */
  purchaseOptionId?: string;
  variantId?: string;
  sku?: string;
  quantity?: number;
  display?: {
    title?: string;
    unitPrice?: number;
    imageUrl?: string;
  };
}

export interface CreateCheckoutInput {
  utm?: UtmParams;
}

export interface CartAdapter {
  /** Cart lines only. Adapters that implement `getPromotions` leave
   * `promotions` off the snapshot; the store quotes them lazily. */
  getCart(signal?: AbortSignal): Promise<CartSnapshot>;
  /** Order-level promotions for the current cart, fetched on demand (only
   * while the cart sheet is open and the cart has lines). Optional: an adapter
   * without it may still carry `promotions` on the snapshots it returns. */
  getPromotions?(signal?: AbortSignal): Promise<CartPromotionView[]>;
  addItem(input: AddToCartInput): Promise<CartSnapshot>;
  updateItem(lineId: string, quantity: number): Promise<CartSnapshot>;
  removeItem(lineId: string): Promise<CartSnapshot>;
  createCheckout(input?: CreateCheckoutInput): Promise<{ url: string }>;
}

export class CartRequestError extends Error {
  readonly code: CartErrorCode;
  readonly status?: number;
  readonly recoverable: boolean;
  readonly quantityLimit?: CartQuantityLimit;
  readonly reason?: string;

  constructor(payload: CartErrorPayload) {
    super(payload.message);
    this.name = 'CartRequestError';
    this.code = payload.code;
    this.status = payload.status;
    this.recoverable = payload.recoverable ?? true;
    this.quantityLimit = payload.quantityLimit;
    this.reason = payload.reason;
  }
}

export function toCartErrorPayload(error: unknown): CartErrorPayload {
  if (error instanceof CartRequestError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      recoverable: error.recoverable,
      quantityLimit: error.quantityLimit,
    };
  }

  return {
    code: 'cart_request_failed',
    message: error instanceof Error ? error.message : 'Cart request failed',
    recoverable: true,
  };
}
