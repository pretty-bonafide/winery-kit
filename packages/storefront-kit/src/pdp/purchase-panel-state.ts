// Functional core for the PDP purchase panel (winery-kit/docs/pdp docs).
// Pure resolution of API data + cart state + UI selection into a render-ready
// view model; all fetching and cart mutation stays in the island shell
// (use the usePurchasePanel hook from @pretty-good/storefront-kit/react).
//
// Two purchase lenses share this machine:
// - `retail` (default): public catalog — anonymous visitors can buy; the
//   availability read (answered for anonymous visitors too) only ever *blocks*
//   a purchase (entitlement gate, allocation caps, stock).
//   States: purchasable | in-cart | unavailable | restricted | by-request | degraded.
// - `allocation`: members-only store — membership gates everything, and the
//   member's entitlement decides purchasable vs not-allocated. Anonymous and
//   non-member visitors see members-only (price visible, waiting-list CTA).
//   States: members-only | purchasable | in-cart | not-allocated | by-request | degraded.
//
// `restricted` (retail) is the per-wine entitlement gate: visible to everyone,
// purchasable by entitled customers. The platform decides it: asserted from
// the availability read's `permission: 'restricted'` (store status
// `restricted` — anonymous visitors and signed-in visitors without an
// entitlement), never from the CMS. Copy is scarcity-first (LIMITED ALLOCATION
// / "select members"), never membership mechanics, and the price stays
// full-strength — gated, not gone. (The deprecated site-supplied `restricted`
// input still escalates to this state; see PurchasePanelInput.restricted.)
//
// `by-request` is the platform wishlist: a *request to purchase* that may be
// approved immediately, not a notify-me list. Asserted from affirmative
// availability facts (`canAddToWishlist` without purchase) on either lens, and
// it outranks the unavailable/not-allocated dead ends — the request path being
// open means more to the customer than "you can't buy this".
//
// `degraded` is the display-only state: nothing blocked the purchase, but the
// page could not establish that it may be bought — no add-to-cart input could
// be wired (no storefront product or sellable variation resolved), or, on the
// retail lens, the availability read failed — so the panel shows the price
// with a disabled CTA. It is only ever asserted from affirmative facts
// (`hasCartProduct: false`, `availabilityReadFailed: true`) — callers that
// don't know (direct view-model builds, reads still in flight) keep the
// purchasable default.
import type { AddToCartInput, CartLine } from '../cart/cart-types';
import { formatUsdCents } from '../money';
import type {
  CustomerMembership,
  QuantityLimit,
  VariationAvailability,
  VariationPricing,
} from '../storefront-api/customer-context';
import type {
  StorefrontProduct,
  StorefrontProductOption,
  StorefrontProductVariation,
} from '../storefront-api/products';

export type PurchaseLens = 'retail' | 'allocation';

export type PurchasePanelState =
  | 'purchasable'
  | 'in-cart'
  | 'unavailable'
  | 'members-only'
  | 'not-allocated'
  | 'restricted'
  | 'by-request'
  | 'degraded';

export interface PurchaseFormatView {
  id: string;
  name: string;
  volume: string;
  price: string;
  retailPrice?: string;
}

/** One selectable value of a product option (e.g. "Black" under Color). */
export interface PurchaseOptionValueView {
  id: string;
  label: string;
  /** The currently selected variation carries this value. */
  selected: boolean;
  /** Some variation carries this value, so choosing it always lands on a
   * real variation (via resolveVariationForOptionValue's fallback on a
   * partial grid). Values no variation carries are unavailable. */
  available: boolean;
}

/** A product option axis (e.g. Color, Size) — replaces the flat format list
 * for products with options. Ordered by `position`, values by `position`. */
export interface PurchaseOptionView {
  id: string;
  name: string;
  values: PurchaseOptionValueView[];
}

/** Where to send a customer when this wine can't be purchased. */
export interface AlternativeSuggestion {
  label: string;
  href: string;
}

/** A ranked recovery candidate carrying its storefront join key, so the island
 * can verify the candidate is itself sellable before offering it (a verified
 * alternative never points at another dead PDP). */
export interface AlternativeCandidate extends AlternativeSuggestion {
  /** Storefront product slug; without one the candidate can't be verified. */
  slug?: string;
}

