// PurchasePanel — the pre-assembled PDP commerce surface for winery sites
// (tier 1 of the compound API).
//
// This is <PurchasePanel.Root> plus the compound parts arranged into the
// shared band structure: price block on the left, action cluster on the
// right (stepper + VIEW CART when in cart, the add-to-cart CTA when
// purchasable). Every visual decision — color, type, radius, padding — is
// injected by the site through the `classes` slot map. Sites that need a
// different *structure* compose Root and the parts directly instead
// (purchase-panel-parts.tsx); both tiers share the same behavior path.
import type { AlternativeCandidate, CartProductSeed, PurchaseLens } from '@pretty-good/storefront-kit/pdp';
import type { StorefrontApiConfig } from '@pretty-good/storefront-kit/storefront-api';
import { PurchasePanelRoot, usePurchasePanelContext } from './purchase-panel-context.js';
import {
  AddToCart,
  CartNote,
  ClubUpsellCta,
  ClubUpsellLabel,
  ClubUpsellNote,
  ClubUpsellPrice,
  FormatSelector,
  MemberBadge,
  MembersOnlyNote,
  OptionSelector,
  RequestCta,
  ScarcityCap,
  ScarcityNote,
  ScarcityStatus,
  Stepper,
  Summary,
  UnavailableNote,
  ViewCart,
  WaitingListCta,
} from './purchase-panel-parts.js';

/** Visual slot map — every key is a className string supplied by the site. */
export interface PurchasePanelClasses {
  /** Outer wrapper around every state. */
  root?: string;
  /** The band that carries the price block + action cluster (the mock's white surface). */
  band?: string;
  /** Optional per-state overrides — fall back to `band`/`controls`/`buttonPrimary`. */
  purchasableBand?: string;
  purchasableControls?: string;
  buttonAdd?: string;
  /** Left column of the band: price + cart note. */
  priceBlock?: string;
  priceRow?: string;
  priceAmount?: string;
  /** "/ bottle" beside the price. */
  priceUnit?: string;
  /** Caption under the price (multi-format selected variation). */
  priceCaption?: string;
  /** "YOUR PRICE" eyebrow for member pricing. */
  priceLabel?: string;
  retailPrice?: string;
  savingsNote?: string;
  memberBadge?: string;
  /** "✓ N bottles in your cart" row. */
  cartNote?: string;
  cartNoteIcon?: string;
  /** Right cluster of the band (stepper + button / CTA). */
  controls?: string;
  stepper?: string;
  stepperButton?: string;
  stepperValue?: string;
  stepperDivider?: string;
  buttonPrimary?: string;
  buttonOutline?: string;
  formats?: string;
  formatsLabel?: string;
  formatCard?: string;
  formatCardSelected?: string;
  formatName?: string;
  formatVolume?: string;
  formatPrice?: string;
  formatRetail?: string;
  /** Option groups (Color, Size…) for products with options — they replace
   * the format cards. `optionsLabel` set → each option's name renders as a
   * heading. */
  options?: string;
  optionsOption?: string;
  optionsLabel?: string;
  optionsGroup?: string;
  optionValue?: string;
  optionValueSelected?: string;
  optionValueUnavailable?: string;
  optionValueName?: string;
  unavailablePrice?: string;
  unavailableNote?: string;
  entitlementRow?: string;
  entitlementLabel?: string;
  entitlementValue?: string;
  membersOnlyNote?: string;
  /** Club-discount upsell (non-members, purchasable state): label+price row
   * (primary presentation) and/or note+cta teaser (secondary presentation). */
  clubUpsellRow?: string;
  clubUpsellLabel?: string;
  clubUpsellPrice?: string;
  clubUpsellNote?: string;
  clubUpsellCta?: string;
  /** Fractal scarcity status row (restricted / by-request / members-only). */
  scarcityRow?: string;
  scarcityStatus?: string;
  scarcityCap?: string;
  scarcityNote?: string;
  /** REQUEST TO PURCHASE anchor (by-request state). */
  buttonRequest?: string;
}

export interface PurchasePanelProps {
  /** Public Storefront API config used by hydrated purchase islands for
   * browser-side product and purchase-context reads. */
  storefrontApi?: StorefrontApiConfig;
  /** CMS join key — the slug the island fetches the product + pricing from. */
  slug?: string;
  /** CMS-owned cart-line display seed (title, image, editorial price). */
  cartSeed: CartProductSeed;
  fallbackPriceLabel?: string;
  unitNoun?: string;
  lens?: PurchaseLens;
  waitingListHref?: string;
  /** Recovery suggestions when this wine can't be purchased. The island verifies
   * each is itself sellable before offering it (the rendered link is the
   * context-verified `alternative`). */
  alternativeCandidates?: AlternativeCandidate[];
  /** Copy overrides (the add-to-cart label set comes from the hook). */
  viewCartLabel?: string;
  allocationLabel?: string;
  classes?: PurchasePanelClasses;
}

export function PurchasePanel({
  storefrontApi,
  slug,
  cartSeed,
  fallbackPriceLabel,
  unitNoun = 'bottle',
  lens = 'retail',
  waitingListHref,
  alternativeCandidates,
  viewCartLabel = 'VIEW CART →',
  allocationLabel = 'ALLOCATION',
  classes: c = {},
}: PurchasePanelProps) {
  return (
    <PurchasePanelRoot
      storefrontApi={storefrontApi}
      slug={slug}
      cartSeed={cartSeed}
      fallbackPriceLabel={fallbackPriceLabel}
      unitNoun={unitNoun}
      lens={lens}
      waitingListHref={waitingListHref}
      alternativeCandidates={alternativeCandidates}
      className={c.root}
    >
      <PanelBody viewCartLabel={viewCartLabel} allocationLabel={allocationLabel} classes={c} />
    </PurchasePanelRoot>
  );
}

