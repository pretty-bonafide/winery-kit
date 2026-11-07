import type { z } from 'zod';
import type {
  AddToCartInput,
  CartAdapter,
  CartErrorCode,
  CartSnapshot,
  CreateCheckoutInput,
} from './cart-types';
import { CartRequestError } from './cart-types';
import {
  normalizeStorefrontCartResponse,
  normalizeStorefrontQuotePromotions,
  storefrontCartCreateResponseSchema,
  storefrontCartResponseSchema,
  storefrontCheckoutSessionResponseSchema,
} from './storefront-api-schemas';

const DEFAULT_TOKEN_STORAGE_KEY = 'wine_turbo_public_cart_token';

export interface CartTokenStorage {
  getCartToken(): string | null;
  setCartToken(token: string): void;
  clearCartToken(): void;
}

export interface StorefrontApiCartAdapterOptions {
  baseUrl: string;
  publishableKey: string;
  checkoutOrigin?: string;
  tokenStorage?: CartTokenStorage;
  tokenStorageKey?: string;
  fetcher?: typeof fetch;
  credentials?: RequestCredentials;
  now?: () => Date;
}

interface StorefrontRequestOptions {
  body?: unknown;
  cartToken?: string;
  method?: string;
  signal?: AbortSignal;
}

export function createLocalStorageCartTokenStorage(
  key = DEFAULT_TOKEN_STORAGE_KEY,
): CartTokenStorage {
  return {
    getCartToken() {
      if (typeof window === 'undefined') return null;
      return window.localStorage.getItem(key);
    },
    setCartToken(token: string) {
      if (typeof window === 'undefined') return;
      window.localStorage.setItem(key, token);
    },
    clearCartToken() {
      if (typeof window === 'undefined') return;
      window.localStorage.removeItem(key);
    },
  };
}

export function createEmptyCartSnapshot(now: () => Date = () => new Date()): CartSnapshot {
  return {
    id: 'empty-cart',
    currency: 'USD',
    itemCount: 0,
    subtotal: 0,
    checkoutUrl: '',
    lines: [],
    updatedAt: now().toISOString(),
  };
}