/** Site-supplied club-discount marketing facts, pre-formatted — anonymous
 * visitors can't call the pricing preview, and the client does no price math.
 * Brands choose the presentation from these parts:
 * - one brand renders the club price as a primary price-row element
 *   (`label` "CLUB PRICE:" + `price` "$41.60" beside retail);
 * - another renders a secondary caption teaser
 *   (`note` "Cellar Club members pay $58.50 (save 10%)" + `cta` club link).
 * Every field is optional; parts render nothing when their datum is absent. */
export interface ClubUpsell {
  /** Eyebrow/label beside the club price (e.g. "CLUB PRICE:"). */
  label?: string;
  /** Pre-formatted club price (e.g. "$41.60") for primary presentations. */
  price?: string;
  /** Prose teaser (e.g. "Cellar Club members pay $58.50 (save 10%)"). */
  note?: string;
  /** Club-page CTA (e.g. "JOIN THE WINE CLUB →" → /wine-club). */
  cta?: { label: string; href: string };
}

export interface PurchaseSummaryView {
  layout: 'simple' | 'unit' | 'member-inline' | 'member-stacked';
  price: string;
  retailPrice?: string;
  caption?: string;
  unit?: string;
  savingsNote?: string;
  /** Name of the promotion behind the member price (`appliedPromotions[0]`),
   * rendered verbatim per the mocks (e.g. "Cellar Club Member Pricing"). */
  promotionName?: string;
}

export interface PurchasePanelView {
  state: PurchasePanelState;
  memberBadge?: string;
  /** Flat variation list (wine formats). Undefined when the product has
   * options — the option groups replace it. */
  formats?: PurchaseFormatView[];
  /** Option groups — present only when the product has at least one option. */
  options?: PurchaseOptionView[];
  selectedVariationId?: string;
  summary: PurchaseSummaryView;
  cartLine?: { id: string; quantity: number };
  cartNote?: string;
  entitlementStatus?: string;
  /** Release/grant name from the entitlement (e.g. "2024 Release"); never the
   * platform's system "universal" grant. Allocation lens only. */
  grantName?: string;
  unavailableNote?: string;
  /** Members-only status copy for anonymous / non-member visitors. */
  membersOnlyNote?: string;
  /** Waiting-list CTA for the members-only state — never an enabled purchase CTA. */
  waitingListCta?: { label: string; href: string };
  /** Club-discount marketing teaser — present only for non-members on a
   * purchasable PDP (members see their real pricing instead). */
  clubUpsell?: ClubUpsell;
  /** Eyebrow of the fractal scarcity status row ("LIMITED ALLOCATION",
   * "BY REQUEST") — restricted / by-request / members-only states. The same
   * row slot shows `entitlementStatus` once personal facts exist. */
  scarcityStatus?: string;
  /** Public, offer-level cap beside the eyebrow ("LIMIT 6 PER CUSTOMER",
   * "LIMIT 2 REQUESTS PER CUSTOMER") — renders even signed out. */
  scarcityCap?: string;
  /** Designed sentence for the restricted / by-request states. */
  scarcityNote?: string;
  /** REQUEST TO PURCHASE destination — present in by-request when the site
   * supplied `requestHref` (interim link until the purchase-request API). */
  requestCta?: { label: string; href: string };
  canIncrement: boolean;
  canPurchase: boolean;
}

