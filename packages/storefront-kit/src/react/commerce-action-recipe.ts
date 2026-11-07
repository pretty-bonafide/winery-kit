/**
 * Visual class contract for commerce actions supplied by a host site. The
 * storefront kit owns commerce state and lifecycle labels; sites own the class
 * recipe that makes list buttons, PDP actions, and quantity steppers look
 * cohesive across wildly different visual systems.
 */
export interface CommerceActionRecipe {
  /** Horizontal action group, including the shared gap/wrap strategy. */
  group: string;
  /** Wrapper for a button plus optional secondary quantity label. */
  stack: string;
  /** Secondary label shown by list add-to-cart controls, e.g. "1 in cart". */
  quantityLabel: string;
  /** Product-list primary style. */
  listSolid: string;
  /** Product-list outline style. */
  listOutline: string;
  /** PDP primary action style, including fixed height/min width. */
  pdpPrimary: string;
  /** PDP pre-hydration or pending action style. */
  pdpLoading: string;
  /** PDP secondary action style, e.g. sign-in or alternative-vintage links. */
  pdpOutline: string;
  /** Quantity stepper shell. Owns the fixed action height. */
  stepperRoot: string;
  /** Quantity stepper decrement/increment cells. */
  stepperButton: string;
  /** Quantity stepper value cell. */
  stepperValue: string;
  /** Quantity stepper dividers. */
  stepperDivider: string;
}

export type CommerceActionRecipeSlot = keyof CommerceActionRecipe;

export function defineCommerceActionRecipe<const T extends CommerceActionRecipe>(recipe: T): T {
  return recipe;
}
