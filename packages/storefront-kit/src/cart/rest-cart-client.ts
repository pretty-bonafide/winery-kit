import type {
  AddToCartInput,
  CartAdapter,
  CartSnapshot,
  CreateCheckoutInput,
} from './cart-types.js';
import { CartRequestError } from './cart-types.js';

async function parseCartResponse(response: Response): Promise<CartSnapshot> {
  if (!response.ok) {
    throw new CartRequestError({
      code: response.status === 401 ? 'authentication_required' : 'cart_request_failed',
      message: `Cart request failed with status ${response.status}`,
      status: response.status,
    });
  }

  return response.json() as Promise<CartSnapshot>;
}

export async function getCart(signal?: AbortSignal) {
  const response = await fetch('/api/cart', {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  });

  return parseCartResponse(response);
}

export async function addCartItem(input: AddToCartInput) {
  const response = await fetch('/api/cart/items', {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  return parseCartResponse(response);
}

export async function updateCartItem(lineId: string, quantity: number) {
  const response = await fetch(`/api/cart/items/${encodeURIComponent(lineId)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ quantity }),
  });

  return parseCartResponse(response);
}

export async function removeCartItem(lineId: string) {
  const response = await fetch(`/api/cart/items/${encodeURIComponent(lineId)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  return parseCartResponse(response);
}

export async function createCheckout(input?: CreateCheckoutInput) {
  const response = await fetch('/api/cart/checkout', {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input ?? {}),
  });

  if (!response.ok) {
    throw new CartRequestError({
      code: 'checkout_unavailable',
      message: `Checkout request failed with status ${response.status}`,
      status: response.status,
    });
  }

  return response.json() as Promise<{ url: string }>;
}

export const restCartAdapter: CartAdapter = {
  getCart,
  addItem: addCartItem,
  updateItem: updateCartItem,
  removeItem: removeCartItem,
  createCheckout,
};