export interface PurchasePanelInput {
  variations: StorefrontProductVariation[];
  /** Product option axes (Color, Size…). Absent/empty → the flat format list. */
  options?: StorefrontProductOption[];
  selectedVariationId?: string;
  /** Which purchase model resolves the panel state. Default: retail. */
  lens?: PurchaseLens;
  /** Whether the visitor has an authenticated store session (allocation lens). */
  isAuthenticated?: boolean;
  /** Waiting-list destination for the allocation lens's members-only CTA. */
  waitingListHref?: string;
  pricing?: VariationPricing[] | null;
  availability?: VariationAvailability[] | null;
  memberships?: CustomerMembership[] | null;
  cartLines?: CartLine[];
  /** CMS fallback price label (e.g. "$52") when no storefront variation resolves. */
  fallbackPriceLabel?: string;
  /** Whether the page resolved an add-to-cart input for this product. An
   * affirmative `false` (no storefront product or sellable variation) is the
   * only thing that asserts the degraded state; omit when unknown. */
  hasCartProduct?: boolean;
  /** Remaining-quantity block from the last allocation_exceeded cart error (M5). */
  errorQuantityLimit?: QuantityLimit | null;
  /** Display noun for quantities, e.g. "bottle". */
  unitNoun?: string;
  /** Club-discount marketing teaser, shown to non-members on purchasable PDPs.
   * Pass only when the brand runs club discounts; the kit gates rendering. */
  clubUpsell?: ClubUpsell;
  /** Retail lens: an affirmative `true` means the availability read failed
   * (errored or returned an unparseable body), so there is no platform fact
   * about this visitor's permission. The panel fails closed into `degraded`
   * rather than fabricating purchasable for what may be a gated wine. Omit
   * while the read is in flight or when unknown. The allocation lens already
   * fails closed on missing data (members-only) and ignores this. */
  availabilityReadFailed?: boolean;
  /** @deprecated The platform now decides the entitlement gate: the
   * availability read reports `permission: 'restricted'` per variation, for
   * anonymous visitors too. Kept only while a site still sets it from CMS
   * data; remove once no consumer passes it.
   * Only `true` asserts the restricted state, and only when there is NO
   * availability row for the selected variation: any platform row (purchase,
   * request path, sold out, gate) owns the state — one owner per field. */
  restricted?: boolean;
  /** Public per-customer cap on the offer (a fact that exists signed out) —
   * drives the scarcity cap row in restricted / members-only states. */
  publicQuantityLimit?: number;
  /** Per-offer request cap (`maxWishlist`) — drives the by-request cap row. */
  requestCap?: number;
  /** Where REQUEST TO PURCHASE sends the customer until the purchase-request
   * API ships (e.g. the external store's offer page). Omitted → the by-request
   * state renders its facts without a CTA. */
  requestHref?: string;
}

// Scarcity-first copy (per the design state sheets): the gate is framed as
// scarcity ("limited", "select"), never membership mechanics.
export const MEMBERS_ONLY_NOTE = 'Reserved for select members. Sign in to check your availability.';
export const WAITING_LIST_CTA_LABEL = 'JOIN THE WAITING LIST';
export const DEFAULT_WAITING_LIST_HREF = '/waiting-list';
export const RESTRICTED_STATUS = 'LIMITED ALLOCATION';
export const RESTRICTED_NOTE = 'Reserved for select members. Sign in to check your availability.';
export const BY_REQUEST_STATUS = 'BY REQUEST';
export const BY_REQUEST_NOTE =
  'Available by request. Submit a request to purchase — many requests are approved immediately.';
export const REQUEST_CTA_LABEL = 'REQUEST TO PURCHASE';

export function resolveSelectedVariation(
  variations: StorefrontProductVariation[],
  selectedId?: string,
): StorefrontProductVariation | undefined {
  return (
    variations.find((variation) => variation.id === selectedId) ??
    variations.find((variation) => variation.isDefault) ??
    variations[0]
  );
}

/** The variation reached by choosing `optionValueId` for `optionId`: prefer
 * the variation matching the current selection with that one value swapped;
 * else the first variation (array order) carrying the value; else undefined
 * (the value has no variation — the caller keeps the current selection). */
export function resolveVariationForOptionValue(
  variations: StorefrontProductVariation[],
  selectedVariationId: string | undefined,
  optionId: string,
  optionValueId: string,
): StorefrontProductVariation | undefined {
  const selected = resolveSelectedVariation(variations, selectedVariationId);
  const target = swapOptionValue(selected, optionId, optionValueId);
  return (
    variations.find((variation) => matchesOptionSelection(variation, target)) ??
    variations.find((variation) => optionValueOf(variation, optionId) === optionValueId)
  );
}

export function formatVolume(volumeMl?: number | null): string {
  if (volumeMl == null || volumeMl <= 0) return '';
  if (volumeMl < 1000) return `${volumeMl} ML`;
  return `${trimNumber(volumeMl / 1000)} L`;
}

export function formatSavingsNote(savings: { amount: number; basisPoints: number }): string {
  return `You save ${formatUsdCents(savings.amount)} (${trimNumber(savings.basisPoints / 100)}%)`;
}

