import { useMemo, useSyncExternalStore } from 'react';
import { customerCommerceStore } from '../storefront-api/customer-commerce-store.js';

const getServerSnapshot = customerCommerceStore.getSnapshot;

export function useCustomerCommerce() {
  return useSyncExternalStore(
    customerCommerceStore.subscribe,
    customerCommerceStore.getSnapshot,
    getServerSnapshot,
  );
}

export function useVariationCommerce(variationId: string | undefined) {
  const commerce = useCustomerCommerce();

  return useMemo(
    () => ({
      availability: variationId
        ? (commerce.availability?.find((entry) => entry.productVariationId === variationId) ?? null)
        : null,
      commerce,
      pricing: variationId
        ? (commerce.pricing?.find((entry) => entry.variationId === variationId) ?? null)
        : null,
    }),
    [commerce, variationId],
  );
}
