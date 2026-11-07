// Client-safe money formatting — no Sanity or server-only imports, so browser
// islands can use it without dragging the CMS client into the bundle.
export function formatUsdCents(amount: number) {
  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    maximumFractionDigits: amount % 100 === 0 ? 0 : 2,
    style: 'currency',
  }).format(amount / 100);
}
