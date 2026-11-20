// PurchasePanel.States — exhaustive state dispatch with the lens's state set
// enforced at compile time. A site that omits a renderer the lens can reach
// fails to typecheck, so adding a state to the kit's machine breaks every
// consumer until that state has a designed render — the same discipline as
// the per-state mock sheets, encoded in the types.
//
// The retail lens's `membersOnly` / `notAllocated` are optional: they resolve only
// for a site that supplies the panel's `session`, and a site that has not
// designed them gets its `unavailable` render (never nothing, never a buy button).
//
// The `lens` prop only narrows the prop type (which renderers are required);
// runtime dispatch reads the resolved state off the Root context.
import type { ReactNode } from 'react';
import type { PurchasePanelView } from '@pretty-good/storefront-kit/pdp';
import { UNAVAILABLE_NOTE } from '@pretty-good/storefront-kit/pdp';
import { usePurchasePanelContext } from './purchase-panel-context.js';

export type PurchaseStateRenderer = (view: PurchasePanelView) => ReactNode;

/** States the retail lens can resolve to. */
export interface RetailStateRenderers {
  purchasable: PurchaseStateRenderer;
  inCart: PurchaseStateRenderer;
  /** Not purchasable for a reason that is not the visitor's permission (a
   * used-up cap). */
  unavailable: PurchaseStateRenderer;
  /** OPTIONAL. The platform says an anonymous visitor may not buy this wine and
   * no request path is open (reachable only when the site supplies the panel's
   * `session`): the members sentence, a sign-in action and the waiting-list CTA.
   * Says nothing about why the wine is not public. Omitted → the `unavailable`
   * renderer is used. */
  membersOnly?: PurchaseStateRenderer;
  /** OPTIONAL. The same denial for a signed-in customer: not-allocated copy plus
   * the waiting-list CTA, no sign-in action. Omitted → the `unavailable`
   * renderer is used. */
  notAllocated?: PurchaseStateRenderer;
  /** Entitlement-gated wine on the public catalog (offer-level `restricted`
   * input): scarcity-first communication, never an enabled purchase CTA. */
  restricted: PurchaseStateRenderer;
  /** Wishlist-as-request-to-purchase: the open request path, full-strength
   * price, primary REQUEST CTA. */
  byRequest: PurchaseStateRenderer;
  degraded: PurchaseStateRenderer;
}

/** States the allocation lens can resolve to. */
export interface AllocationStateRenderers {
  membersOnly: PurchaseStateRenderer;
  purchasable: PurchaseStateRenderer;
  inCart: PurchaseStateRenderer;
  notAllocated: PurchaseStateRenderer;
  /** Member whose only path is a purchase request (replaces the
   * not-allocated dead end when requests are open). */
  byRequest: PurchaseStateRenderer;
  degraded: PurchaseStateRenderer;
}

export type PurchasePanelStatesProps =
  | ({ lens?: 'retail' } & RetailStateRenderers)
  | ({ lens: 'allocation' } & AllocationStateRenderers & {
      unavailable?: undefined;
      restricted?: undefined;
    });

export function PurchasePanelStates(props: PurchasePanelStatesProps) {
  const { view } = usePurchasePanelContext();

  switch (view.state) {
    case 'purchasable':
      return <>{props.purchasable(view)}</>;
    case 'in-cart':
      return <>{props.inCart(view)}</>;
    case 'unavailable':
      return <>{props.unavailable?.(view) ?? null}</>;
    case 'members-only':
      return <>{renderOrUnavailable(props.membersOnly, props.unavailable, view)}</>;
    case 'not-allocated':
      return <>{renderOrUnavailable(props.notAllocated, props.unavailable, view)}</>;
    case 'restricted':
      return <>{props.restricted?.(view) ?? null}</>;
    case 'by-request':
      return <>{props.byRequest(view)}</>;
    case 'degraded':
      return <>{props.degraded(view)}</>;
  }
}

// A retail denial the site has not designed falls back to its `unavailable`
// render, handed the view as `unavailable` with the note that render expects.
export function renderOrUnavailable(
  own: PurchaseStateRenderer | undefined,
  unavailable: PurchaseStateRenderer | undefined,
  view: PurchasePanelView,
): ReactNode {
  if (own) return own(view);
  return (
    unavailable?.({
      ...view,
      state: 'unavailable',
      unavailableNote: view.unavailableNote ?? UNAVAILABLE_NOTE,
    }) ?? null
  );
}
