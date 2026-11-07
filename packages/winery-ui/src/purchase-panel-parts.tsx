// Compound parts of the purchase panel. Each part reads the nearest
// <PurchasePanel.Root> context, renders nothing when its datum is absent,
// and owns its behavior (handlers, disabled logic, aria). Brands control
// placement, element type (`as`), and styling (`className`) — never the
// wiring: every string a part renders was pre-formatted by the kit's view
// model, so pricing and entitlement policy cannot be re-derived in brand code.
import type { ElementType, ReactNode } from 'react';
import type {
  PurchaseFormatView,
  PurchaseOptionValueView,
  PurchaseOptionView,
} from '@pretty-good/storefront-kit/pdp';
import { usePurchasePanelContext } from './purchase-panel-context.js';

interface TextPartProps {
  className?: string;
  /** Rendered element. Each part has a sensible inline/block default. */
  as?: ElementType;
}

/** The customer's price for the selected variation (member price when the
 * pricing preview applied a promotion, retail otherwise). */
export function Price({ className, as: Tag = 'span' }: TextPartProps) {
  const { view } = usePurchasePanelContext();
  return <Tag className={className}>{view.summary.price}</Tag>;
}

/** Struck-through retail price — present only when a promotion discounted
 * the customer price. Pair with `line-through` styling. */
export function RetailPrice({ className, as: Tag = 'span' }: TextPartProps) {
  const { view } = usePurchasePanelContext();
  if (!view.summary.retailPrice) return null;
  return <Tag className={className}>{view.summary.retailPrice}</Tag>;
}

/** "/ bottle" beside the price (in-cart, single format). */
export function PriceUnit({ className, as: Tag = 'span' }: TextPartProps) {
  const { view } = usePurchasePanelContext();
  if (!view.summary.unit) return null;
  return <Tag className={className}>{view.summary.unit}</Tag>;
}

/** Selected-format caption ("BOTTLE · 750 ML") — multi-format wines only. */
export function PriceCaption({ className, as: Tag = 'p' }: TextPartProps) {
  const { view } = usePurchasePanelContext();
  if (!view.summary.caption) return null;
  return <Tag className={className}>{view.summary.caption}</Tag>;
}

/** "YOUR PRICE" eyebrow — renders only when member pricing applied. */
export function PriceLabel({
  className,
  as: Tag = 'span',
  children = 'YOUR PRICE',
}: TextPartProps & { children?: ReactNode }) {
  const { view } = usePurchasePanelContext();
  const layout = view.summary.layout;
  if (layout !== 'member-inline' && layout !== 'member-stacked') return null;
  return <Tag className={className}>{children}</Tag>;
}

/** Server-computed savings note ("You save $6.50 (12.5%)"). */
export function SavingsNote({ className, as: Tag = 'p' }: TextPartProps) {
  const { view } = usePurchasePanelContext();
  if (!view.summary.savingsNote) return null;
  return <Tag className={className}>{view.summary.savingsNote}</Tag>;
}

/** "SIGNED IN · CLUB NAME" badge for active members. */
export function MemberBadge({ className, as: Tag = 'p' }: TextPartProps) {
  const { view } = usePurchasePanelContext();
  if (!view.memberBadge) return null;
  return <Tag className={className}>{view.memberBadge}</Tag>;
}

/** "N OF M BOTTLES REMAINING" entitlement counter (allocation lens). */
export function EntitlementStatus({ className, as: Tag = 'p' }: TextPartProps) {
  const { view } = usePurchasePanelContext();
  if (!view.entitlementStatus) return null;
  return <Tag className={className}>{view.entitlementStatus}</Tag>;
}

/** Release/grant name behind the entitlement (never the system "universal"). */
export function GrantName({ className, as: Tag = 'p' }: TextPartProps) {
  const { view } = usePurchasePanelContext();
  if (!view.grantName) return null;
  return <Tag className={className}>{view.grantName}</Tag>;
}

/** Unavailable / not-allocated explanation copy. */
export function UnavailableNote({ className, as: Tag = 'p' }: TextPartProps) {
  const { view } = usePurchasePanelContext();
  if (!view.unavailableNote) return null;
  return <Tag className={className}>{view.unavailableNote}</Tag>;
}

