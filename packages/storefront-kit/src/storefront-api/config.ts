// Configuration is injected by the consuming site (imperative shell): sites
// read PUBLIC_PG_STOREFRONT_API_URL / PUBLIC_PG_PUBLISHABLE_KEY from their own
// env and pass a StorefrontApiConfig into the kit's clients. The kit never
// reads environment variables itself.
export interface StorefrontApiConfig {
  baseUrl: string;
  publishableKey: string;
}

export function isStorefrontApiConfig(
  value: Partial<StorefrontApiConfig> | undefined,
): value is StorefrontApiConfig {
  return Boolean(value?.baseUrl && value?.publishableKey);
}
