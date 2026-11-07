import type { ReactNode } from "react";
import {
  getCartItemsIndicatorState,
  type CartItemsIndicatorState,
} from '../cart/cart-indicator-state';

export type { CartItemsIndicatorState };

interface CartItemsIndicatorProps {
  count: number;
  maxDisplayCount?: number;
  children: (state: CartItemsIndicatorState) => ReactNode;
}

export function CartItemsIndicator({
  count,
  maxDisplayCount,
  children,
}: CartItemsIndicatorProps) {
  return <>{children(getCartItemsIndicatorState(count, maxDisplayCount))}</>;
}
