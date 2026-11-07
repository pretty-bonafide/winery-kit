// In-memory mock cart for explicit tests, stories, and isolated component
// development. Production winery sites require Storefront API config and should
// not silently fall back to this store. Mock carts start empty — a seeded line in
// production would read as a real cart with items that were never added.
import type { AddToCartInput, CartLine, CartSnapshot } from './cart-types.js';
import { sameCartLine } from './optimistic.js';

export type MockCartLine = CartLine;
export type MockCartSnapshot = CartSnapshot;
export type AddMockCartLineInput = Partial<AddToCartInput>;

export const MOCK_CART_COOKIE = 'pg_mock_cart_id';

interface MockCartStoreConfig {
  /** Where the mock checkout sends the customer (e.g. the external store origin). */
  checkoutUrl: string;
  /** Dev-only: lines every new mock cart starts with. */
  seedLines: () => MockCartLine[];
}

const config: MockCartStoreConfig = {
  checkoutUrl: '#',
  seedLines: () => [],
};

export function configureMockCarts(options: Partial<MockCartStoreConfig>) {
  if (options.checkoutUrl !== undefined) config.checkoutUrl = options.checkoutUrl;
  if (options.seedLines !== undefined) config.seedLines = options.seedLines;
}

declare global {
  var __pgMockCarts: Map<string, MockCartSnapshot> | undefined;
}

function getStore() {
  globalThis.__pgMockCarts ??= new Map<string, MockCartSnapshot>();
  return globalThis.__pgMockCarts;
}

function createCart(id: string): MockCartSnapshot {
  return normalizeCart({
    id,
    currency: 'USD',
    itemCount: 0,
    subtotal: 0,
    checkoutUrl: config.checkoutUrl,
    lines: config.seedLines(),
    updatedAt: new Date().toISOString(),
  });
}

function normalizeQuantity(quantity: unknown, fallback = 1) {
  const parsed = typeof quantity === 'number' ? quantity : Number(quantity);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

function normalizeCart(cart: MockCartSnapshot): MockCartSnapshot {
  const lines = cart.lines.filter((line) => line.quantity > 0);
  const itemCount = lines.reduce((total, line) => total + line.quantity, 0);
  const subtotal = lines.reduce((total, line) => total + line.quantity * line.unitPrice, 0);

  return {
    ...cart,
    lines,
    itemCount,
    subtotal,
    updatedAt: new Date().toISOString(),
  };
}

function cartLineKey(input: AddMockCartLineInput) {
  if (input.purchaseOptionId) return `purchaseOption:${input.purchaseOptionId}`;
  if (input.variantId) return `variant:${input.variantId}`;
  if (input.sku) return `sku:${input.sku}`;
  return input.productId ? `product:${input.productId}` : '';
}

function lineIdForInput(input: AddMockCartLineInput) {
  return `line_${cartLineKey(input)
    .replace(/[^a-z0-9]+/gi, '_')
    .toLowerCase()}`;
}

export function getMockCart(cartId: string): MockCartSnapshot {
  const store = getStore();
  const existingCart = store.get(cartId);
  if (existingCart) return existingCart;

  const cart = createCart(cartId);
  store.set(cartId, cart);
  return cart;
}

export function addMockCartLine(cartId: string, input: AddMockCartLineInput): MockCartSnapshot {
  const cart = getMockCart(cartId);
  const productId = input.productId || 'sample-wine-2022';
  const quantity = normalizeQuantity(input.quantity, 1);
  const existingLine = cart.lines.find((line) => {
    return sameCartLine(line, { ...input, productId });
  });

  if (existingLine) {
    existingLine.quantity += quantity;
  } else {
    cart.lines.push({
      id: lineIdForInput({ ...input, productId }),
      productId,
      purchaseOptionId: input.purchaseOptionId,
      variantId: input.variantId,
      sku: input.sku,
      title: input.display?.title || 'Sample Wine 2022',
      quantity,
      unitPrice: input.display?.unitPrice ?? 4800,
      imageUrl: input.display?.imageUrl,
    });
  }

  const nextCart = normalizeCart(cart);
  getStore().set(cartId, nextCart);
  return nextCart;
}

export function updateMockCartLine(
  cartId: string,
  lineId: string,
  quantity: unknown,
): MockCartSnapshot {
  const cart = getMockCart(cartId);
  const line = cart.lines.find((item) => item.id === lineId);

  if (line) {
    line.quantity = normalizeQuantity(quantity, line.quantity);
  }

  const nextCart = normalizeCart(cart);
  getStore().set(cartId, nextCart);
  return nextCart;
}

export function removeMockCartLine(cartId: string, lineId: string): MockCartSnapshot {
  const cart = getMockCart(cartId);
  const nextCart = normalizeCart({
    ...cart,
    lines: cart.lines.filter((line) => line.id !== lineId),
  });
  getStore().set(cartId, nextCart);
  return nextCart;
}

export function createMockCartId() {
  return `mock_cart_${crypto.randomUUID()}`;
}
