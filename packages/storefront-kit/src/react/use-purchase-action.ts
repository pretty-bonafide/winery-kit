import type { ButtonHTMLAttributes, MouseEvent } from 'react';
import { useEffect, useState } from 'react';
import type { AddToCartInput, CartErrorPayload } from '../cart/cart-types.js';
import { useAddToCart } from './use-add-to-cart.js';
import { useCartLineQuantity } from './use-cart-line-quantity.js';
import { useVariationCommerce } from './use-customer-commerce.js';

export interface PurchaseActionLabels {
  add: string;
  adding: string;
  added: string;
  checking: string;
  retry: string;
  unavailable: string;
}

export interface PurchaseActionIdentity {
  productId?: string;
  purchaseOptionId?: string;
  sku?: string;
  variantId?: string;
}

export type PurchaseActionState =
  | 'idle'
  | 'checking'
  | 'adding'
  | 'added'
  | 'error'
  | 'unavailable';

export type PurchaseActionDisabledReason =
  | 'hydrating'
  | 'disabled'
  | 'policy-pending'
  | 'missing-input'
  | 'cart-unconfigured'
  | 'commerce-loading'
  | 'unavailable'
  | 'adding'
  | null;

export type PurchaseActionPolicy =
  | {
      /** The action hook owns the customer-commerce availability check. Use for
       * simple list/card buttons that do not already have a richer state
       * machine. */
      kind: 'resolve-commerce';
    }
  | {
      /** A parent controller already resolved the customer-aware commerce
       * policy. Use for PDP panels so one state machine owns allocations,
       * restricted/by-request states, format selection, and degradation. */
      kind: 'resolved';
      canPurchase: boolean;
      /** Product/customer policy is still loading. The button stays disabled
       * but keeps the optimistic add label instead of flipping to unavailable. */
      pending?: boolean;
    };

export interface UsePurchaseActionOptions {
  /** Normalized cart input. Presentation code may source this from a CMS seed,
   * PDP panel state, or another page-model adapter, but the action policy stays
   * here. */
  input?: AddToCartInput | null;
  /** External product-state gate from the caller, e.g. an intentionally disabled
   * row or PDP state-machine result. */
  disabled?: boolean;
  /** Label for explicit disabled / unavailable states. */
  disabledLabel?: string;
  labels?: Partial<PurchaseActionLabels>;
  /** Override the identity used for in-cart matching. Defaults to `input`. */
  identity?: PurchaseActionIdentity;
  /** Override the variation id used for customer-commerce checks. Defaults to
   * `input.purchaseOptionId ?? input.variantId`. */
  variationId?: string;
  /** Customer-aware purchase policy. Defaults to `resolve-commerce`, which
   * makes this hook perform the same availability checks for simple buttons that
   * the PDP state machine performs before passing `resolved` policy here. */
  policy?: PurchaseActionPolicy;
  quantityLabel?: (quantity: number) => string;
}

export interface PurchaseActionResult {
  disabled: boolean;
  disabledReason: PurchaseActionDisabledReason;
  error: CartErrorPayload | null;
  isAdding: boolean;
  isChecking: boolean;
  isUnavailable: boolean;
  label: string;
  quantityInCart: number;
  quantityLabel: string | null;
  state: PurchaseActionState;
  status: PurchaseActionState;
  submit: () => void;
  getButtonProps: (
    props?: ButtonHTMLAttributes<HTMLButtonElement>,
  ) => ButtonHTMLAttributes<HTMLButtonElement>;
}

const DEFAULT_LABELS: PurchaseActionLabels = {
  add: 'ADD TO CART',
  adding: 'ADDING',
  added: 'ADDED',
  checking: 'CHECKING',
  retry: 'TRY AGAIN',
  unavailable: 'UNAVAILABLE',
};

