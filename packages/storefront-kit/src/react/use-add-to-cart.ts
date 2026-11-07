import { useEffect, useState } from 'react';
import { track } from '../analytics/tracker.js';
import { cartStore } from '../cart/cart-store.js';
import type { AddToCartInput, CartErrorPayload } from '../cart/cart-types.js';
import { toCartErrorPayload } from '../cart/cart-types.js';
import { useCartStore } from './use-cart-store.js';

export type AddToCartStatus = 'idle' | 'adding' | 'added' | 'error';

interface UseAddToCartOptions {
  resetDelayMs?: number;
}

export function useAddToCart(defaultInput?: AddToCartInput, options: UseAddToCartOptions = {}) {
  const { isConfigured, isMutating } = useCartStore();
  const [status, setStatus] = useState<AddToCartStatus>('idle');
  const [error, setError] = useState<CartErrorPayload | null>(null);
  const resetDelayMs = options.resetDelayMs ?? 1600;

  useEffect(() => {
    if (status !== 'added') return;

    const timeout = window.setTimeout(() => setStatus('idle'), resetDelayMs);
    return () => window.clearTimeout(timeout);
  }, [resetDelayMs, status]);

  async function addToCart(input = defaultInput) {
    if (!input) return null;

    setError(null);
    setStatus('adding');

    const quantity = input.quantity ?? 1;
    try {
      const cart = await cartStore.addItem({ ...input, quantity });
      setStatus('added');
      // The cart input's productId is the storefront product slug.
      track({
        type: 'product_added_to_cart',
        productSlug: input.productId,
        productName: input.display?.title,
        priceCents: input.display?.unitPrice,
        quantity,
      });
      return cart;
    } catch (requestError) {
      setError(toCartErrorPayload(requestError));
      setStatus('error');
      return null;
    }
  }

  return {
    addToCart,
    error,
    isAdding: status === 'adding',
    isConfigured,
    isMutating,
    status,
  };
}