export function buildPurchasePanelView(input: PurchasePanelInput): PurchasePanelView {
  const lens = input.lens ?? 'retail';
  const unitNoun = input.unitNoun ?? 'bottle';
  const selected = resolveSelectedVariation(input.variations, input.selectedVariationId);
  const pricingById = new Map((input.pricing ?? []).map((entry) => [entry.variationId, entry]));
  const availabilityById = new Map(
    (input.availability ?? []).map((entry) => [entry.productVariationId, entry]),
  );

  const selectedPricing = selected ? pricingById.get(selected.id) : undefined;
  const selectedAvailability = selected ? availabilityById.get(selected.id) : undefined;
  const cartLine = selected
    ? input.cartLines?.find((line) => line.purchaseOptionId === selected.id)
    : undefined;

  const activeMembership = input.memberships?.find((membership) => membership.status === 'active');
  const memberBadge = activeMembership
    ? `SIGNED IN · ${activeMembership.clubName.toUpperCase()}`
    : undefined;
  const isMember = Boolean(input.isAuthenticated) && Boolean(activeMembership);

  const options = buildOptionViews(input.options, input.variations, selected);
  const formats =
    !options && input.variations.length > 1
      ? input.variations.map((variation) => buildFormatView(variation, pricingById))
      : undefined;

  const state =
    lens === 'allocation'
      ? resolveAllocationPanelState({
          cartLine,
          availability: selectedAvailability,
          // Distinguishes "the availability read returned data" from "it failed
          // or hasn't loaded": not-allocated is only ever asserted from
          // affirmative data.
          hasAvailabilityData: input.availability != null,
          hasCartProduct: input.hasCartProduct,
          isMember,
        })
      : resolveRetailPanelState({
          cartLine,
          availability: selectedAvailability,
          availabilityReadFailed: input.availabilityReadFailed,
          hasCartProduct: input.hasCartProduct,
          restricted: input.restricted,
        });
  const quantityCap = resolveQuantityCap(selectedAvailability, input.errorQuantityLimit);
  const cartQuantity = cartLine?.quantity ?? 0;

  const entitlementStatus =
    lens === 'allocation'
      ? (state === 'purchasable' || state === 'not-allocated') &&
        selectedAvailability?.quantityLimit
        ? formatEntitlementStatus(selectedAvailability.quantityLimit, unitNoun)
        : undefined
      : state === 'unavailable' && selectedAvailability?.quantityLimit
        ? formatEntitlementStatus(selectedAvailability.quantityLimit, unitNoun)
        : undefined;

  return {
    state,
    memberBadge,
    formats,
    options,
    selectedVariationId: selected?.id,
    summary: buildSummaryView({
      fallbackPriceLabel: input.fallbackPriceLabel,
      // Option groups are a variation selector too: the summary captions the
      // selected variation the same way it does for multi-format wines.
      hasFormats: Boolean(formats || options),
      pricing: selectedPricing,
      state,
      unitNoun,
      variation: selected,
    }),
    cartLine: cartLine ? { id: cartLine.id, quantity: cartLine.quantity } : undefined,
    cartNote: cartLine ? formatCartNote(cartLine.quantity, unitNoun) : undefined,
    entitlementStatus,
    grantName:
      lens === 'allocation' && (state === 'purchasable' || state === 'not-allocated')
        ? resolveGrantName(selectedAvailability)
        : undefined,
    unavailableNote:
      state === 'not-allocated'
        ? formatNotAllocatedNote(selectedAvailability)
        : state === 'unavailable'
          ? formatUnavailableNote(selectedAvailability)
          : undefined,
    membersOnlyNote: state === 'members-only' ? MEMBERS_ONLY_NOTE : undefined,
    // The upsell markets the club to visitors who aren't in it; an active
    // member sees their real promotion pricing instead, never the teaser.
    clubUpsell: state === 'purchasable' && !activeMembership ? input.clubUpsell : undefined,
    // The fractal scarcity status row: public, offer-level facts that render
    // even signed out; the same slot carries entitlementStatus once personal
    // facts exist. Members-only shares the restricted framing — on an
    // allocation store the whole catalog is one limited allocation.
    scarcityStatus:
      state === 'restricted' || state === 'members-only'
        ? RESTRICTED_STATUS
        : state === 'by-request'
          ? BY_REQUEST_STATUS
          : undefined,
    scarcityCap:
      state === 'restricted' || state === 'members-only'
        ? formatPublicCap(input.publicQuantityLimit)
        : state === 'by-request'
          ? formatRequestCap(input.requestCap)
          : undefined,
    scarcityNote:
      state === 'restricted'
        ? RESTRICTED_NOTE
        : state === 'by-request'
          ? BY_REQUEST_NOTE
          : undefined,
    requestCta:
      state === 'by-request' && input.requestHref
        ? { label: REQUEST_CTA_LABEL, href: input.requestHref }
        : undefined,
    waitingListCta:
      state === 'members-only'
        ? {
            label: WAITING_LIST_CTA_LABEL,
            href: input.waitingListHref ?? DEFAULT_WAITING_LIST_HREF,
          }
        : undefined,
    canIncrement: quantityCap === undefined || cartQuantity < quantityCap,
    canPurchase: state === 'purchasable' && hasPurchasablePrice(selected, input.fallbackPriceLabel),
  };
}