/** "Available to members" status copy (allocation lens, members-only state). */
export function MembersOnlyNote({ className, as: Tag = 'p' }: TextPartProps) {
  const { view } = usePurchasePanelContext();
  if (!view.membersOnlyNote) return null;
  return <Tag className={className}>{view.membersOnlyNote}</Tag>;
}

/* Fractal scarcity status-row parts — restricted / by-request / members-only.
 * The eyebrow + public cap are offer-level facts that render even signed out;
 * once personal facts exist the same row slot shows EntitlementStatus. */

/** Status eyebrow ("LIMITED ALLOCATION", "BY REQUEST"). */
export function ScarcityStatus({ className, as: Tag = 'span' }: TextPartProps) {
  const { view } = usePurchasePanelContext();
  if (!view.scarcityStatus) return null;
  return <Tag className={className}>{view.scarcityStatus}</Tag>;
}

/** Public per-customer cap ("LIMIT 6 PER CUSTOMER", "LIMIT 2 REQUESTS PER CUSTOMER"). */
export function ScarcityCap({ className, as: Tag = 'span' }: TextPartProps) {
  const { view } = usePurchasePanelContext();
  if (!view.scarcityCap) return null;
  return <Tag className={className}>{view.scarcityCap}</Tag>;
}

/** Designed sentence for the restricted / by-request states. */
export function ScarcityNote({ className, as: Tag = 'p' }: TextPartProps) {
  const { view } = usePurchasePanelContext();
  if (!view.scarcityNote) return null;
  return <Tag className={className}>{view.scarcityNote}</Tag>;
}

/** REQUEST TO PURCHASE — the by-request primary action. Renders only when the
 * site supplied a destination (interim link until the purchase-request API);
 * label comes from the kit. */