export function usePurchaseAction(options: UsePurchaseActionOptions): PurchaseActionResult {
  const {
    disabled = false,
    disabledLabel,
    identity,
    input,
    policy = { kind: 'resolve-commerce' },
    quantityLabel = (quantity) => `${quantity} in cart`,
  } = options;
  const labels = {
    ...DEFAULT_LABELS,
    ...options.labels,
    ...(disabledLabel ? { unavailable: disabledLabel } : null),
  };
  const [isHydrated, setIsHydrated] = useState(false);
  const resolvesCommerce = policy.kind === 'resolve-commerce';

  const { addToCart, error, isAdding, isConfigured, status } = useAddToCart(input ?? undefined);
  const variationId = options.variationId ?? input?.purchaseOptionId ?? input?.variantId;
  const { availability, commerce } = useVariationCommerce(
    isHydrated && resolvesCommerce ? variationId : undefined,
  );
  const quantityInCart = useCartLineQuantity(identity ?? input ?? {});
  const expectsCommerceCheck = Boolean(
    isHydrated && resolvesCommerce && variationId && commerce.variationIds.includes(variationId),
  );
  const isChecking = expectsCommerceCheck && commerce.isLoading && commerce.availability === null;
  const isMissingAvailability =
    expectsCommerceCheck && commerce.availability !== null && !availability;
  const resolvedPolicyUnavailable =
    policy.kind === 'resolved' && !policy.pending && !policy.canPurchase;
  const isUnavailable = resolvesCommerce
    ? isMissingAvailability ||
      Boolean(
        availability &&
          (!availability.canAddToCart ||
            availability.permission !== 'purchase' ||
            availability.quantityLimit?.available === 0),
      )
    : resolvedPolicyUnavailable;
  const disabledReason = resolveDisabledReason({
    disabled,
    input: input ?? null,
    isAdding,
    isChecking,
    isConfigured,
    isHydrated,
    isUnavailable,
    policyPending: policy.kind === 'resolved' && Boolean(policy.pending),
  });
  const isDisabled = disabledReason !== null;
  const actionState = resolveState({ isAdding, isChecking, isUnavailable, status });
  const label = resolveLabel({
    disabled,
    disabledReason,
    labels,
    state: actionState,
  });

  function submit() {
    if (isDisabled || !input) return;
    void addToCart(input);
  }

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  function getButtonProps(props: ButtonHTMLAttributes<HTMLButtonElement> = {}) {
    const { disabled: callerDisabled, onClick, type, ...rest } = props;
    const buttonDisabled = Boolean(callerDisabled) || isDisabled;

    return {
      ...rest,
      'aria-busy': isAdding || isChecking || undefined,
      'data-purchase-action-state': actionState,
      disabled: buttonDisabled,
      onClick: (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || buttonDisabled) return;
        submit();
      },
      type: type ?? 'button',
    };
  }

  return {
    disabled: isDisabled,
    disabledReason,
    error,
    isAdding,
    isChecking,
    isUnavailable,
    label,
    quantityInCart,
    quantityLabel: quantityInCart > 0 ? quantityLabel(quantityInCart) : null,
    state: actionState,
    status: actionState,
    submit,
    getButtonProps,
  };
}

function resolveDisabledReason({
  disabled,
  input,
  isAdding,
  isChecking,
  isConfigured,
  isHydrated,
  isUnavailable,
  policyPending,
}: {
  disabled: boolean;
  input: AddToCartInput | null;
  isAdding: boolean;
  isChecking: boolean;
  isConfigured: boolean;
  isHydrated: boolean;
  isUnavailable: boolean;
  policyPending: boolean;
}): PurchaseActionDisabledReason {
  if (!isHydrated) return 'hydrating';
  if (disabled) return 'disabled';
  if (policyPending) return 'policy-pending';
  if (!input) return 'missing-input';
  if (!isConfigured) return 'cart-unconfigured';
  if (isAdding) return 'adding';
  if (isChecking) return 'commerce-loading';
  if (isUnavailable) return 'unavailable';
  return null;
}

function resolveState({
  isAdding,
  isChecking,
  isUnavailable,
  status,
}: {
  isAdding: boolean;
  isChecking: boolean;
  isUnavailable: boolean;
  status: string;
}): PurchaseActionState {
  if (isAdding) return 'adding';
  if (isChecking) return 'checking';
  if (isUnavailable) return 'unavailable';
  if (status === 'added' || status === 'error') return status;
  return 'idle';
}

function resolveLabel({
  disabled,
  disabledReason,
  labels,
  state,
}: {
  disabled: boolean;
  disabledReason: PurchaseActionDisabledReason;
  labels: PurchaseActionLabels;
  state: PurchaseActionState;
}) {
  if (disabled) return labels.unavailable;
  if (disabledReason === 'hydrating' || disabledReason === 'policy-pending') return labels.add;
  if (disabledReason === 'cart-unconfigured' || state === 'checking') return labels.checking;
  if (disabledReason === 'missing-input' || state === 'unavailable') return labels.unavailable;
  if (state === 'adding') return labels.adding;
  if (state === 'added') return labels.added;
  if (state === 'error') return labels.retry;
  return labels.add;
}
