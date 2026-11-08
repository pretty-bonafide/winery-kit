// Pure core of product_viewed: what each surface reports, and whether a view is
// due. No React, no observer, no tracker — use-product-view.ts is the shell.
import type { ProductViewedInput } from '../analytics/core.js';
import type { AddToCartInput } from '../cart/cart-types.js';
import type { CartProductSeed, ResolvedCartProduct } from '../pdp/purchase-panel-state.js';

/**
 * The view a PDP purchase panel reports, or null while its product read is
 * pending (or when there is no slug to report). The resolved cart input's
 * productId is the storefront slug; an unsellable product has none, so it falls
 * back to the CMS join key.
 */
export function panelProductView({
  resolution,
  slug,
  cartSeed,
}: {
  resolution: ResolvedCartProduct | null;
  slug?: string;
  cartSeed: CartProductSeed;
}): ProductViewedInput | null {
  if (resolution === null) return null;
  const productSlug = resolution.cartProduct?.productId ?? slug ?? cartSeed.slug;
  if (!productSlug) return null;
  return {
    type: 'product_viewed',
    surface: 'page',
    productSlug,
    productName: cartSeed.title,
    priceCents: resolution.cartProduct?.display?.unitPrice,
  };
}

/** The view a product card reports for its add-to-cart input, or null until
 * that input has resolved. */
export function cardProductView(
  input: AddToCartInput | null | undefined,
): ProductViewedInput | null {
  if (!input?.productId) return null;
  return {
    type: 'product_viewed',
    surface: 'card',
    productSlug: input.productId,
    productName: input.display?.title,
    priceCents: input.display?.unitPrice,
  };
}

/** The view to emit now: one per mount, once the product is both seen and
 * resolved. */
export function productViewToEmit({
  view,
  seen,
  emitted,
}: {
  view: ProductViewedInput | null;
  seen: boolean;
  emitted: boolean;
}): ProductViewedInput | null {
  return view !== null && seen && !emitted ? view : null;
}
