import { cartStore } from '../cart/cart-store';
import { useCartStore } from './use-cart-store';

export function useCartSidebar() {
  const state = useCartStore();
  const lines = state.cart?.lines ?? [];
  const itemCount = state.cart?.itemCount ?? 0;
  const subtotal = state.cart?.subtotal ?? 0;

  return {
    ...state,
    closeCart: () => cartStore.closeSidebar(),
    checkout: () => cartStore.checkout(),
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
