import { useEffect, useSyncExternalStore } from 'react';
import { cartStore } from '../cart/cart-store.js';

export function useCartStore() {
  const cartState = useSyncExternalStore(
    cartStore.subscribe,
    cartStore.getSnapshot,
    cartStore.getServerSnapshot,
  );

  useEffect(() => {
    if (cartState.isConfigured && !cartState.cart && !cartState.isLoading) {
      void cartStore.refresh();
    }
  }, [cartState.cart, cartState.isConfigured, cartState.isLoading]);

  return cartState;
}