/** CMS-owned display seed for the cart line. The site resolves these from its
 * CMS alone (the join key + display name + image + editorial price); the island
 * fetches the storefront product client-side and merges the two into the
 * add-to-cart input. Keeping the seed CMS-only is what lets the PDP render
 * server-side with no storefront API read (RULES.md Rule 1). */
export interface CartProductSeed {
  /** Storefront product slug — the CMS-held join key the product is looked up by. */
  slug?: string;
  /** Cart-line title (CMS display name). */
  title: string;
  /** CMS image, used when the storefront product carries none. */
  imageUrl?: string;
  /** Editorial price in cents — the mock / fallback unit price. */
  fallbackUnitPriceCents?: number;
}

/** The variations + base cart input the island works from once the product
 * read resolves (live) or is synthesized (mock). */
export interface ResolvedCartProduct {
  variations: StorefrontProductVariation[];
  /** Product option axes; undefined for the mock (seed-only) resolution. */
  options?: StorefrontProductOption[];
  cartProduct: AddToCartInput | null;
}

/** Base add-to-cart input for a resolved storefront product, merging the CMS
 * display seed (title, image fallback) with the live product (ids, sku, price).
 * For a product with options the title carries the default variation's label
 * (see cartLineTitle). Null when the product has no purchasable default
 * variation — the panel then degrades. Mirrors the old per-site server
 * builder, now keyed off the seed. */
export function buildStorefrontCartProduct(
  seed: CartProductSeed,
  product: StorefrontProduct | null,
): AddToCartInput | null {
  const variation = product?.defaultVariation;
  if (!product || !variation || variation.price == null) return null;

  return {
    productId: product.slug,
    purchaseOptionId: variation.id,
    variantId: variation.id,
    sku: variation.sku,
    quantity: 1,
    display: {
      imageUrl: variation.imageUrl ?? product.imageUrl ?? seed.imageUrl,
      title: cartLineTitle(seed.title, variation),
      unitPrice: variation.price,
    },
  };
}

/** Mock add-to-cart input for dev / unconfigured commerce — synthesized from
 * the CMS seed alone (no live product). Mirrors the old per-site mock builder. */
export function buildMockCartProduct(seed: CartProductSeed): AddToCartInput | null {
  if (!seed.slug) return null;

  return {
    productId: seed.slug,
    purchaseOptionId: seed.slug,
    quantity: 1,
    display: {
      imageUrl: seed.imageUrl,
      title: seed.title,
      unitPrice: seed.fallbackUnitPriceCents,
    },
  };
}

// Variations in server-sorted order (array order is the contract); a lone
// default variation still yields a one-entry list so format/in-cart logic works.
function resolveProductVariations(product: StorefrontProduct | null): StorefrontProductVariation[] {
  if (!product) return [];
  if (product.variations.length > 0) return product.variations;
  return product.defaultVariation ? [product.defaultVariation] : [];
}

