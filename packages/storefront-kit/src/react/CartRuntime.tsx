import { useEffect } from 'react';
import { cartStore } from '../cart/cart-store.js';
import { restCartAdapter } from '../cart/rest-cart-client.js';
import { customerCommerceStore } from '../storefront-api/customer-commerce-store.js';
import { createStorefrontApiCartAdapter } from '../cart/storefront-api-cart-adapter.js';
import { configureUtmStorage } from '../utm/storage.js';

interface StorefrontApiRuntimeConfig {
  baseUrl: string;
  publishableKey: string;
  checkoutOrigin?: string;
  tokenStorageKey?: string;
}

interface CartRuntimeProps {
  /** Absent (Storefront API unconfigured) the store keeps the default REST
   * adapter, which the site points at its mock cart routes. */
  storefrontApi?: StorefrontApiRuntimeConfig;
  /** Base the customer-context reads (member pricing, entitlement availability,
   * memberships) go through, when it must differ from the cart adapter's base.
   * In the site-domain session model these ride a same-origin `/api/store` proxy
   * that attaches the customer token server-side, while the cart adapter keeps
   * its direct (bearer-token) base. Absent, the cart's `storefrontApi` is reused
   * — the direct model, unchanged. */
  customerContextApi?: StorefrontApiRuntimeConfig;
  /** Override for sites that predate the kit and must keep their original
   * localStorage attribution key (e.g. `acme_utm_v1`). */
  utmStorageKey?: string;
  /** Variation ids visible on the current page. The runtime reads customer
   * pricing, entitlement availability, and memberships in one request. */
  variationIds?: string[];
}

export default function CartRuntime({
  storefrontApi,
  customerContextApi,
  utmStorageKey,
  variationIds = [],
}: CartRuntimeProps) {
  const customerContextConfig = customerContextApi ?? storefrontApi;

  useEffect(() => {
    if (utmStorageKey) configureUtmStorage({ storageKey: utmStorageKey });
  }, [utmStorageKey]);

  useEffect(() => {
    cartStore.configure({
      adapter: storefrontApi ? createStorefrontApiCartAdapter(storefrontApi) : restCartAdapter,
    });
    void cartStore.refresh();
  }, [storefrontApi]);

  useEffect(() => {
    customerCommerceStore.configure({
      storefrontApi: customerContextConfig,
      variationIds,
    });
  }, [customerContextConfig, variationIds]);

  return null;
}
