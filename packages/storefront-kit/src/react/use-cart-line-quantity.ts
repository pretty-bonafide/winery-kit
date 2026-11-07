import { useMemo } from 'react';
import { useCartStore } from './use-cart-store';

export function useCartLineQuantity(identity: {
  productId?: string;
  purchaseOptionId?: string;
  sku?: string;
  variantId?: string;
}) {
  const { cart } = useCartStore();

  return useMemo(
    () =>
      (cart?.lines ?? []).reduce((total, line) => {
        const matches =
          (!!identity.purchaseOptionId && line.purchaseOptionId === identity.purchaseOptionId) ||
          (!!identity.variantId && line.variantId === identity.variantId) ||
          (!!identity.sku && line.sku === identity.sku) ||
          (!!identity.productId && line.productId === identity.productId);

        return matches ? total + line.quantity : total;
      }, 0),
    [cart?.lines, identity.productId, identity.purchaseOptionId, identity.sku, identity.variantId],
  );
}