// Status eyebrow + public cap, gated as one row so empty states add no markup.
function ScarcityRow({ classes: c }: { classes: PurchasePanelClasses }) {
  const { view } = usePurchasePanelContext();
  if (!view.scarcityStatus && !view.scarcityCap) return null;
  return (
    <div className={c.scarcityRow}>
      <ScarcityStatus className={c.scarcityStatus} />
      <ScarcityCap className={c.scarcityCap} />
    </div>
  );
}

function PanelBody({
  viewCartLabel,
  allocationLabel,
  classes: c,
}: {
  viewCartLabel: string;
  allocationLabel: string;
  classes: PurchasePanelClasses;
}) {
  // The verified recovery suggestion comes from the panel context (the island
  // confirms a candidate is sellable before it appears).
  const { view, addInput, alternative } = usePurchasePanelContext();

  const summaryClasses = {
    caption: c.priceCaption,
    row: c.priceRow,
    label: c.priceLabel,
    price: c.priceAmount,
    unit: c.priceUnit,
    retailPrice: c.retailPrice,
    savingsNote: c.savingsNote,
  };

  return (
    <>
      <MemberBadge className={c.memberBadge} />

      {view.entitlementStatus && (
        <div className={c.entitlementRow}>
          <span className={c.entitlementLabel}>{allocationLabel}</span>
          <span className={c.entitlementValue}>{view.entitlementStatus}</span>
        </div>
      )}

      <FormatSelector
        label={c.formatsLabel !== undefined ? 'FORMAT' : undefined}
        classes={{
          root: c.formats,
          label: c.formatsLabel,
          card: c.formatCard,
          cardSelected: c.formatCardSelected,
          name: c.formatName,
          volume: c.formatVolume,
          price: c.formatPrice,
          retail: c.formatRetail,
        }}
      />

      <OptionSelector
        showLabels={c.optionsLabel !== undefined}
        classes={{
          root: c.options,
          option: c.optionsOption,
          label: c.optionsLabel,
          group: c.optionsGroup,
          value: c.optionValue,
          valueSelected: c.optionValueSelected,
          valueUnavailable: c.optionValueUnavailable,
          name: c.optionValueName,
        }}
      />

      {(view.state === 'purchasable' || view.state === 'degraded') && (
        <div className={c.purchasableBand ?? c.band}>
          <div className={c.priceBlock}>
            <Summary classes={summaryClasses} />
            {(view.clubUpsell?.label || view.clubUpsell?.price) && (
              <div className={c.clubUpsellRow}>
                <ClubUpsellLabel className={c.clubUpsellLabel} />
                <ClubUpsellPrice className={c.clubUpsellPrice} />
              </div>
            )}
            <ClubUpsellNote className={c.clubUpsellNote} />
            <ClubUpsellCta className={c.clubUpsellCta} />
          </div>
          <div className={c.purchasableControls ?? c.controls}>
            {alternative && (!addInput || !view.canPurchase) && (
              <a href={alternative.href} className={c.buttonOutline}>
                {alternative.label} →
              </a>
            )}
            <AddToCart className={c.buttonAdd ?? c.buttonPrimary} />
          </div>
        </div>
      )}

      {view.state === 'in-cart' && (
        <div className={c.band}>
          <div className={c.priceBlock}>
            <Summary classes={summaryClasses} />
            <CartNote className={c.cartNote} iconClassName={c.cartNoteIcon} />
          </div>
          <div className={c.controls}>
            <Stepper
              classes={{
                root: c.stepper,
                button: c.stepperButton,
                value: c.stepperValue,
                divider: c.stepperDivider,
              }}
            />
            <ViewCart className={c.buttonPrimary}>{viewCartLabel}</ViewCart>
          </div>
        </div>
      )}

      {(view.state === 'unavailable' || view.state === 'not-allocated') && (
        <div className={c.band}>
          <div className={c.priceBlock}>
            <p className={c.unavailablePrice}>{view.summary.price}</p>
            <UnavailableNote className={c.unavailableNote} />
          </div>
          {alternative && (
            <div className={c.controls}>
              <a href={alternative.href} className={c.buttonOutline}>
                {alternative.label} →
              </a>
            </div>
          )}
        </div>
      )}

      {view.state === 'members-only' && (
        <div className={c.band}>
          <div className={c.priceBlock}>
            <ScarcityRow classes={c} />
            <Summary classes={summaryClasses} />
            <MembersOnlyNote className={c.membersOnlyNote} />
          </div>
          <div className={c.controls}>
            <WaitingListCta className={c.buttonOutline} />
          </div>
        </div>
      )}

      {/* Restricted: gate facts + scarcity copy; the sign-in / join CTAs need
          brand routes, so the slot-map tier renders facts only — compose the
          parts directly for the full designed render. */}
      {(view.state === 'restricted' || view.state === 'by-request') && (
        <div className={c.band}>
          <div className={c.priceBlock}>
            <ScarcityRow classes={c} />
            <Summary classes={summaryClasses} />
            <ScarcityNote className={c.scarcityNote} />
          </div>
          {view.requestCta && (
            <div className={c.controls}>
              <RequestCta className={c.buttonRequest ?? c.buttonPrimary} />
            </div>
          )}
        </div>
      )}
    </>
  );
}
