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
import { useEffect, useMemo, useRef, useState } from 'react';
import { cartStore } from '../cart/cart-store.js';
import type { AddToCartInput } from '../cart/cart-types.js';
import { toCartErrorPayload } from '../cart/cart-types.js';
import type {
  AlternativeCandidate,
  AlternativeSuggestion,
  CartProductSeed,
  ClubUpsell,
  PurchaseLens,
  PurchasePanelView,
  ResolvedCartProduct,
} from '../pdp/purchase-panel-state.js';
import {
  buildPurchasePanelView,
  buildSelectedCartInput,
  resolveCartProduct,
  resolveVariationForOptionValue,
} from '../pdp/purchase-panel-state.js';
import { createStorefrontAuthClient } from '../storefront-api/auth.js';
import type { StorefrontApiConfig } from '../storefront-api/config.js';
import type {
  CustomerMembership,
  CustomerPurchaseContext,
  QuantityLimit,
  VariationAvailability,
  VariationPricing,
} from '../storefront-api/customer-context.js';
import { createCustomerContextClient } from '../storefront-api/customer-context.js';
import type { StorefrontProductVariation } from '../storefront-api/products.js';
import { fetchStorefrontProductBySlug } from '../storefront-api/products.js';
import { panelProductView } from './product-view.js';
import { useCartStore } from './use-cart-store.js';
import { useProductView } from './use-product-view.js';
import { usePurchaseAction } from './use-purchase-action.js';

const DEFAULT_ADD_LABELS = {
  add: 'ADD TO CART',
  adding: 'ADDING',
  added: 'ADDED',
  retry: 'TRY AGAIN',
  unavailable: 'UNAVAILABLE',
};

export type PurchasePanelAddLabels = typeof DEFAULT_ADD_LABELS;

/** The visitor's session as the SITE knows it. Supplied by sites whose sign-in
 * is not visible to the platform's own session endpoint (a code-exchange
 * session held in the site's cookie). `pending` until the site's read ends.
 *
 * The contract: a site supplies a status that SETTLES (a session read that
 * fails is `anonymous`; the kit has no timeout). A `pending` that never
 * resolves keeps the purchase action pending and never reads. */
export interface PurchasePanelSession {
  status: 'pending' | 'anonymous' | 'authenticated';
}

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
  /** Where the members-only / not-allocated CTA sends the visitor. The
   * allocation lens defaults it; the retail lens shows the CTA only when set. */
  waitingListHref?: string;
  /** Where the members-only state's SIGN IN action goes — the site's login
   * start. Offered only with `session`, and only once it is known `anonymous`
   * (never while `pending`, never to a signed-in visitor). */
  signInHref?: string;
  /** Base for the credentialed purchase-context read — the site's same-origin
   * proxy, which attaches the signed-in customer's token server-side. Omitted
   * → `storefrontApi`, as before. */
  customerContextApi?: StorefrontApiConfig;
  /** The visitor's session, from the site. OPT-IN: when omitted the panel
   * behaves exactly as before — a retail denial stays `unavailable`, no sign-in
   * action, the allocation lens reads its own platform session. When PROVIDED:
   *  - it is the only source of "signed in" on both lenses (the allocation
   *    lens's direct platform session read is skipped), and a retail denial
   *    becomes `members-only` / `not-allocated` once the status is known;
   *  - the purchase-context read waits until it is not `pending`, and the buy
   *    button stays pending until the session AND the first read have settled
   *    (a failed read then fails open);
   *  - a change of status clears the previous visitor's pricing, availability,
   *    memberships and cached quantity limit before any new read.
   * Supply it from the first render or never: adding or removing it after mount
   * is not supported. */
  session?: PurchasePanelSession;
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
  /** Attach to the element that shows this wine (the panel or its card).
   * `product_viewed` (surface `page`) fires once half of it has been on screen
   * and the product has resolved; a panel with no attached element never
   * reports a view. */
  viewRef: (node: Element | null) => void;
}