/** Resolve the panel's variations + base cart input from a fetched storefront
 * product (live) or, when commerce is unconfigured, synthesize a single mock
 * variation + cart input from the CMS seed so dev still gets a working
 * mock-adapter add-to-cart (with in-cart detection). Pure: all fetching stays
 * in the island shell. */
export function resolveCartProduct(
  seed: CartProductSeed,
  product: StorefrontProduct | null,
  options: { configured: boolean },
): ResolvedCartProduct {
  if (!options.configured) {
    const cartProduct = buildMockCartProduct(seed);
    return {
      cartProduct,
      variations: cartProduct
        ? [
            {
              id: cartProduct.purchaseOptionId ?? seed.slug ?? '',
              price: cartProduct.display?.unitPrice,
              unitName: 'Bottle',
            },
          ]
        : [],
    };
  }

  return {
    cartProduct: buildStorefrontCartProduct(seed, product),
    variations: resolveProductVariations(product),
    options: product?.options,
  };
}

/** Derives the add-to-cart input for the selected variation from the page's
 * base input (which carries the display block and product id). The base title
 * is composed for the *default* variation, so pass the bare product title (the
 * CMS seed title) to re-title the line for the selected variation of a product
 * with options; without it the base title is kept. */
export function buildSelectedCartInput(
  base: AddToCartInput,
  variation: StorefrontProductVariation,
  pricing?: VariationPricing,
  productTitle?: string,
): AddToCartInput {
  const unitPrice = pricing?.customerPrice ?? variation.price ?? base.display?.unitPrice;
  const title =
    productTitle === undefined ? base.display?.title : cartLineTitle(productTitle, variation);

  return {
    ...base,
    purchaseOptionId: variation.id,
    variantId: variation.id,
    sku: variation.sku ?? base.sku,
    display: { ...base.display, title, unitPrice },
  };
}

function buildFormatView(
  variation: StorefrontProductVariation,
  pricingById: Map<string, VariationPricing>,
): PurchaseFormatView {
  const pricing = pricingById.get(variation.id);
  const discounted = Boolean(pricing?.savings);
  const priceCents = pricing?.customerPrice ?? variation.price;

  return {
    id: variation.id,
    name: formatVariationName(variation),
    volume: formatVolume(variation.volumeMl),
    price: priceCents == null ? '' : formatUsdCents(priceCents),
    retailPrice: discounted && pricing ? formatUsdCents(pricing.retailPrice) : undefined,
  };
}

function formatVariationName(variation: StorefrontProductVariation): string {
  return (variationLabel(variation) ?? '').toUpperCase();
}

function hasOptionValues(variation: StorefrontProductVariation): boolean {
  return (variation.optionValues?.length ?? 0) > 0;
}

// Label precedence: unitName first — wines carry title "750" but unitName
// "750 mL bottle". Only an option variation (non-empty optionValues) falls
// back to the option-derived title ("Navy + Mesh"), then the explicit title;
// every other variation keeps the unitName-only label.
function variationLabel(variation: StorefrontProductVariation): string | undefined {
  return hasOptionValues(variation)
    ? (variation.unitName ?? variation.derivedTitle ?? variation.title)
    : variation.unitName;
}

// The platform's separator between a product name and an option variation's
// label in the composed line name (the platform's
// LINE_NAME_SEPARATOR): an em dash with spaces.
const LINE_NAME_SEPARATOR = ' \u2014 ';

// Optimistic cart-line title. A product with options gets its variation label
// appended ("Anniversary Logo Hat — Black"), byte for byte the
// platform's storedName, so the line says which one was added and does not
// change when the cart read returns; every other product keeps the bare
// product title, exactly as before (docs/storefront-api-pdp-modifications.md §M1a).
function cartLineTitle(productTitle: string, variation: StorefrontProductVariation): string {
  if (!hasOptionValues(variation)) return productTitle;
  const label = variationLabel(variation);
  return label ? `${productTitle}${LINE_NAME_SEPARATOR}${label}` : productTitle;
}

// Option groups for products with options; undefined when there are none so
// the flat format list stays the wine path.
function buildOptionViews(
  options: StorefrontProductOption[] | undefined,
  variations: StorefrontProductVariation[],
  selected: StorefrontProductVariation | undefined,
): PurchaseOptionView[] | undefined {
  if (!options || options.length === 0) return undefined;

  return sortByPosition(options).map((option) => ({
    id: option.id,
    name: option.name,
    values: sortByPosition(option.values).map((value) => ({
      id: value.id,
      label: value.value,
      selected: selected ? optionValueOf(selected, option.id) === value.id : false,
      available: variations.some((variation) => optionValueOf(variation, option.id) === value.id),
    })),
  }));
}

