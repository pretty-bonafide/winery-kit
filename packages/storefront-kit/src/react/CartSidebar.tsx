import { useEffect, useId, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import type {
  CartCurrency,
  CartLine,
  CartLineView,
  CartPromotionView,
} from '../cart/cart-types';
import { formatUsdCents } from '../money';
import { useCartSidebar } from './use-cart-sidebar';

/**
 * Visual treatment for the cart sidebar, supplied by the host site. The
 * component is Tailwind-agnostic: it sets these values as `--pgc-*` CSS custom
 * properties on its root and styles itself from them, so each site maps its own
 * design tokens (which use disjoint class vocabularies) into one shared shell.
 */
export interface CartSidebarTheme {
  colors: {
    /** Sheet + card background. */
    surface: string;
    /** Image well background. */
    surfaceWarm: string;
    /** 1px hairline rules and borders. */
    border: string;
    textPrimary: string;
    textSecondary: string;
    /** Mid grey — eyebrow, savings, wishlist counts, format badge. */
    textMuted: string;
    /** Faint grey — "Line total" label, struck list price, empty totals. */
    textFaint: string;
    /** Primary button background. */
    accent: string;
    /** Primary button label. */
    accentText: string;
    /** Heart / by-request / discount accent (e.g. burgundy). */
    wishlist: string;
    /** ~20% tint of `wishlist` — heart cell + tag backgrounds. */
    wishlistTint: string;
    /** Neutral stock-badge background (e.g. black at ~8%). */
    badgeNeutralBg: string;
  };
  fonts: {
    /** Display role — prices, totals, sheet title. */
    display: string;
    /** Body role — names, labels, controls. */
    body: string;
  };
  /** Corner radius in px. Default 0. */
  radius?: number;
  /** Render the per-line image well. Default true (set false for image-less sites). */
  showLineImages?: boolean;
}

/** Props for the connected `CartSidebar` (drives itself from the cart store). */
export interface CartSidebarProps {
  theme: CartSidebarTheme;
  /** Small eyebrow above the title, e.g. the winery name. */
  brandEyebrow?: string;
  title?: string;
  emptyMessage?: string;
  browseHref?: string;
  browseLabel?: string;
  /** Cart-level (order) promotions — a threshold nudge while unmet and a savings
   * line once applied. Empty/omitted renders nothing. When omitted, the
   * connected sidebar uses promotions normalized onto `cart.promotions`. */
  promotions?: CartPromotionView[];
  /** Map a raw cart line into the presentation view-model. Defaults to a plain
   * purchase line (no wishlist / discount / stock). */
  mapLine?: (line: CartLine, currency: CartCurrency) => CartLineView;
  /** Optional: tapping the wishlist heart on an at-limit / wishlist-only line.
   * Wired once the wishlist data pipeline exists; no-op when omitted. */
  onWishlistAdd?: (view: CartLineView) => void;
}

/** Props for the pure, presentational `CartSidebarView` — all data and handlers
 * are passed in, so it renders identically in the app and in Storybook/tests. */
export interface CartSidebarViewProps {
  theme: CartSidebarTheme;
  /** Whether the sheet is shown. Default true. */
  open?: boolean;
  brandEyebrow?: string;
  title?: string;
  emptyMessage?: string;
  browseHref?: string;
  browseLabel?: string;
  loading?: boolean;
  mutating?: boolean;
  errorMessage?: string | null;
  lines: CartLineView[];
  /** Cart-level promotions (see `CartSidebarProps.promotions`). */
  promotions?: CartPromotionView[];
  onClose: () => void;
  onRemove: (id: string) => void;
  onUpdateQuantity: (id: string, quantity: number) => void;
  onCheckout: () => void;
  onWishlistAdd?: (view: CartLineView) => void;
}

function defaultMapLine(line: CartLine): CartLineView {
  return {
    id: line.id,
    productId: line.productId,
    title: line.title,
    imageUrl: line.imageUrl,
    unitPrice: line.unitPrice,
    purchaseQty: line.quantity,
    mode: 'purchase',
  };
}

function themeToVars(theme: CartSidebarTheme): CSSProperties {
  const c = theme.colors;
  return {
    '--pgc-surface': c.surface,
    '--pgc-surface-warm': c.surfaceWarm,
    '--pgc-border': c.border,
    '--pgc-text-primary': c.textPrimary,
    '--pgc-text-secondary': c.textSecondary,
    '--pgc-text-muted': c.textMuted,
    '--pgc-text-faint': c.textFaint,
    '--pgc-accent': c.accent,
    '--pgc-accent-text': c.accentText,
    '--pgc-wishlist': c.wishlist,
    '--pgc-wishlist-tint': c.wishlistTint,
    '--pgc-badge-neutral-bg': c.badgeNeutralBg,
    '--pgc-font-display': theme.fonts.display,
    '--pgc-font-body': theme.fonts.body,
    '--pgc-radius': `${theme.radius ?? 0}px`,
  } as CSSProperties;
}

function bottlesLabel(count: number) {
  return `${count} ${count === 1 ? 'bottle' : 'bottles'}`;
}

const ICON = { display: 'block', flexShrink: 0 } as const;

function MinusIcon({ size = 18 }: { size?: number }) {
  return (
    <svg style={ICON} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function PlusIcon({ size = 18 }: { size?: number }) {
  return (
    <svg style={ICON} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function HeartIcon({ size = 18 }: { size?: number }) {
  return (
    <svg style={ICON} width={size} height={size} viewBox="0 0 24 24" fill="currentColor"
      aria-hidden="true">
      <path d="M12 21s-7.5-4.6-10-9.2C.6 9.1 1.5 5.7 4.6 4.7 6.8 4 9 4.9 12 8c3-3.1 5.2-4 7.4-3.3 3.1 1 4 4.4 2.6 7.1C19.5 16.4 12 21 12 21z" />
    </svg>
  );
}

function XIcon({ size = 18 }: { size?: number }) {
  return (
    <svg style={ICON} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg style={ICON} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

const STYLES = `
.pgc-scrim{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.45);}
.pgc-root{position:fixed;top:0;right:0;z-index:81;display:flex;flex-direction:column;height:100dvh;width:100%;max-width:480px;background:var(--pgc-surface);color:var(--pgc-text-primary);font-family:var(--pgc-font-body);box-shadow:0 10px 40px rgba(0,0,0,.25);}
.pgc-root *{box-sizing:border-box;}
.pgc-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:20px 24px;border-bottom:1px solid var(--pgc-border);}
.pgc-eyebrow{margin:0;font-size:10px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:var(--pgc-text-muted);}
.pgc-title{margin:4px 0 0;font-family:var(--pgc-font-display);font-size:30px;line-height:1;font-weight:400;color:var(--pgc-text-primary);}
.pgc-close{display:flex;align-items:center;justify-content:center;width:36px;height:36px;border:1px solid var(--pgc-border);border-radius:var(--pgc-radius);background:var(--pgc-surface);color:var(--pgc-text-primary);cursor:pointer;transition:background .15s,color .15s;}
.pgc-close:hover{background:var(--pgc-accent);color:var(--pgc-accent-text);}
.pgc-body{flex:1;min-height:0;overflow-y:auto;padding:0 24px;}
.pgc-note{padding:32px 0;font-size:14px;color:var(--pgc-text-muted);}
.pgc-empty{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:16px;height:100%;}
.pgc-empty-title{margin:0;font-family:var(--pgc-font-display);font-size:30px;color:var(--pgc-text-primary);}
.pgc-empty-link{font-size:12px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:var(--pgc-wishlist);text-decoration:none;cursor:pointer;}
.pgc-lines{list-style:none;margin:0;padding:0;}
.pgc-item{display:flex;gap:16px;padding:20px 0;border-bottom:1px solid var(--pgc-border);}
.pgc-img{position:relative;flex:0 0 auto;width:72px;height:104px;background:var(--pgc-surface-warm);display:flex;align-items:center;justify-content:center;overflow:hidden;}
.pgc-img img{width:100%;height:100%;object-fit:contain;}
.pgc-img-heart{position:absolute;top:6px;left:6px;display:flex;padding:5px;background:var(--pgc-wishlist-tint);color:var(--pgc-wishlist);}
.pgc-main{display:flex;flex-direction:column;gap:10px;min-width:0;flex:1;}
.pgc-name-row{display:flex;align-items:center;gap:8px;}
.pgc-name{font-size:15px;font-weight:500;color:var(--pgc-text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.pgc-format{flex:0 0 auto;padding:3px 6px;border:1px solid var(--pgc-border);font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:var(--pgc-text-muted);}
.pgc-remove{margin-left:auto;flex:0 0 auto;background:none;border:0;padding:0;font-size:10px;font-weight:500;letter-spacing:2px;text-transform:uppercase;color:var(--pgc-text-muted);cursor:pointer;transition:color .15s;}
.pgc-remove:hover{color:var(--pgc-text-primary);}
.pgc-remove:disabled{opacity:.4;cursor:default;}
.pgc-price-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.pgc-price{font-family:var(--pgc-font-display);font-size:20px;color:var(--pgc-text-primary);}
.pgc-price-list{font-family:var(--pgc-font-display);font-size:15px;color:var(--pgc-text-faint);text-decoration:line-through;}
.pgc-tag{padding:3px 7px;font-size:9.5px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;}
.pgc-tag-member{color:var(--pgc-wishlist);background:var(--pgc-wishlist-tint);}
.pgc-tag-sale{color:var(--pgc-surface);background:var(--pgc-wishlist);}
.pgc-savings{margin:0;font-size:11.5px;color:var(--pgc-text-muted);}
.pgc-bottom{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;}
.pgc-control{display:flex;flex-direction:column;gap:8px;align-items:flex-start;}
.pgc-stepper{display:flex;}
.pgc-step{display:flex;align-items:center;justify-content:center;width:40px;height:40px;border:1px solid var(--pgc-border);background:var(--pgc-surface);color:var(--pgc-text-primary);cursor:pointer;}
.pgc-step:disabled{opacity:.4;cursor:default;}
.pgc-step-qty{min-width:24px;height:40px;display:flex;align-items:center;justify-content:center;padding:0 18px;border-top:1px solid var(--pgc-border);border-bottom:1px solid var(--pgc-border);font-size:16px;font-weight:500;color:var(--pgc-text-primary);}
.pgc-step-heart{border-color:var(--pgc-wishlist);background:var(--pgc-wishlist-tint);color:var(--pgc-wishlist);}
.pgc-badge{padding:4px 8px;font-size:9.5px;font-weight:600;letter-spacing:1px;text-transform:uppercase;}
.pgc-badge-neutral{color:var(--pgc-text-secondary);background:var(--pgc-badge-neutral-bg);}
.pgc-badge-wishlist{color:var(--pgc-wishlist);background:var(--pgc-wishlist-tint);}
.pgc-line-status{font-size:11px;line-height:1.3;color:var(--pgc-text-muted);}
.pgc-line-status-failed{color:var(--pgc-wishlist);}
.pgc-total-side{display:flex;flex-direction:column;align-items:flex-end;gap:2px;}
.pgc-total-label{font-size:9px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--pgc-text-faint);}
.pgc-total-was{font-size:12px;color:var(--pgc-text-faint);text-decoration:line-through;}
.pgc-total-value{font-family:var(--pgc-font-display);font-size:20px;color:var(--pgc-text-primary);}
.pgc-split{display:flex;flex-direction:column;align-items:flex-end;gap:6px;}
.pgc-split-purchase{font-size:13px;font-weight:600;color:var(--pgc-text-primary);}
.pgc-split-wishlist{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--pgc-text-muted);}
.pgc-split-note{font-size:9px;font-style:italic;color:var(--pgc-text-faint);}
.pgc-promos{display:flex;flex-direction:column;gap:8px;padding:16px 0 4px;}
.pgc-promo{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:1px solid var(--pgc-wishlist);background:var(--pgc-wishlist-tint);}
.pgc-promo-row{display:flex;align-items:baseline;gap:8px;}
.pgc-promo-title{font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--pgc-wishlist);}
.pgc-promo-nudge{font-size:12.5px;line-height:1.4;color:var(--pgc-text-secondary);}
.pgc-promo-bar{height:4px;width:100%;background:var(--pgc-badge-neutral-bg);overflow:hidden;}
.pgc-promo-bar-fill{height:100%;background:var(--pgc-wishlist);transition:width .25s;}
.pgc-total-promo{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12.5px;color:var(--pgc-wishlist);}
.pgc-total-promo-name{display:flex;align-items:center;gap:6px;min-width:0;}
.pgc-total-promo-name span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.pgc-total-promo-amt{flex:0 0 auto;font-family:var(--pgc-font-display);}
.pgc-total-save{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;font-weight:600;color:var(--pgc-wishlist);}
.pgc-error{margin:0;padding:12px 24px;border-top:1px solid var(--pgc-border);font-size:14px;color:var(--pgc-wishlist);}
.pgc-footer{padding:20px 24px;border-top:1px solid var(--pgc-border);background:var(--pgc-surface);display:flex;flex-direction:column;gap:16px;}
.pgc-totals{display:flex;flex-direction:column;gap:8px;}
.pgc-total-purchase{display:flex;align-items:center;gap:10px;}
.pgc-total-count{font-size:13px;font-weight:600;color:var(--pgc-text-primary);}
.pgc-total-count.is-empty,.pgc-total-sub.is-empty{color:var(--pgc-text-faint);}
.pgc-total-sub{font-family:var(--pgc-font-display);font-size:20px;color:var(--pgc-text-primary);}
.pgc-total-wishlist{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--pgc-text-muted);}
.pgc-primary{width:100%;padding:16px 0;border:0;border-radius:var(--pgc-radius);background:var(--pgc-accent);color:var(--pgc-accent-text);font-family:var(--pgc-font-body);font-size:12px;font-weight:500;letter-spacing:3px;text-transform:uppercase;cursor:pointer;transition:opacity .15s;}
.pgc-primary:hover{opacity:.9;}
.pgc-primary:disabled{opacity:.4;cursor:not-allowed;}
.pgc-primary.is-processing{opacity:.7;cursor:default;}
`;

interface LineItemProps {
  view: CartLineView;
  showImage: boolean;
  disabled: boolean;
  onRemove: () => void;
  onUpdateQuantity: (quantity: number) => void;
  onWishlistAdd?: () => void;
}

function LineItem({
  view,
  showImage,
  disabled,
  onRemove,
  onUpdateQuantity,
  onWishlistAdd,
}: LineItemProps) {
  const hasDiscount = view.listPrice != null && view.listPrice > view.unitPrice;
  const wishlistQty = view.wishlistQty ?? 0;
  const purchaseTotal = view.unitPrice * view.purchaseQty;
  const wasTotal = (view.listPrice ?? 0) * view.purchaseQty;
  const isWishlistCell = view.mode === 'at-limit' || view.mode === 'wishlist-only';

  return (
    <li className="pgc-item">
      {showImage ? (
        <div className="pgc-img">
          {view.imageUrl ? <img src={view.imageUrl} alt="" /> : null}
          {view.mode === 'wishlist-only' ? (
            <span className="pgc-img-heart"><HeartIcon size={14} /></span>
          ) : null}
        </div>
      ) : null}

      <div className="pgc-main">
        <div className="pgc-name-row">
          <span className="pgc-name">{view.title}</span>
          {view.format ? <span className="pgc-format">{view.format}</span> : null}
          <button type="button" className="pgc-remove" onClick={onRemove} disabled={disabled}>
            Remove
          </button>
        </div>

        <div className="pgc-price-row">
          <span className="pgc-price">{formatUsdCents(view.unitPrice)}</span>
          {hasDiscount ? (
            <span className="pgc-price-list">{formatUsdCents(view.listPrice as number)}</span>
          ) : null}
          {view.discount ? (
            <span className={`pgc-tag pgc-tag-${view.discount.kind}`}>{view.discount.label}</span>
          ) : null}
        </div>
        {view.discount?.note ? <p className="pgc-savings">{view.discount.note}</p> : null}

        <div className="pgc-bottom">
          <div className="pgc-control">
            <div className="pgc-stepper">
              <button
                type="button"
                className="pgc-step"
                onClick={() => onUpdateQuantity(view.purchaseQty - 1)}
                disabled={disabled || view.purchaseQty <= 0}
                aria-label={`Decrease ${view.title} quantity`}
              >
                <MinusIcon />
              </button>
              <span className="pgc-step-qty">
                {view.mode === 'wishlist-only' ? wishlistQty : view.purchaseQty}
              </span>
              {isWishlistCell ? (
                <button
                  type="button"
                  className="pgc-step pgc-step-heart"
                  onClick={() => onWishlistAdd?.()}
                  disabled={disabled || !onWishlistAdd}
                  aria-label={`Add ${view.title} to wishlist`}
                >
                  <HeartIcon />
                </button>
              ) : (
                <button
                  type="button"
                  className="pgc-step"
                  onClick={() => onUpdateQuantity(view.purchaseQty + 1)}
                  disabled={disabled}
                  aria-label={`Increase ${view.title} quantity`}
                >
                  <PlusIcon />
                </button>
              )}
            </div>
            {view.stockBadge ? (
              <span
                className={`pgc-badge ${
                  view.stockBadge.kind === 'low-stock' ? 'pgc-badge-neutral' : 'pgc-badge-wishlist'
                }`}
              >
                {view.stockBadge.label}
              </span>
            ) : null}
            {view.syncStatus ? (
              <span
                className={`pgc-line-status${
                  view.syncStatus === 'failed' ? ' pgc-line-status-failed' : ''
                }`}
                role={view.syncStatus === 'failed' ? 'alert' : undefined}
              >
                {view.syncMessage ??
                  (view.syncStatus === 'failed'
                    ? 'Could not save this change. Adjust the quantity or remove the item.'
                    : 'Saving...')}
              </span>
            ) : null}
          </div>

          {view.mode === 'wishlist-only' ? null : wishlistQty > 0 ? (
            <div className="pgc-split">
              <span className="pgc-split-purchase">{formatUsdCents(purchaseTotal)}</span>
              <span className="pgc-split-wishlist">
                <HeartIcon size={12} />
                {bottlesLabel(wishlistQty)}
              </span>
              <span className="pgc-split-note">requested — not yet charged</span>
            </div>
          ) : (
            <div className="pgc-total-side">
              <span className="pgc-total-label">Line total</span>
              {hasDiscount ? <span className="pgc-total-was">{formatUsdCents(wasTotal)}</span> : null}
              <span className="pgc-total-value">{formatUsdCents(purchaseTotal)}</span>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Pure presentational cart sheet — the functional-core view. Receives all data
 * and handlers as props so it renders identically in the app, Storybook, and
 * tests. The connected `CartSidebar` wires it to the cart store.
 */
export function CartSidebarView({
  theme,
  open = true,
  brandEyebrow,
  title = 'Cart',
  emptyMessage = 'Your cart is empty.',
  browseHref,
  browseLabel = 'Browse wines',
  loading = false,
  mutating = false,
  errorMessage = null,
  lines,
  promotions = [],
  onClose,
  onRemove,
  onUpdateQuantity,
  onCheckout,
  onWishlistAdd,
}: CartSidebarViewProps) {
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();

  const purchaseCount = lines.reduce((sum, v) => sum + v.purchaseQty, 0);
  const purchaseSubtotal = lines.reduce((sum, v) => sum + v.unitPrice * v.purchaseQty, 0);
  const wishlistCount = lines.reduce((sum, v) => sum + (v.wishlistQty ?? 0), 0);
  const wishlistSubtotal = lines.reduce((sum, v) => sum + v.unitPrice * (v.wishlistQty ?? 0), 0);

  const appliedPromos = promotions.filter((promo) => promo.applied);
  const nudgePromos = promotions.filter((promo) => !promo.applied && promo.nudge);
  const promoSavings = appliedPromos.reduce((sum, promo) => sum + (promo.savings ?? 0), 0);

  const isEmpty = lines.length === 0;
  const isWishlistOnly = purchaseCount === 0 && wishlistCount > 0;
  const hasFailedLines = lines.some((line) => line.syncStatus === 'failed');
  const primaryLabel = mutating
    ? 'Saving...'
    : hasFailedLines
      ? 'Review cart'
      : isWishlistOnly
        ? 'Submit requests'
        : 'Checkout';

  // Escape to close, initial focus, and body scroll lock while open.
  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);

    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>('[data-pgc-initial-focus]')?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <style>{STYLES}</style>
      <div className="pgc-scrim" onClick={onClose} aria-hidden="true" />
      <aside
        ref={panelRef}
        className="pgc-root"
        style={themeToVars(theme)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="pgc-header">
          <div>
            {brandEyebrow ? <p className="pgc-eyebrow">{brandEyebrow}</p> : null}
            <h2 className="pgc-title" id={titleId}>{title}</h2>
          </div>
          <button
            type="button"
            className="pgc-close"
            onClick={onClose}
            aria-label="Close cart"
            data-pgc-initial-focus
          >
            <XIcon />
          </button>
        </header>

        <div className="pgc-body">
          {loading ? (
            <p className="pgc-note">Loading cart…</p>
          ) : isEmpty ? (
            <div className="pgc-empty">
              <p className="pgc-empty-title">{emptyMessage}</p>
              {browseHref ? (
                <a className="pgc-empty-link" href={browseHref} onClick={onClose}>
                  {browseLabel}
                </a>
              ) : null}
            </div>
          ) : (
            <>
              {nudgePromos.length > 0 ? (
                <div className="pgc-promos">
                  {nudgePromos.map((promo) => (
                    <div key={promo.id} className="pgc-promo">
                      <div className="pgc-promo-row">
                        <span className="pgc-promo-title">{promo.title}</span>
                      </div>
                      <span className="pgc-promo-nudge">{promo.nudge}</span>
                      {typeof promo.progress === 'number' ? (
                        <div className="pgc-promo-bar">
                          <div
                            className="pgc-promo-bar-fill"
                            style={{ width: `${Math.round(Math.max(0, Math.min(1, promo.progress)) * 100)}%` }}
                          />
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              <ul className="pgc-lines">
                {lines.map((view) => (
                  <LineItem
                    key={view.id}
                    view={view}
                    showImage={theme.showLineImages ?? true}
                    disabled={false}
                    onRemove={() => onRemove(view.id)}
                    onUpdateQuantity={(quantity) => onUpdateQuantity(view.id, quantity)}
                    onWishlistAdd={onWishlistAdd ? () => onWishlistAdd(view) : undefined}
                  />
                ))}
              </ul>
            </>
          )}
        </div>

        {errorMessage ? <p className="pgc-error">{errorMessage}</p> : null}

        <footer className="pgc-footer">
          <div className="pgc-totals">
            <div className="pgc-total-purchase">
              <span className={`pgc-total-count${isEmpty ? ' is-empty' : ''}`}>
                {bottlesLabel(purchaseCount)}
              </span>
              <span className={`pgc-total-sub${isEmpty ? ' is-empty' : ''}`}>
                {formatUsdCents(purchaseSubtotal)}
              </span>
            </div>
            {wishlistCount > 0 ? (
              <div className="pgc-total-wishlist">
                <HeartIcon size={13} />
                <span>{wishlistCount} wishlisted</span>
                <span>({formatUsdCents(wishlistSubtotal)})</span>
              </div>
            ) : null}
            {appliedPromos.map((promo) => (
              <div key={promo.id} className="pgc-total-promo">
                <span className="pgc-total-promo-name">
                  <CheckIcon />
                  <span>{promo.title}</span>
                </span>
                {promo.savings ? (
                  <span className="pgc-total-promo-amt">−{formatUsdCents(promo.savings)}</span>
                ) : null}
              </div>
            ))}
            {promoSavings > 0 ? (
              <div className="pgc-total-save">
                <span>You save</span>
                <span>{formatUsdCents(promoSavings)}</span>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className={`pgc-primary${mutating ? ' is-processing' : ''}`}
            disabled={isEmpty || mutating || hasFailedLines}
            onClick={onCheckout}
          >
            {primaryLabel}
          </button>
        </footer>
      </aside>
    </>
  );
}

/**
 * Connected cart sidebar — the imperative shell. Wires the cart store to the
 * pure `CartSidebarView`. This is what sites mount.
 */
export function CartSidebar({
  theme,
  brandEyebrow,
  title,
  emptyMessage,
  browseHref,
  browseLabel,
  promotions,
  mapLine,
  onWishlistAdd,
}: CartSidebarProps) {
  const {
    cart,
    checkout,
    closeCart,
    error,
    isLoading,
    isMutating,
    isSidebarOpen,
    lineSync,
    lines,
    removeItem,
    updateQuantity,
  } = useCartSidebar();

  const currency: CartCurrency = cart?.currency ?? 'USD';
  const views = useMemo(
    () =>
      lines.map((line) => {
        const view = mapLine ? mapLine(line, currency) : defaultMapLine(line);
        const sync = lineSync[line.id];
        if (!sync) return view;

        return {
          ...view,
          syncStatus: sync.status,
          syncMessage: sync.error?.message,
        };
      }),
    [lines, mapLine, currency, lineSync],
  );
  const displayPromotions = promotions ?? cart?.promotions ?? [];

  return (
    <CartSidebarView
      theme={theme}
      open={isSidebarOpen}
      brandEyebrow={brandEyebrow}
      title={title}
      emptyMessage={emptyMessage}
      browseHref={browseHref}
      browseLabel={browseLabel}
      loading={isLoading}
      mutating={isMutating}
      errorMessage={error?.message ?? null}
      lines={views}
      promotions={displayPromotions}
      onClose={closeCart}
      onRemove={(id) => void removeItem(id)}
      onUpdateQuantity={(id, quantity) => void updateQuantity(id, quantity)}
      onCheckout={() => void checkout()}
      onWishlistAdd={onWishlistAdd}
    />
  );
}

export default CartSidebar;