// One purchase-context read: the failure policy lives here, the state setting
// stays with the caller.
function readCustomerContext(
  config: StorefrontApiConfig,
  variationIds: string[],
  lens: PurchaseLens,
  apply: (context: CustomerPurchaseContext | null) => void,
): Promise<void> {
  return createCustomerContextClient(config)
    .fetchPurchaseContext(variationIds)
    .then((context) => {
      if (context == null && lens === 'allocation') {
        // Without affirmative data the view model degrades to members-only
        // rather than asserting "Not in your current allocation".
        console.error(
          'usePurchasePanel: purchase context unavailable — member sees the members-only state.',
        );
      }
      apply(context);
    });
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
    signInHref,
    customerContextApi,
    session,
    clubUpsell,
    restricted,
    publicQuantityLimit,
    requestCap,
    requestHref,
    alternativeCandidates,
  } = options;
  const hasSiteSession = session !== undefined;
  const sessionStatus = session?.status;
  const labels = { ...DEFAULT_ADD_LABELS, ...options.labels };

  const { cart, isMutating } = useCartStore();
  // Mount gate: false on the server and the first client render (so hydration
  // matches SSR), then true after the effect runs. Gating the CTA on this turns
  // a silently-inert pre-hydration button into a visibly-disabled one.
  const [isHydrated, setIsHydrated] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [isDirectlyAuthenticated, setIsAuthenticated] = useState(false);
  // With a site session: the variations the context read waits to ask about, and
  // whether that read has settled for the current visitor (success or failure).
  const [contextVariationIds, setContextVariationIds] = useState<string[] | null>(null);
  const [isContextSettled, setIsContextSettled] = useState(false);
  const isAuthenticated = hasSiteSession
    ? sessionStatus === 'authenticated'
    : isDirectlyAuthenticated;
  // What the view model is told: the site's session as a tri-state (unknown while
  // pending); without one, only the allocation lens's own read (0.7.1), and
  // retail stays unknown, so a denial stays `unavailable`.
  const knownAuthentication: boolean | undefined = hasSiteSession
    ? sessionStatus === 'pending'
      ? undefined
      : sessionStatus === 'authenticated'
    : lens === 'allocation'
      ? isDirectlyAuthenticated
      : undefined;
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: slug/cartSeed/storefrontApi/customerContextApi/lens/hasSiteSession are page-render constants.
  useEffect(() => {
    // Unconfigured commerce: synthesize the mock resolution from the CMS seed
    // alone — no storefront read, and no purchase context to layer on.
    if (!storefrontApi) {
      setResolution(resolveCartProduct(cartSeed, null, { configured: false }));
      return;
    }

    let cancelled = false;

    function fetchCustomerContext(variationIds: string[]) {
      void readCustomerContext(
        customerContextApi ?? (storefrontApi as StorefrontApiConfig),
        variationIds,
        lens,
        (context) => {
          if (cancelled) return;
          setPricing(context?.pricing ?? null);
          setAvailability(context?.availability ?? null);
          setMemberships(context?.memberships ?? null);
        },
      );
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
      if (hasSiteSession) {
        // The context read waits for the site's session (the effect below).
        setContextVariationIds(variationIds);
      } else if (lens === 'allocation') {
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

  // A new visitor starts from nothing: when the site's session changes, drop the
  // previous visitor's pricing, availability, memberships and cached cart-error
  // limit before any new read (declared before the read effect, so it runs first).
  const previousSessionStatus = useRef(sessionStatus);
  useEffect(() => {
    if (!hasSiteSession || previousSessionStatus.current === sessionStatus) return;
    previousSessionStatus.current = sessionStatus;
    setPricing(null);
    setAvailability(null);
    setMemberships(null);
    setErrorLimit(null);
    setIsContextSettled(false);
  }, [hasSiteSession, sessionStatus]);

  // With a site session: the purchase-context read, once the product has given
  // its variations AND the session is known, so an answer is never read before
  // it. The allocation lens only reads for a signed-in visitor (an anonymous
  // read would come back empty anyway). Depends on the config's VALUES, not its
  // identity, so a caller that builds the config inline cannot loop it.
  const contextConfig = customerContextApi ?? storefrontApi;
  const hasStorefrontApi = Boolean(storefrontApi);
  const contextBaseUrl = contextConfig?.baseUrl;
  const contextPublishableKey = contextConfig?.publishableKey;
  useEffect(() => {
    if (!hasSiteSession || !hasStorefrontApi || contextVariationIds === null) return;
    if (contextBaseUrl === undefined || contextPublishableKey === undefined) return;
    if (sessionStatus === 'pending') return;
    if (lens === 'allocation' && sessionStatus !== 'authenticated') return;

    let cancelled = false;
    void readCustomerContext(
      { baseUrl: contextBaseUrl, publishableKey: contextPublishableKey },
      contextVariationIds,
      lens,
      (context) => {
        if (cancelled) return;
        setPricing(context?.pricing ?? null);
        setAvailability(context?.availability ?? null);
        setMemberships(context?.memberships ?? null);
        setIsContextSettled(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [
    hasSiteSession,
    hasStorefrontApi,
    contextBaseUrl,
    contextPublishableKey,
    contextVariationIds,
    sessionStatus,
    lens,
  ]);

  // product_viewed (surface `page`) once the site-attached element has been on
  // screen and the product has resolved, live or mock.
  const viewRef = useProductView(panelProductView({ resolution, slug, cartSeed }));

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
        isAuthenticated: knownAuthentication,
        waitingListHref,
        signInHref: hasSiteSession && sessionStatus === 'anonymous' ? signInHref : undefined,
        // ^ no sign-in action without a site session, and none until it is known
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
      hasSiteSession,
      knownAuthentication,
      lens,
      memberships,
      pricing,
      productOptions,
      publicQuantityLimit,
      requestCap,
      requestHref,
      restricted,
      selectedId,
      sessionStatus,
      signInHref,
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
  // With a site session the buy button is not enabled before the permission
  // answer: pending until the session has settled and, when a read is due, its
  // first answer has landed (success or failure; a failed read fails open).
  const isReadDue =
    hasSiteSession &&
    Boolean(storefrontApi) &&
    contextVariationIds !== null &&
    (lens === 'retail' || sessionStatus === 'authenticated');
  const isPermissionPending =
    hasSiteSession && (sessionStatus === 'pending' || (isReadDue && !isContextSettled));
  // The action's own (card) viewRef is never attached here: the panel reports
  // the page view above.
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
      pending: isProductPending || isPermissionPending,
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
    viewRef,
  };
}
