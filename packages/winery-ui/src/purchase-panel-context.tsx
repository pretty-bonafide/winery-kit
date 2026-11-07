// PurchasePanel.Root — the headless boundary of the compound purchase panel.
//
// Root runs usePurchasePanel (data wiring, cart mutation, state resolution)
// and provides the result over context; every part under it reads from that
// context and owns its own behavior (handlers, disabled logic, aria, state
// gating). Brands compose parts and pass classNames — handlers and policy
// never live in brand code. The pre-assembled <PurchasePanel> renders this
// same Root internally, so both tiers share one behavior path.
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { UsePurchasePanelOptions, UsePurchasePanelResult } from '@pretty-good/storefront-kit/react';
import { usePurchasePanel } from '@pretty-good/storefront-kit/react';

export interface PurchasePanelContextValue extends UsePurchasePanelResult {
  /** Display noun for quantities (stepper aria-labels), e.g. "bottle". */
  unitNoun: string;
}

const PurchasePanelContext = createContext<PurchasePanelContextValue | null>(null);

/** Escape hatch for bespoke parts: the full hook result, scoped to the
 * nearest Root. Handlers still come from the kit — never re-wire them. */
export function usePurchasePanelContext(): PurchasePanelContextValue {
  const value = useContext(PurchasePanelContext);
  if (!value) {
    throw new Error('PurchasePanel parts must render inside <PurchasePanel.Root>.');
  }
  return value;
}

export interface PurchasePanelRootProps extends UsePurchasePanelOptions {
  className?: string;
  children: ReactNode;
}

export function PurchasePanelRoot({ className, children, ...options }: PurchasePanelRootProps) {
  const panel = usePurchasePanel(options);

  return (
    <PurchasePanelContext.Provider
      value={{ ...panel, unitNoun: options.unitNoun ?? 'bottle' }}
    >
      <section
        ref={panel.viewRef}
        className={className}
        data-purchase-state={panel.view.state}
        data-hydrated={panel.isHydrated ? 'true' : 'false'}
      >
        {children}
      </section>
    </PurchasePanelContext.Provider>
  );
}
