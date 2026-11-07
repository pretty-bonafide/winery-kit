// Two tiers, one behavior path:
// - <PurchasePanel> — the pre-assembled panel; brands inject styling via the
//   `classes` slot map.
// - <PurchasePanel.Root> + parts (PurchasePanel.Price, .Stepper, .AddToCart,
//   .States, …) — brands with structural needs compose their own layout;
//   handlers, disabled logic, aria, and state gating stay in the parts.
// The raw usePurchasePanel hook (@pretty-good/storefront-kit/react) remains
// the final escape hatch.
import { PurchasePanel as PurchasePanelBase } from './purchase-panel.js';
import { PurchasePanelRoot, usePurchasePanelContext } from './purchase-panel-context.js';
import {
  AddToCart,
  CartNote,
  CheckIcon,
  ClubUpsellCta,
  ClubUpsellLabel,
  ClubUpsellNote,
  ClubUpsellPrice,
  EntitlementStatus,
  FormatSelector,
  GrantName,
  MemberBadge,
  MembersOnlyNote,
  OptionSelector,
  Price,
  PriceCaption,
  PriceLabel,
  PriceUnit,
  RequestCta,
  RetailPrice,
  SavingsNote,
  ScarcityCap,
  ScarcityNote,
  ScarcityStatus,
  Stepper,
  Summary,
  UnavailableNote,
  ViewCart,
  WaitingListCta,
} from './purchase-panel-parts.js';
import { PurchasePanelStates } from './purchase-panel-states.js';

export const PurchasePanel = Object.assign(PurchasePanelBase, {
  Root: PurchasePanelRoot,
  States: PurchasePanelStates,
  Summary,
  Price,
  RetailPrice,
  PriceUnit,
  PriceCaption,
  PriceLabel,
  SavingsNote,
  MemberBadge,
  EntitlementStatus,
  GrantName,
  UnavailableNote,
  MembersOnlyNote,
  CartNote,
  ClubUpsellLabel,
  ClubUpsellPrice,
  ClubUpsellNote,
  ClubUpsellCta,
  ScarcityStatus,
  ScarcityCap,
  ScarcityNote,
  RequestCta,
  FormatSelector,
  OptionSelector,
  Stepper,
  AddToCart,
  ViewCart,
  WaitingListCta,
});

export type { PurchasePanelClasses, PurchasePanelProps } from './purchase-panel.js';
export type {
  PurchasePanelContextValue,
  PurchasePanelRootProps,
} from './purchase-panel-context.js';
export type {
  FormatCardContext,
  FormatSelectorClasses,
  OptionSelectorClasses,
  OptionValueContext,
  StepperClasses,
  SummaryClasses,
} from './purchase-panel-parts.js';
export type {
  AllocationStateRenderers,
  PurchasePanelStatesProps,
  PurchaseStateRenderer,
  RetailStateRenderers,
} from './purchase-panel-states.js';
export { CheckIcon, usePurchasePanelContext };