export function createStorefrontApiCartAdapter(
  options: StorefrontApiCartAdapterOptions,
): CartAdapter {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetcher: typeof fetch = options.fetcher ?? ((input, init) => fetch(input, init));
  const tokenStorage =
    options.tokenStorage ?? createLocalStorageCartTokenStorage(options.tokenStorageKey);
  const now = options.now ?? (() => new Date());
  const credentials = options.credentials ?? 'omit';

  async function request(path: string, requestOptions: StorefrontRequestOptions = {}) {
    const headers = new Headers({
      Accept: 'application/json',
      'X-Publishable-Key': options.publishableKey,
    });

    if (requestOptions.cartToken) {
      headers.set('X-Cart-Token', requestOptions.cartToken);
    }

    const init: RequestInit = {
      credentials,
      headers,
      method: requestOptions.method ?? 'GET',
      signal: requestOptions.signal,
    };

    if (requestOptions.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      init.body = JSON.stringify(requestOptions.body);
    }

    return fetcher(`${baseUrl}${path}`, init);
  }

  async function createCartToken() {
    const response = await request('/carts', { method: 'POST' });
    const created = await parseJsonResponse(
      response,
      storefrontCartCreateResponseSchema,
      'cart_unavailable',
    );
    tokenStorage.setCartToken(created.cartToken);
    return created.cartToken;
  }

  async function ensureCartToken() {
    return tokenStorage.getCartToken() ?? createCartToken();
  }

  // A 401 rejecting the SIGNED CART TOKEN (tampered, cross-org, or signed with
  // a rotated platform secret) is permanent: tokens carry no expiry, so the
  // adapter would resend the same bad token forever and every cart view would
  // error until the visitor cleared localStorage by hand. Recovery is to drop
  // the token and start a clean cart — mirroring the 404 purged-cart path. The
  // one 401 that must NOT reset is the customer-auth refresh contract
  // (`token_expired`): that is about the pg_pub_at cookie on credentialed
  // calls, and the cart token itself is still valid.
  function isCartTokenRejection(error: unknown): error is CartRequestError {
    return (
      error instanceof CartRequestError && error.status === 401 && error.reason !== 'token_expired'
    );
  }

  function resetRejectedCartToken(op: string) {
    // Operational signal, mirroring the product-read breadcrumbs in
    // products.ts: a burst of these means outstanding cart tokens stopped
    // verifying (e.g. the platform cart-token secret was rotated).
    console.error(`[storefront] cart token rejected (401) on ${op} -> dropping token, cart reset`);
    tokenStorage.clearCartToken();
  }

  async function getCart(signal?: AbortSignal) {
    const cartToken = tokenStorage.getCartToken();
    if (!cartToken) return createEmptyCartSnapshot(now);

    const response = await request('/carts/current', { cartToken, signal });
    if (response.status === 404) {
      // The platform purged or expired this cart — a stored token would 404 on
      // every refresh forever. Drop it and start clean instead of surfacing a
      // permanent "cart unavailable" error.
      tokenStorage.clearCartToken();
      return createEmptyCartSnapshot(now);
    }
    let cart: z.infer<typeof storefrontCartResponseSchema>;
    try {
      cart = await parseJsonResponse(response, storefrontCartResponseSchema, 'cart_unavailable');
    } catch (error) {
      if (isCartTokenRejection(error)) {
        resetRejectedCartToken('cart read');
        return createEmptyCartSnapshot(now);
      }
      throw error;
    }
    return normalizeStorefrontCartResponse(cart, { now });
  }

  // Order promotions come from the checkout quote, a separate and heavier read
  // than the cart. The store calls this only when promotions are visible (the
  // cart sheet is open and has lines), never as part of getCart().
  async function getPromotions(signal?: AbortSignal) {
    const cartToken = tokenStorage.getCartToken();
    if (!cartToken) return [];
    const response = await request('/checkout/quote', {
      cartToken,
      method: 'POST',
      signal,
    });
    // A failed quote rejects; the store logs it, shows no promotions, and
    // retries on the next sheet open or cart change.
    await parseOkResponse(response, 'cart_request_failed');
    return normalizeStorefrontQuotePromotions(await response.json());
  }

  async function addItem(input: AddToCartInput) {
    const quantity = input.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new CartRequestError({
        code: 'invalid_quantity',
        message: 'Quantity must be at least 1.',
      });
    }

    const productVariationId = getPurchaseOptionId(input);
    const cartToken = await ensureCartToken();
    const response = await request('/carts/current/items', {
      body: { productVariationId, quantity },
      cartToken,
      method: 'POST',
    });
    try {
      await parseOkResponse(response, 'item_unavailable');
    } catch (error) {
      if (!isCartTokenRejection(error)) throw error;
      // The stored token is dead; the add is still what the visitor asked for —
      // mint a clean cart and retry exactly once instead of failing the click.
      resetRejectedCartToken('add item');
      const freshToken = await createCartToken();
      const retry = await request('/carts/current/items', {
        body: { productVariationId, quantity },
        cartToken: freshToken,
        method: 'POST',
      });
      await parseOkResponse(retry, 'item_unavailable');
    }
    return getCart();
  }

  async function updateItem(lineId: string, quantity: number) {
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new CartRequestError({
        code: 'invalid_quantity',
        message: 'Quantity must be 0 or greater.',
      });
    }

    const cartToken = await requireCartToken();
    const response = await request(`/carts/current/items/${encodeURIComponent(lineId)}`, {
      body: { quantity },
      cartToken,
      method: 'PATCH',
    });
    try {
      await parseOkResponse(response, 'invalid_quantity');
    } catch (error) {
      // The line ids belonged to the dead token's cart — nothing to mutate.
      // Reset and let getCart() report the now-empty cart.
      if (!isCartTokenRejection(error)) throw error;
      resetRejectedCartToken('item update');
    }
    return getCart();
  }

  async function removeItem(lineId: string) {
    const cartToken = await requireCartToken();
    const response = await request(`/carts/current/items/${encodeURIComponent(lineId)}`, {
      cartToken,
      method: 'DELETE',
    });
    try {
      await parseOkResponse(response, 'cart_request_failed');
    } catch (error) {
      if (!isCartTokenRejection(error)) throw error;
      resetRejectedCartToken('item removal');
    }
    return getCart();
  }

  async function createCheckout(input?: CreateCheckoutInput) {
    const cartToken = await requireCartToken();
    const utm = input?.utm;
    const response = await request('/checkout/session', {
      body: utm && Object.keys(utm).length > 0 ? { utm } : {},
      cartToken,
      method: 'POST',
    });
    let session: z.infer<typeof storefrontCheckoutSessionResponseSchema>;
    try {
      session = await parseJsonResponse(
        response,
        storefrontCheckoutSessionResponseSchema,
        'checkout_unavailable',
      );
    } catch (error) {
      if (!isCartTokenRejection(error)) throw error;
      // There is no cart to check out — reset, and surface a human message
      // (cart error messages render verbatim in the sidebar).
      resetRejectedCartToken('checkout');
      throw new CartRequestError({
        code: 'cart_unavailable',
        message: 'Your cart expired and was reset — please add your wines again.',
        status: 401,
      });
    }
    return { url: applyCheckoutOrigin(session.checkoutUrl, options.checkoutOrigin) };
  }

  async function requireCartToken() {
    const cartToken = tokenStorage.getCartToken();
    if (!cartToken) {
      throw new CartRequestError({
        code: 'cart_unavailable',
        message: 'Cart is not available.',
      });
    }
    return cartToken;
  }

  return {
    getCart,
    getPromotions,
    addItem,
    updateItem,
    removeItem,
    createCheckout,
  };
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '');
}

