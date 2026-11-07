import { track } from '../analytics/tracker.js';
import { cartStore } from '../cart/cart-store.js';
import { useCartStore } from './use-cart-store.js';

export function useCartSidebar() {
  const state = useCartStore();
  const lines = state.cart?.lines ?? [];
  const itemCount = state.cart?.itemCount ?? 0;
  const subtotal = state.cart?.subtotal ?? 0;

  return {
    ...state,
    closeCart: () => cartStore.closeSidebar(),
    checkout: () => {
      track({ type: 'checkout_started', cartItemCount: itemCount, cartSubtotalCents: subtotal });
      return cartStore.checkout();
    },
    itemCount,
    lines,
    openCart: () => cartStore.openSidebar(),
    removeItem: (lineId: string) => cartStore.removeItem(lineId),
    setOpen: (open: boolean) => {
      if (open) cartStore.openSidebar();
      else cartStore.closeSidebar();
    },
    subtotal,
    updateQuantity: (lineId: string, quantity: number) => cartStore.updateItem(lineId, quantity),
  };
}