export function RequestCta({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const { view } = usePurchasePanelContext();
  if (!view.requestCta) return null;
  return (
    <a href={view.requestCta.href} className={className}>
      {children ?? view.requestCta.label}
    </a>
  );
}

/* Club-discount upsell parts — marketing the club to non-members on a
 * purchasable PDP. The view model owns the gating (purchasable state, no
 * active membership); each part renders only when its site-supplied,
 * pre-formatted datum exists. Brands choose the presentation: compose
 * ClubUpsellLabel + ClubUpsellPrice as a primary price-row element, or
 * ClubUpsellNote + ClubUpsellCta as a secondary caption teaser. */

/** Eyebrow beside the club price (e.g. "CLUB PRICE:"). */
export function ClubUpsellLabel({ className, as: Tag = 'span' }: TextPartProps) {
  const { view } = usePurchasePanelContext();
  if (!view.clubUpsell?.label) return null;
  return <Tag className={className}>{view.clubUpsell.label}</Tag>;
}

/** Pre-formatted club price (e.g. "$41.60") for primary presentations. */
export function ClubUpsellPrice({ className, as: Tag = 'span' }: TextPartProps) {
  const { view } = usePurchasePanelContext();
  if (!view.clubUpsell?.price) return null;
  return <Tag className={className}>{view.clubUpsell.price}</Tag>;
}

/** Prose teaser (e.g. "Cellar Club members pay $58.50 (save 10%)"). */
export function ClubUpsellNote({ className, as: Tag = 'p' }: TextPartProps) {
  const { view } = usePurchasePanelContext();
  if (!view.clubUpsell?.note) return null;
  return <Tag className={className}>{view.clubUpsell.note}</Tag>;
}

/** Club-page link (e.g. "JOIN THE WINE CLUB →") — marketing, never a purchase CTA. */
export function ClubUpsellCta({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const { view } = usePurchasePanelContext();
  if (!view.clubUpsell?.cta) return null;
  return (
    <a href={view.clubUpsell.cta.href} className={className}>
      {children ?? view.clubUpsell.cta.label}
    </a>
  );
}

/** "✓ N bottles in your cart" confirmation row. */
export function CartNote({
  className,
  iconClassName,
  icon,
}: {
  className?: string;
  iconClassName?: string;
  /** Replaces the default check icon; pass null to render text only. */
  icon?: ReactNode;
}) {
  const { view } = usePurchasePanelContext();
  if (!view.cartNote) return null;
  return (
    <p className={className}>
      {icon === undefined ? <CheckIcon className={iconClassName} /> : icon}
      {view.cartNote}
    </p>
  );
}

/** Waiting-list anchor — renders only in the members-only state, and is
 * never an enabled purchase CTA. */
export function WaitingListCta({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const { view } = usePurchasePanelContext();
  if (!view.waitingListCta) return null;
  return (
    <a href={view.waitingListCta.href} className={className}>
      {children ?? view.waitingListCta.label}
    </a>
  );
}

/** The add-to-cart CTA. Disabled state and label (ADD TO CART / ADDING /
 * ADDED / TRY AGAIN / UNAVAILABLE) come from the kit — children only
 * override static label styling, not lifecycle copy; prefer the default. */
export function AddToCart({ className, children }: { className?: string; children?: ReactNode }) {
  const { addLabel, addDisabled, submitAddToCart } = usePurchasePanelContext();
  return (
    <button type="button" className={className} disabled={addDisabled} onClick={submitAddToCart}>
      {children ?? addLabel}
    </button>
  );
}

/** Opens the cart sidebar. */
export function ViewCart({
  className,
  children = 'VIEW CART →',
}: {
  className?: string;
  children?: ReactNode;
}) {
  const { openSidebar } = usePurchasePanelContext();
  return (
    <button type="button" className={className} onClick={openSidebar}>
      {children}
    </button>
  );
}

export interface StepperClasses {
  root?: string;
  button?: string;
  value?: string;
  divider?: string;
}

/** Quantity stepper for the carted line. Renders only when a cart line
 * exists; increments are clamped by the entitlement cap (canIncrement). */
export function Stepper({ classes: c = {} }: { classes?: StepperClasses }) {
  const { view, setCartQuantity, unitNoun } = usePurchasePanelContext();
  const cartLine = view.cartLine;
  if (!cartLine) return null;

  return (
    <div className={c.root}>
      <button
        type="button"
        data-stepper-action="decrement"
        aria-label={`Decrease ${unitNoun}`}
        className={c.button}
        onClick={() => void setCartQuantity(cartLine.quantity - 1)}
      >
        −
      </button>
      <span className={c.divider} role="presentation" />
      <span aria-live="polite" className={c.value}>
        {cartLine.quantity}
      </span>
      <span className={c.divider} role="presentation" />
      <button
        type="button"
        data-stepper-action="increment"
        aria-label={`Increase ${unitNoun}`}
        className={c.button}
        disabled={!view.canIncrement}
        onClick={() => void setCartQuantity(cartLine.quantity + 1)}
      >
        +
      </button>
    </div>
  );
}

export interface FormatSelectorClasses {
  root?: string;
  label?: string;
  /** Card layout container. Omitted → `display: contents`, so cards lay out
   * directly in `root` alongside the label. */
  group?: string;
  card?: string;
  cardSelected?: string;
  name?: string;
  volume?: string;
  price?: string;
  retail?: string;
}

export interface FormatCardContext {
  format: PurchaseFormatView;
  selected: boolean;
  select: () => void;
}

/** Format (variation) radio group. Renders only for multi-format wines.
 * Selection always routes through the kit's selectFormat so pricing,
 * availability, and cart-line matching follow the chosen variation. */
export function FormatSelector({
  label,
  classes: c = {},
  renderFormat,
}: {
  /** Heading above the cards; omitted → no heading element. */
  label?: ReactNode;
  classes?: FormatSelectorClasses;
  /** Full-custom card body. The radio button shell (role, aria-checked,
   * data-format-id, onClick) stays owned by the part. */
  renderFormat?: (context: FormatCardContext) => ReactNode;
}) {
  const { view, selectFormat } = usePurchasePanelContext();
  const formats = view.formats;
  if (!formats || formats.length === 0) return null;

  return (
    <div className={c.root}>
      {label != null && <p className={c.label}>{label}</p>}
      <div
        role="radiogroup"
        aria-label="FORMAT"
        className={c.group}
        style={c.group === undefined ? { display: 'contents' } : undefined}
      >
        {formats.map((format) => {
          const selected = format.id === view.selectedVariationId;
          return (
            <button
              key={format.id}
              type="button"
              role="radio"
              aria-checked={selected}
              data-format-id={format.id}
              onClick={() => selectFormat(format.id)}
              className={selected ? c.cardSelected : c.card}
            >
              {renderFormat ? (
                renderFormat({ format, selected, select: () => selectFormat(format.id) })
              ) : (
                <>
                  <span className={c.name}>{format.name}</span>
                  <span className={c.volume}>{format.volume}</span>
                  <span className={c.price}>{format.price}</span>
                  {format.retailPrice && <span className={c.retail}>{format.retailPrice}</span>}
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface OptionSelectorClasses {
  root?: string;
  /** Wrapper around one option (its heading + value group). */
  option?: string;
  /** Per-option heading showing the option name (e.g. "COLOR"). */
  label?: string;
  /** Value layout container. Omitted → `display: contents`, so values lay
   * out directly in `option` alongside the heading. */
  group?: string;
  value?: string;
  valueSelected?: string;
  /** Applied (instead of `value`) to values no variation carries; those
   * buttons are also disabled. */
  valueUnavailable?: string;
  /** Value label text inside the default body. */
  name?: string;
}

export interface OptionValueContext {
  option: PurchaseOptionView;
  value: PurchaseOptionValueView;
  select: () => void;
}

/** Product option radio groups (Color, Size…), one per option. Renders only
 * when the product has options — it replaces FormatSelector for those
 * products (the view model leaves `formats` undefined). Selection always
 * routes through the kit's selectOptionValue, which lands on a real
 * variation so pricing, availability, and cart-line matching follow it.
 * Every value some variation carries is enabled — on a partial grid a click
 * may change the other options too (the resolver's fallback). */
export function OptionSelector({
  showLabels = false,
  classes: c = {},
  renderValue,
}: {
  /** Render each option's name as a heading above its values. */
  showLabels?: boolean;
  classes?: OptionSelectorClasses;
  /** Full-custom value body. The radio button shell (role, aria-checked,
   * data-option-id, data-option-value-id, disabled, onClick) stays owned by
   * the part. */
  renderValue?: (context: OptionValueContext) => ReactNode;
}) {
  const { view, selectOptionValue } = usePurchasePanelContext();
  const options = view.options;
  if (!options || options.length === 0) return null;

  return (
    <div className={c.root}>
      {options.map((option) => (
        <div key={option.id} className={c.option}>
          {showLabels && <p className={c.label}>{option.name}</p>}
          <div
            role="radiogroup"
            aria-label={option.name}
            className={c.group}
            style={c.group === undefined ? { display: 'contents' } : undefined}
          >
            {option.values.map((value) => {
              const select = () => selectOptionValue(option.id, value.id);
              return (
                <button
                  key={value.id}
                  type="button"
                  role="radio"
                  aria-checked={value.selected}
                  data-option-id={option.id}
                  data-option-value-id={value.id}
                  disabled={!value.available}
                  onClick={select}
                  className={
                    value.selected
                      ? c.valueSelected
                      : value.available
                        ? c.value
                        : (c.valueUnavailable ?? c.value)
                  }
                >
                  {renderValue ? (
                    renderValue({ option, value, select })
                  ) : (
                    <span className={c.name}>{value.label}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface SummaryClasses {
  root?: string;
  caption?: string;
  row?: string;
  label?: string;
  price?: string;
  unit?: string;
  retailPrice?: string;
  savingsNote?: string;
}

/** The four price-summary layouts (simple / unit / member-inline /
 * member-stacked) pre-resolved by the view model, as one part. Compose the
 * leaf parts instead when a brand needs a different structure. */
export function Summary({ classes: c = {} }: { classes?: SummaryClasses }) {
  const { view } = usePurchasePanelContext();
  const { layout = 'simple', caption, savingsNote } = view.summary;
  const isMember = layout === 'member-inline' || layout === 'member-stacked';

  return (
    <div className={c.root}>
      {layout === 'member-stacked' && caption && <p className={c.caption}>{caption}</p>}
      <div className={c.row}>
        {isMember && <PriceLabel className={c.label} />}
        <Price className={c.price} />
        <PriceUnit className={c.unit} />
        {isMember && <RetailPrice className={c.retailPrice} />}
      </div>
      {layout === 'simple' && caption && <p className={c.caption}>{caption}</p>}
      {savingsNote && <p className={c.savingsNote}>{savingsNote}</p>}
    </div>
  );
}

export function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