function applyCheckoutOrigin(checkoutUrl: string, checkoutOrigin?: string) {
  if (!checkoutOrigin) return checkoutUrl;

  try {
    const url = new URL(checkoutUrl);
    const origin = new URL(checkoutOrigin);
    url.protocol = origin.protocol;
    url.host = origin.host;
    return url.toString();
  } catch {
    return checkoutUrl;
  }
}

function getPurchaseOptionId(input: AddToCartInput) {
  const purchaseOptionId = input.purchaseOptionId ?? input.variantId;
  if (!purchaseOptionId) {
    throw new CartRequestError({
      code: 'item_unavailable',
      message: 'A purchase option id is required for the public storefront API.',
      recoverable: false,
    });
  }
  return purchaseOptionId;
}

async function parseOkResponse(response: Response, fallbackCode: CartErrorCode) {
  if (!response.ok) throw await toCartRequestError(response, fallbackCode);
}

async function parseJsonResponse<T>(
  response: Response,
  schema: z.ZodType<T>,
  fallbackCode: CartErrorCode,
): Promise<T> {
  if (!response.ok) throw await toCartRequestError(response, fallbackCode);

  const data = (await response.json()) as unknown;
  const parsed = schema.safeParse(data);

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const issuePath = firstIssue?.path.length ? firstIssue.path.join('.') : 'response';

    throw new CartRequestError({
      code: fallbackCode,
      message: `Storefront API returned an unexpected ${issuePath} value.`,
      recoverable: false,
      status: response.status,
    });
  }

  return parsed.data;
}

async function toCartRequestError(
  response: Response,
  fallbackCode: CartErrorCode,
): Promise<CartRequestError> {
  const body = await readJsonBody(response);
  const reason = getErrorReason(body);
  const message =
    getErrorMessage(body) ?? `Storefront API request failed with status ${response.status}.`;

  return new CartRequestError({
    code: mapErrorCode(response.status, reason, fallbackCode),
    message,
    status: response.status,
    quantityLimit: getErrorQuantityLimit(body),
    reason: reason ?? undefined,
  });
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

// `data.reason` values shipped by the platform (docs/storefront-api-pdp-modifications.md M5).
const REASON_CODE_MAP: Record<string, CartErrorCode> = {
  exceeds_limit: 'allocation_exceeded',
  insufficient_stock: 'item_unavailable',
  out_of_stock: 'item_unavailable',
  invalid_request: 'invalid_quantity',
};

function mapErrorCode(
  status: number,
  reason: string | null,
  fallbackCode: CartErrorCode,
): CartErrorCode {
  if (status === 401) return 'authentication_required';
  if (status === 403) return 'item_unavailable';
  if (status === 404) return 'cart_unavailable';
  if (!reason) return fallbackCode;

  const mapped = REASON_CODE_MAP[reason];
  if (mapped) return mapped;

  // Transitional substring fallback for bodies that predate the structured
  // `data.reason` contract; the exact map above is authoritative.
  if (reason.includes('stock') || reason.includes('unavailable')) return 'item_unavailable';
  if (reason.includes('quantity') || reason.includes('invalid')) return 'invalid_quantity';
  if (reason.includes('allocation') || reason.includes('entitlement') || reason.includes('limit')) {
    return 'allocation_exceeded';
  }

  return fallbackCode;
}

function getErrorMessage(value: unknown): string | null {
  const record = asRecord(value);
  const error = asRecord(record?.error);

  return (
    getString(error, 'message') ??
    getString(record, 'message') ??
    getString(record, 'error') ??
    null
  );
}

function getErrorReason(value: unknown): string | null {
  const record = asRecord(value);
  const error = asRecord(record?.error);
  const data = asRecord(error?.data) ?? asRecord(record?.data);

  return (
    (
      getString(data, 'reason') ??
      getString(error, 'code') ??
      getString(record, 'reason') ??
      getString(record, 'code') ??
      // The platform's bare `{"error":"token_expired"}` shape (auth-routes
      // credentialedJson) — the error field IS the reason when it's a string.
      getString(record, 'error') ??
      null
    )?.toLowerCase() ?? null
  );
}

// `data.quantityLimit` accompanies `exceeds_limit` errors (M5) and mirrors the
// availability read's block — lets the PDP stepper cap quantity client-side.
function getErrorQuantityLimit(
  value: unknown,
): { limit: number; redeemed: number; available: number } | undefined {
  const record = asRecord(value);
  const error = asRecord(record?.error);
  const data = asRecord(error?.data) ?? asRecord(record?.data);
  const quantityLimit = asRecord(data?.quantityLimit);
  if (!quantityLimit) return undefined;

  const { limit, redeemed, available } = quantityLimit;
  if (typeof limit !== 'number' || typeof redeemed !== 'number' || typeof available !== 'number') {
    return undefined;
  }

  return { limit, redeemed, available };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getString(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return typeof value === 'string' ? value : null;
}
