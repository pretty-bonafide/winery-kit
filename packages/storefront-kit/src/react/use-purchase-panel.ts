// Island controller for the PDP purchase panel — all data wiring (product read,
// session, purchase context, cart store, format selection, add-to-cart) with
// zero presentation. Sites render the returned view with their own markup; the
// state resolution itself lives in pdp/purchase-panel-state.ts.
//
// The product itself is fetched client-side from the CMS join key (`slug`) +
// public config — the server hands the island only CMS data (RULES.md Rule 1:
// no storefront reads during SSR). Until that read resolves the panel sits in
// its pending state (`isProductPending`): CMS price visible, CTA disabled — the
// same shape as the SSR/pre-hydration markup, so first paint never flips to
// UNAVAILABLE before the product lands.
//
// Lens behavior:
// - retail: purchase-context fetches fire immediately (anonymous credentialed
//   reads degrade to null and the panel renders the public retail state).
// - allocation: the storefront session is read first; purchase context is only
//   fetched for authenticated visitors, and every failure fails closed into
//   the members-only state (logged — a member seeing JOIN THE WAITING LIST
//   reads as a lapsed membership, support needs the breadcrumb).
import { useEffect, useMemo, useState } from 'react';
import { cartStore } from '../cart/cart-store';
import type { AddToCartInput } from '../cart/cart-types';
import { toCartErrorPayload } from '../cart/cart-types';
import type {
  AlternativeCandidate,
  AlternativeSuggestion,
  CartProductSeed,
  ClubUpsell,
  PurchaseLens,
  PurchasePanelView,
  ResolvedCartProduct,
} from '../pdp/purchase-panel-state';
import {
  buildPurchasePanelView,
  buildSelectedCartInput,
  resolveCartProduct,
  resolveVariationForOptionValue,
} from '../pdp/purchase-panel-state';
import { createStorefrontAuthClient } from '../storefront-api/auth';
import type { StorefrontApiConfig } from '../storefront-api/config';
import type {
  CustomerMembership,
  QuantityLimit,
  VariationAvailability,
  VariationPricing,
} from '../storefront-api/customer-context';
import { createCustomerContextClient } from '../storefront-api/customer-context';
import type { StorefrontProductVariation } from '../storefront-api/products';
import { fetchStorefrontProductBySlug } from '../storefront-api/products';
import { useCartStore } from './use-cart-store';
import { usePurchaseAction } from './use-purchase-action';

const DEFAULT_ADD_LABELS = {
  add: 'ADD TO CART',
  adding: 'ADDING',
  added: 'ADDED',
  retry: 'TRY AGAIN',
  unavailable: 'UNAVAILABLE',
};

export type PurchasePanelAddLabels = typeof DEFAULT_ADD_LABELS;

export interface UsePurchasePanelOptions {
  /** Present only when the public storefront API is configured — gates the
   * client-side product read, the session read, and the credentialed
   * purchase-context fetch. */
  storefrontApi?: StorefrontApiConfig;
  /** CMS join key — the storefront product slug the island fetches the product,
   * variations, and live pricing from after hydration. */
  slug?: string;
  /** CMS-owned cart-line display seed (title, image, editorial price). Merged
   * with the client-fetched product into the add-to-cart input. */
  cartSeed: CartProductSeed;
  fallbackPriceLabel?: string;
  unitNoun?: string;
  /** Default: retail. */
  lens?: PurchaseLens;
  /** Allocation lens: where the members-only CTA sends the visitor. */
  waitingListHref?: string;
  /** Club-discount marketing facts (site/CMS-supplied, pre-formatted), shown
   * to non-members on purchasable PDPs. Omit when the brand runs no club
   * discounts — the panel renders nothing for it. */
  clubUpsell?: ClubUpsell;
  /** Affirmative offer-level entitlement gate — site/CMS-supplied until the
   * public availability API lands. Only `true` asserts the restricted state. */
  restricted?: boolean;
  /** Public per-customer cap (offer-level fact) — the scarcity cap row. */
  publicQuantityLimit?: number;
  /** Per-offer request cap (`maxWishlist`) — the by-request cap row. */
  requestCap?: number;
  /** REQUEST TO PURCHASE destination until the purchase-request API ships. */
  requestHref?: string;
  /** Recovery suggestions (ranked, CMS-sourced) for when this wine can't be
   * purchased. When commerce is configured and this wine is unsellable, the
   * island verifies candidates client-side and surfaces the first that resolves
   * to a sellable product as `alternative` — so the CTA never points at another
   * dead PDP. Unconfigured (mock) commerce passes the top candidate through. */
  alternativeCandidates?: AlternativeCandidate[];
  labels?: Partial<PurchasePanelAddLabels>;
}

