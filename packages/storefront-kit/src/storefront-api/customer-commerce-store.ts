import type { StorefrontApiConfig } from './config.js';
import {
  type CustomerMembership,
  createCustomerContextClient,
  type VariationAvailability,
  type VariationPricing,
} from './customer-context.js';

export interface CustomerCommerceState {
  availability: VariationAvailability[] | null;
  error: string | null;
  isConfigured: boolean;
  isLoading: boolean;
  memberships: CustomerMembership[] | null;
  pricing: VariationPricing[] | null;
  variationIds: string[];
}

export interface ConfigureCustomerCommerceOptions {
  storefrontApi?: StorefrontApiConfig;
  variationIds?: string[];
}

type CustomerCommerceListener = () => void;

const initialState: CustomerCommerceState = {
  availability: null,
  error: null,
  isConfigured: false,
  isLoading: false,
  memberships: null,
  pricing: null,
  variationIds: [],
};

let state = initialState;
let config: StorefrontApiConfig | null = null;
let configKey = '';
let loadVersion = 0;
let loadPromise: Promise<CustomerCommerceState> | null = null;

const listeners = new Set<CustomerCommerceListener>();

function emit() {
  for (const listener of listeners) listener();
}

function setState(nextState: Partial<CustomerCommerceState>) {
  state = { ...state, ...nextState };
  emit();
}

function normalizeVariationIds(variationIds: string[] | undefined) {
  return [...new Set(variationIds ?? [])].filter(Boolean).sort();
}

function keyFor(storefrontApi: StorefrontApiConfig | undefined, variationIds: string[]) {
  if (!storefrontApi) return `local:${variationIds.join(',')}`;
  return `${storefrontApi.baseUrl}|${storefrontApi.publishableKey}|${variationIds.join(',')}`;
}

export const customerCommerceStore = {
  configure(options: ConfigureCustomerCommerceOptions) {
    const variationIds = normalizeVariationIds(options.variationIds);
    const nextKey = keyFor(options.storefrontApi, variationIds);
    if (state.isConfigured && nextKey === configKey) return;

    config = options.storefrontApi ?? null;
    configKey = nextKey;
    loadPromise = null;
    loadVersion += 1;

    if (!config || variationIds.length === 0) {
      setState({
        availability: config ? [] : null,
        error: null,
        isConfigured: true,
        isLoading: false,
        memberships: config ? [] : null,
        pricing: config ? [] : null,
        variationIds,
      });
      return;
    }

    setState({
      availability: null,
      error: null,
      isConfigured: true,
      isLoading: true,
      memberships: null,
      pricing: null,
      variationIds,
    });

    void customerCommerceStore.refresh();
  },

  getSnapshot() {
    return state;
  },

  subscribe(listener: CustomerCommerceListener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  async refresh() {
    if (!config) return state;
    if (state.variationIds.length === 0) return state;
    if (loadPromise) return loadPromise;

    const version = loadVersion;
    const client = createCustomerContextClient(config);

    setState({ error: null, isLoading: true });
    loadPromise = client
      .fetchPurchaseContext(state.variationIds)
      .then((context) => {
        const nextState: CustomerCommerceState = {
          ...state,
          availability: context?.availability ?? null,
          error: null,
          isLoading: false,
          memberships: context?.memberships ?? null,
          pricing: context?.pricing ?? null,
        };
        if (version === loadVersion) setState(nextState);
        return version === loadVersion ? nextState : state;
      })
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : 'Customer commerce request failed.';
        if (version === loadVersion) setState({ error: message, isLoading: false });
        return state;
      })
      .finally(() => {
        if (version === loadVersion) loadPromise = null;
      });

    return loadPromise;
  },
};