function sortByPosition<T extends { position: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.position - b.position);
}

function optionValueOf(
  variation: StorefrontProductVariation,
  optionId: string,
): string | undefined {
  return variation.optionValues?.find((entry) => entry.optionId === optionId)?.optionValueId;
}

// The selected variation's option values with one option's value replaced.
function swapOptionValue(
  selected: StorefrontProductVariation | undefined,
  optionId: string,
  optionValueId: string,
): Map<string, string> {
  const selection = new Map(
    (selected?.optionValues ?? []).map((entry) => [entry.optionId, entry.optionValueId]),
  );
  selection.set(optionId, optionValueId);
  return selection;
}

// A variation matches when its option values equal the selection exactly.
function matchesOptionSelection(
  variation: StorefrontProductVariation,
  selection: Map<string, string>,
): boolean {
  const values = variation.optionValues ?? [];
  return (
    values.length === selection.size &&
    values.every((entry) => selection.get(entry.optionId) === entry.optionValueId)
  );
}

// Retail ladder. The platform answers the availability read for every
// visitor (anonymous included) and it only ever blocks: a blocked variation
// resolves by-request when the request path is open (it outranks every dead
// end), restricted when the platform reports the entitlement gate, else
// unavailable (sold out, cap exhausted). Availability facts outrank the
// degraded wiring gap — they mean more to the customer than "this page
// couldn't build a cart input".
//
// Fail closed when availability is absent: if the read FAILED there is no
// platform fact about this visitor, and the wine may be gated — degrade
// (price visible, CTA disabled) rather than fabricate purchasable. While the
// read is in flight the island keeps the CTA disabled (pending), so the
// purchasable default below is only ever reached with no read at all (mock
// commerce, direct view-model builds) or with a loaded read that carries no
// row for this variation.
function resolveRetailPanelState(context: {
  cartLine?: CartLine;
  availability?: VariationAvailability;
  availabilityReadFailed?: boolean;
  hasCartProduct?: boolean;
  restricted?: boolean;
}): PurchasePanelState {
  if (context.cartLine) return 'in-cart';

  const availability = context.availability;
  if (availability && isBlocked(availability)) {
    if (availability.canAddToWishlist) return 'by-request';
    if (availability.permission === 'restricted') return 'restricted';
    return 'unavailable';
  }

  if (!availability) {
    // Deprecated site-supplied gate (see PurchasePanelInput.restricted).
    if (context.restricted) return 'restricted';
    if (context.availabilityReadFailed) return 'degraded';
  }

  if (context.hasCartProduct === false) return 'degraded';

  return 'purchasable';
}

// A variation this visitor can't add to the cart right now, for any reason.
function isBlocked(availability: VariationAvailability): boolean {
  return (
    !availability.canAddToCart ||
    availability.permission !== 'purchase' ||
    availability.quantityLimit?.available === 0
  );
}

// Allocation ladder: in-cart wins (the line is already held), then membership
// gates everything (members-only store), then the member's entitlement decides
// purchasable vs not-allocated. A member with no entitlement row in a LOADED
// availability response is not-allocated — there are no universal grants on an
// allocation store. But when the availability read failed (or hasn't arrived),
// we have no affirmative entitlement fact: asserting "Not in your current
// allocation" would be fabricating one, so degrade to members-only instead.
function resolveAllocationPanelState(context: {
  cartLine?: CartLine;
  availability?: VariationAvailability;
  hasAvailabilityData: boolean;
  hasCartProduct?: boolean;
  isMember: boolean;
}): PurchasePanelState {
  if (context.cartLine) return 'in-cart';
  if (!context.isMember) return 'members-only';
  if (!context.hasAvailabilityData) return 'members-only';

  const availability = context.availability;
  if (!availability || isBlocked(availability)) {
    // An open request path outranks the not-allocated dead end (platform
    // wishlist = request to purchase, possibly approved immediately).
    if (availability?.canAddToWishlist) return 'by-request';
    return 'not-allocated';
  }

  // An allocated member the page couldn't wire an add-to-cart input for:
  // entitlement facts above mean more, so degraded is the last gate before
  // purchasable.
  if (context.hasCartProduct === false) return 'degraded';

  return 'purchasable';
}

