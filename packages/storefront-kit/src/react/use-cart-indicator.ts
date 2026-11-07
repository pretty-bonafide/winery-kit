import { getCartItemsIndicatorState } from '../cart/cart-indicator-state.js';
import { cartStore } from '../cart/cart-store.js';
import { useCartStore } from './use-cart-store.js';

interface UseCartIndicatorOptions {
  initialCount?: number;
  maxDisplayCount?: number;
}

export function useCartIndicator({
  initialCount = 0,
  maxDisplayCount,
}: UseCartIndicatorOptions = {}) {
  const { cart, isLoading, persistedItemCount } = useCartStore();
  // Live cart wins; before it loads, fall back to the last-known count from a
  // prior session (localStorage), then to the SSR-provided initialCount.
  const count = cart?.itemCount ?? persistedItemCount ?? initialCount;
  const indicator = getCartItemsIndicatorState(count, maxDisplayCount);

  return {
    ...indicator,
    isLoading,
    openCart: () => cartStore.openSidebar(),
  };
}