export interface UsePurchasePanelResult {
  view: PurchasePanelView;
  isAuthenticated: boolean;
  /** False during SSR and the first client render, true after the island
   * mounts. The CTA stays disabled until this flips, so a not-yet-hydrated (or
   * failed-to-hydrate) panel never renders an enabled-looking button that does
   * nothing on click. */
  isHydrated: boolean;
  /** True until the client-side product read resolves (mock mode resolves
   * synchronously on mount). The CTA stays disabled and labelled with the
   * add label — never UNAVAILABLE — while pending. */
  isProductPending: boolean;
  isAdding: boolean;
  isMutating: boolean;
  addInput: AddToCartInput | null;
  addLabel: string;
  addDisabled: boolean;
  /** Where to send a customer who can't buy this wine. Client-side-verified to
   * be sellable when commerce is configured (null until a candidate is
   * confirmed, or when none qualify); the top candidate, unverified, in mock
   * mode. Parts render it only in the states where this wine can't be bought. */
  alternative: AlternativeSuggestion | null;
  selectFormat: (formatId: string) => void;
  /** Choose one option value (e.g. Color → Black); selects the variation the
   * pure resolver lands on, and is a no-op when no variation carries it. */
  selectOptionValue: (optionId: string, optionValueId: string) => void;
  setCartQuantity: (quantity: number) => Promise<void>;
  submitAddToCart: () => void;
  openSidebar: () => void;
}

// Stable identity for the pending/empty case so the view useMemo doesn't churn
// on every render before the product resolves.
const NO_VARIATIONS: StorefrontProductVariation[] = [];
const EMPTY_CANDIDATES: AlternativeCandidate[] = [];

