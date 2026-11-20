import type { CartLineComponent } from './cart-types.js';

/** The one-line caption beneath a bundle line naming what is inside one
 * bundle, e.g. "Includes: 2024 Roussanne × 3 · 2024 Garnacha × 3". A count of
 * one is already said by the wine being listed, so only a larger count is
 * spoken. */
export function bundleIncludesCaption(components: readonly CartLineComponent[]): string {
  const labels = components.map((component) =>
    component.quantity === 1 ? component.title : `${component.title} × ${component.quantity}`,
  );
  return `Includes: ${labels.join(' · ')}`;
}
