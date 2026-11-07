import { useEffect, useState } from 'react';
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

    try {
      const cart = await cartStore.addItem({
        ...input,
        quantity: input.quantity ?? 1,
      });
      setStatus('added');
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