// The availability read's `available` is the customer's remaining purchasable
// quantity; an exceeds_limit cart error refreshes it with the server's latest.
function resolveQuantityCap(
  availability?: VariationAvailability,
  errorQuantityLimit?: QuantityLimit | null,
): number | undefined {
  return errorQuantityLimit?.available ?? availability?.quantityLimit?.available ?? undefined;
}

function buildSummaryView(context: {
  fallbackPriceLabel?: string;
  hasFormats: boolean;
  pricing?: VariationPricing;
  state: PurchasePanelState;
  unitNoun: string;
  variation?: StorefrontProductVariation;
}): PurchaseSummaryView {
  const { fallbackPriceLabel, hasFormats, pricing, state, unitNoun, variation } = context;
  const retailCents = pricing?.retailPrice ?? variation?.price;
  const discounted = Boolean(pricing?.savings);
  const priceCents = pricing?.customerPrice ?? variation?.price;
  const price = priceCents == null ? (fallbackPriceLabel ?? '') : formatUsdCents(priceCents);
  const caption =
    hasFormats && variation
      ? [formatVariationName(variation), formatVolume(variation.volumeMl)]
          .filter(Boolean)
          .join(' · ')
      : undefined;

  if (discounted && pricing) {
    return {
      layout: hasFormats ? 'member-stacked' : 'member-inline',
      price,
      retailPrice: retailCents == null ? undefined : formatUsdCents(retailCents),
      caption,
      savingsNote: pricing.savings ? formatSavingsNote(pricing.savings) : undefined,
      promotionName: pricing.appliedPromotions[0]?.name,
    };
  }

  if (state === 'in-cart' && !hasFormats) {
    return { layout: 'unit', price, unit: `/ ${unitNoun}` };
  }

  return { layout: 'simple', price, caption };
}

function hasPurchasablePrice(
  variation: StorefrontProductVariation | undefined,
  fallbackPriceLabel?: string,
): boolean {
  return variation?.price != null || Boolean(fallbackPriceLabel);
}

function formatCartNote(quantity: number, unitNoun: string): string {
  return `${quantity} ${pluralize(unitNoun, quantity)} in your cart`;
}

function formatEntitlementStatus(quantityLimit: QuantityLimit, unitNoun: string): string {
  return `${quantityLimit.available} OF ${quantityLimit.limit} ${pluralize(unitNoun, quantityLimit.limit).toUpperCase()} REMAINING`;
}

// Public, offer-level caps — the signed-out half of the fractal status row.
function formatPublicCap(limit: number | undefined): string | undefined {
  if (limit == null) return undefined;
  return `LIMIT ${limit} PER CUSTOMER`;
}

function formatRequestCap(cap: number | undefined): string | undefined {
  if (cap == null) return undefined;
  return `LIMIT ${cap} ${cap === 1 ? 'REQUEST' : 'REQUESTS'} PER CUSTOMER`;
}

// "universal" is the platform's system name for ungranted public
// availability, not a release name — never render it as display copy.
function resolveGrantName(availability?: VariationAvailability): string | undefined {
  const grantName = availability?.grantContext?.name;
  return grantName && grantName !== 'universal' ? grantName : undefined;
}

function formatNotAllocatedNote(availability?: VariationAvailability): string {
  const grantName = resolveGrantName(availability);
  return grantName
    ? `You've reached your allocation limit for the ${grantName}.`
    : 'Not in your current allocation';
}

// The mock's waitlist sentence is deferred with the waitlist CTA — see
// winery-kit/docs/storefront-api-pdp-modifications.md §4.
function formatUnavailableNote(availability?: VariationAvailability): string {
  const grantName = resolveGrantName(availability);
  return grantName
    ? `You've reached your allocation limit for the ${grantName}.`
    : 'This wine is not currently available for purchase.';
}

function pluralize(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`;
}

function trimNumber(value: number): string {
  return String(Number(value.toFixed(2)));
}
