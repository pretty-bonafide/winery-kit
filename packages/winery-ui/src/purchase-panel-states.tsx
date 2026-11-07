// PurchasePanel.States — exhaustive state dispatch with the lens's state set
// enforced at compile time. A site that omits a renderer the lens can reach
// fails to typecheck, so adding a state to the kit's machine breaks every
// consumer until that state has a designed render — the same discipline as
// the per-state mock sheets, encoded in the types.
//
// The `lens` prop only narrows the prop type (which renderers are required);
// runtime dispatch reads the resolved state off the Root context.
import type { ReactNode } from 'react';
import type { PurchasePanelView } from '@pretty-good/storefront-kit/pdp';
import { usePurchasePanelContext } from './purchase-panel-context.js';

export type PurchaseStateRenderer = (view: PurchasePanelView) => ReactNode;

/** States the retail lens can resolve to. */
export interface RetailStateRenderers {
  purchasable: PurchaseStateRenderer;
  inCart: PurchaseStateRenderer;
  unavailable: PurchaseStateRenderer;
  /** Entitlement-gated wine on the public catalog (the platform's availability
   * read reports `restricted` for this visitor): scarcity-first communication,
   * never an enabled purchase CTA. */
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
  | ({ lens?: 'retail' } & RetailStateRenderers & {
      membersOnly?: undefined;
      notAllocated?: undefined;
    })
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
      return <>{props.membersOnly?.(view) ?? null}</>;
    case 'not-allocated':
      return <>{props.notAllocated?.(view) ?? null}</>;
    case 'restricted':
      return <>{props.restricted?.(view) ?? null}</>;
    case 'by-request':
      return <>{props.byRequest(view)}</>;
    case 'degraded':
      return <>{props.degraded(view)}</>;
  }
}
