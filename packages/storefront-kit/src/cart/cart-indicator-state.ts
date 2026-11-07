export interface CartItemsIndicatorState {
  count: number;
  hasItems: boolean;
  displayCount: string;
  itemLabel: string;
  ariaLabel: string;
}

export function getCartItemsIndicatorState(
  count: number,
  maxDisplayCount = 99,
): CartItemsIndicatorState {
  const safeCount = Number.isFinite(count) ? count : 0;
  const safeMaxDisplayCount =
    Number.isFinite(maxDisplayCount) && maxDisplayCount > 0 ? Math.floor(maxDisplayCount) : 99;
  const normalizedCount = Math.max(0, Math.floor(safeCount));
  const hasItems = normalizedCount > 0;
  const itemLabel = normalizedCount === 1 ? 'item' : 'items';
  const displayCount =
    normalizedCount > safeMaxDisplayCount ? `${safeMaxDisplayCount}+` : String(normalizedCount);

  return {
    count: normalizedCount,
    hasItems,
    displayCount,
    itemLabel,
    ariaLabel: hasItems ? `Cart (${normalizedCount} ${itemLabel})` : 'Cart (empty)',
  };
}