export function usePurchasePanel(options: UsePurchasePanelOptions): UsePurchasePanelResult {
  const {
    storefrontApi,
    slug,
    cartSeed,
    fallbackPriceLabel,
    unitNoun = 'bottle',
    lens = 'retail',
    waitingListHref,
    clubUpsell,
    restricted,
    publicQuantityLimit,
    requestCap,
    requestHref,
    alternativeCandidates,
  } = options;
  const labels = { ...DEFAULT_ADD_LABELS, ...options.labels };

  const { cart, isMutating } = useCartStore();
  // Mount gate: false on the server and the first client render (so hydration
  // matches SSR), then true after the effect runs. Gating the CTA on this turns
  // a silently-inert pre-hydration button into a visibly-disabled one.
  const [isHydrated, setIsHydrated] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pricing, setPricing] = useState<VariationPricing[] | null>(null);
  const [availability, setAvailability] = useState<VariationAvailability[] | null>(null);
  const [memberships, setMemberships] = useState<CustomerMembership[] | null>(null);
  const [errorLimit, setErrorLimit] = useState<QuantityLimit | null>(null);
  // null = the client product read hasn't resolved yet (pending). A resolved
  // value always has a variations array and a possibly-null cartProduct.
  const [resolution, setResolution] = useState<ResolvedCartProduct | null>(null);
  // The recovery suggestion, once resolved (verified sellable when configured).
  const [alternative, setAlternative] = useState<AlternativeSuggestion | null>(null);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: slug/cartSeed/storefrontApi/lens are page-render constants.
  useEffect(() => {
    // Unconfigured commerce: synthesize the mock resolution from the CMS seed
    // alone — no storefront read, and no purchase context to layer on.
    if (!storefrontApi) {
      setResolution(resolveCartProduct(cartSeed, null, { configured: false }));
      return;
    }

    let cancelled = false;

    function fetchCustomerContext(variationIds: string[]) {
      const client = createCustomerContextClient(storefrontApi as StorefrontApiConfig);

      void client.fetchPurchaseContext(variationIds).then((context) => {
        if (context == null && lens === 'allocation') {
          // Without affirmative data the view model degrades to members-only
          // rather than asserting "Not in your current allocation".
          console.error(
            'usePurchasePanel: purchase context unavailable — member sees the members-only state.',
          );
        }
        if (!cancelled) {
          setPricing(context?.pricing ?? null);
          setAvailability(context?.availability ?? null);
          setMemberships(context?.memberships ?? null);
        }
      });
    }

    // Self-fetch the storefront product from the CMS join key + public config
    // (RULES.md Rule 1: the server never reads the storefront). On resolution,
    // build the cart input, then layer on credentialed purchase context.
    void fetchStorefrontProductBySlug(slug, {
      baseUrl: storefrontApi.baseUrl,
      publishableKey: storefrontApi.publishableKey,
    }).then((product) => {
      if (cancelled) return;
      const resolved = resolveCartProduct(cartSeed, product, { configured: true });
      setResolution(resolved);
      if (resolved.variations.length === 0) return;

      const variationIds = resolved.variations.map((variation) => variation.id);
      if (lens === 'allocation') {
        const auth = createStorefrontAuthClient(storefrontApi as StorefrontApiConfig);
        auth
          .getSession()
          .then((session) => {
            if (cancelled || session.status !== 'authenticated') return;
            setIsAuthenticated(true);
            // Customer context is only meaningful with a session — anonymous
            // credentialed reads would all come back null anyway.
            fetchCustomerContext(variationIds);
          })
          .catch((error) => {
            // Fail closed into the members-only state — but never silently.
            console.error('usePurchasePanel: session read failed — rendering members-only.', error);
          });
      } else {
        fetchCustomerContext(variationIds);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Recovery suggestion. The server can't verify candidates (RULES.md Rule 1:
  // no storefront reads at SSR), so the island does it: when commerce is
  // configured and THIS wine is unsellable, fetch candidates in rank order and
  // surface the first that resolves to a sellable product — suppressing the CTA
  // entirely if none qualify, so it never points at another dead PDP. When
  // commerce is unconfigured, or this wine is itself sellable (the CTA is only a
  // rarely-shown nicety then), pass the top candidate through unverified.
  // biome-ignore lint/correctness/useExhaustiveDependencies: storefrontApi/alternativeCandidates are page-render constants; the gate is `resolution`.
  useEffect(() => {
    if (resolution === null) return;
    const candidates = alternativeCandidates ?? EMPTY_CANDIDATES;
    const top = candidates[0];
    if (!top) {
      setAlternative(null);
      return;
    }

    if (!storefrontApi || resolution.cartProduct != null) {
      setAlternative({ label: top.label, href: top.href });
      return;
    }

    let cancelled = false;
    void (async () => {
      for (const candidate of candidates) {
        if (!candidate.slug) continue;
        const product = await fetchStorefrontProductBySlug(candidate.slug, {
          baseUrl: storefrontApi.baseUrl,
          publishableKey: storefrontApi.publishableKey,
        });
        if (product?.defaultVariation?.price != null) {
          if (!cancelled) setAlternative({ label: candidate.label, href: candidate.href });
          return;
        }
      }
      if (!cancelled) setAlternative(null);
    })();

    return () => {
      cancelled = true;
    };
  }, [resolution]);

  const isProductPending = resolution === null;
  const variations = resolution?.variations ?? NO_VARIATIONS;
  const productOptions = resolution?.options;
  const cartProduct = resolution?.cartProduct ?? null;
  // Tri-state: while the read is pending we don't know yet, so leave it
  // undefined (purchasable default, CMS price). Only an affirmative resolution
  // with no cart product asserts the degraded state.
  const hasCartProduct = isProductPending ? undefined : cartProduct != null;
  const view = useMemo(
    () =>
      buildPurchasePanelView({
        variations,
        options: productOptions,
        selectedVariationId: selectedId,
        lens,
        isAuthenticated,
        waitingListHref,
        pricing,
        availability,
        memberships,
        cartLines: cart?.lines ?? [],
        fallbackPriceLabel,
        hasCartProduct,
        errorQuantityLimit: errorLimit,
        unitNoun,
        clubUpsell,
        restricted,
        publicQuantityLimit,
        requestCap,
        requestHref,
      }),
    [
      availability,
      cart,
      clubUpsell,
      errorLimit,
      fallbackPriceLabel,
      hasCartProduct,
      isAuthenticated,
      lens,
      memberships,
      pricing,
      productOptions,
      publicQuantityLimit,
      requestCap,
      requestHref,
      restricted,
      selectedId,
      unitNoun,
      variations,
      waitingListHref,
    ],
  );

  const selectedVariation = variations.find(
    (variation) => variation.id === view.selectedVariationId,
  );
  const selectedPricing = pricing?.find((entry) => entry.variationId === view.selectedVariationId);
  const addInput =
    cartProduct && selectedVariation
      ? buildSelectedCartInput(cartProduct, selectedVariation, selectedPricing, cartSeed.title)
      : cartProduct;
  const addAction = usePurchaseAction({
    input: addInput,
    labels: {
      ...labels,
      // `resolved` policy should not normally enter a commerce-loading state,
      // but keep a deterministic fallback for adapter/runtime gaps.
      checking: labels.add,
    },
    policy: {
      kind: 'resolved',
      canPurchase: view.canPurchase,
      pending: isProductPending,
    },
  });

  useEffect(() => {
    if (addAction.error?.quantityLimit) setErrorLimit(addAction.error.quantityLimit);
  }, [addAction.error]);

  function selectFormat(formatId: string) {
    setSelectedId(formatId);
    setErrorLimit(null);
  }

  function selectOptionValue(optionId: string, optionValueId: string) {
    const variation = resolveVariationForOptionValue(
      variations,
      selectedId,
      optionId,
      optionValueId,
    );
    if (variation) selectFormat(variation.id);
  }

  async function setCartQuantity(quantity: number) {
    if (!view.cartLine) return;
    try {
      await cartStore.updateItem(view.cartLine.id, quantity);
    } catch (error) {
      const payload = toCartErrorPayload(error);
      if (payload.quantityLimit) setErrorLimit(payload.quantityLimit);
    }
  }

  return {
    view,
    isAuthenticated,
    isHydrated,
    isProductPending,
    isAdding: addAction.isAdding,
    isMutating,
    addInput,
    addLabel: addAction.label,
    addDisabled: addAction.disabled,
    alternative,
    selectFormat,
    selectOptionValue,
    setCartQuantity,
    submitAddToCart: addAction.submit,
    openSidebar: () => cartStore.openSidebar(),
  };
}
