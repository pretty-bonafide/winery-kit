import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CartSidebarView } from '../src/react/CartSidebar';
import type { CartLineView, CartPromotionView } from '../src/cart/cart-types';
import {
  exampleCartSidebarThemes,
  type ExampleCartThemeName,
} from '../src/react/cart-sidebar-example-themes';

// ---------------------------------------------------------------------------
// Fixtures — sample line view-models covering each rendering path.
// Prices are in cents.
// ---------------------------------------------------------------------------
const cabernet: CartLineView = {
  id: 'cab',
  productId: 'p-cab',
  title: '2022 Cabernet Sauvignon',
  format: '750ML',
  unitPrice: 4500,
  purchaseQty: 3,
  purchaseLimit: 6,
  mode: 'purchase',
  stockBadge: { kind: 'low-stock', label: 'Only 4 left' },
};

const chardonnay: CartLineView = {
  id: 'chard',
  productId: 'p-chard',
  title: '2021 Estate Chardonnay',
  format: '750ML',
  unitPrice: 3800,
  purchaseQty: 1,
  mode: 'purchase',
};

const memberDiscount: CartLineView = {
  id: 'res',
  productId: 'p-res',
  title: '2019 Reserve Cabernet',
  format: '750ML',
  unitPrice: 3600,
  listPrice: 4500,
  discount: { kind: 'member', label: 'Member −20%', note: 'You save $9.00 a bottle · Club Member Pricing' },
  purchaseQty: 2,
  mode: 'purchase',
};

const saleDiscount: CartLineView = {
  id: 'rose',
  productId: 'p-rose',
  title: '2023 Estate Rosé',
  format: '750ML',
  unitPrice: 3900,
  listPrice: 5800,
  discount: { kind: 'sale', label: 'Sale −33%', note: 'Seasonal release · $19.00 off per bottle' },
  purchaseQty: 1,
  mode: 'purchase',
};

// Reached the purchase limit — the stepper plus becomes a wishlist heart, and a
// read-only purchase/wishlist split appears.
const atLimit: CartLineView = {
  id: 'atl',
  productId: 'p-atl',
  title: '2021 Estate Chardonnay',
  format: '750ML',
  unitPrice: 3800,
  purchaseQty: 6,
  purchaseLimit: 6,
  wishlistQty: 2,
  mode: 'at-limit',
};

// Request-only wine (max purchase 0) — always wishlisting.
const byRequest: CartLineView = {
  id: 'pinot',
  productId: 'p-pinot',
  title: '2019 Reserve Pinot Noir',
  format: '750ML',
  unitPrice: 7200,
  purchaseQty: 0,
  wishlistQty: 1,
  mode: 'wishlist-only',
  stockBadge: { kind: 'by-request', label: 'By request' },
};

// ---------------------------------------------------------------------------
// Automatic order promotions (cart-level) — threshold-driven offers. A nudge
// while unmet (with optional progress bar); a savings/perk line once applied.
// These are static fixtures.
// ---------------------------------------------------------------------------
const freeShipNudge: CartPromotionView = {
  id: 'ship',
  title: 'Free shipping',
  applied: false,
  nudge: 'Add $30.00 more to unlock free ground shipping.',
  progress: 0.8,
};

const freeShipApplied: CartPromotionView = {
  id: 'ship',
  title: 'Free shipping unlocked',
  applied: true,
};

const bulkNudge: CartPromotionView = {
  id: 'bulk',
  title: '15% off 6+ bottles',
  applied: false,
  nudge: 'Add 2 more bottles to take 15% off the order.',
  progress: 4 / 6,
};

const bulkApplied: CartPromotionView = {
  id: 'bulk',
  title: '15% off · 6+ bottles',
  applied: true,
  savings: 4050,
};

// A six-bottle cart so the percentage-off promotion reads as earned.
const sixBottles: CartLineView[] = [
  { ...cabernet, purchaseQty: 4 },
  { ...chardonnay, id: 'chard6', purchaseQty: 2 },
];

// ---------------------------------------------------------------------------
// Interactive harness — holds lines in local state so steppers / remove work,
// and re-opens the sheet after close (it renders nothing when closed).
// ---------------------------------------------------------------------------
interface DemoArgs {
  themeName: ExampleCartThemeName;
  brandEyebrow?: string;
  title?: string;
  emptyMessage?: string;
  browseHref?: string;
  browseLabel?: string;
  loading?: boolean;
  mutating?: boolean;
  errorMessage?: string | null;
  initialLines: CartLineView[];
  promotions?: CartPromotionView[];
}

function Demo({ themeName, initialLines, ...rest }: DemoArgs) {
  const [lines, setLines] = useState<CartLineView[]>(initialLines);
  const [open, setOpen] = useState(true);
  const theme = exampleCartSidebarThemes[themeName];

  return (
    <div style={{ minHeight: '100dvh', background: '#cfcfcf', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      {open ? null : (
        <button type="button" onClick={() => setOpen(true)} style={{ padding: '10px 16px', cursor: 'pointer' }}>
          Open cart
        </button>
      )}
      <CartSidebarView
        {...rest}
        theme={theme}
        open={open}
        lines={lines}
        onClose={() => setOpen(false)}
        onCheckout={() => undefined}
        onRemove={(id) => setLines((ls) => ls.filter((l) => l.id !== id))}
        onUpdateQuantity={(id, quantity) =>
          setLines((ls) => ls.map((l) => (l.id === id ? { ...l, purchaseQty: Math.max(0, quantity) } : l)))
        }
        onWishlistAdd={(view) =>
          setLines((ls) => ls.map((l) => (l.id === view.id ? { ...l, wishlistQty: (l.wishlistQty ?? 0) + 1 } : l)))
        }
      />
    </div>
  );
}

const meta: Meta<DemoArgs> = {
  title: 'Cart/CartSidebar',
  render: (args) => <Demo {...args} />,
  args: {
    themeName: 'noir',
    brandEyebrow: 'Cellar Door',
    title: 'Cart',
    emptyMessage: 'Your cart is empty.',
    browseHref: '#',
    browseLabel: 'Browse wines',
    loading: false,
    mutating: false,
    errorMessage: null,
    initialLines: [cabernet, chardonnay],
    promotions: [],
  },
  argTypes: {
    themeName: { control: 'select', options: Object.keys(exampleCartSidebarThemes) },
    errorMessage: { control: 'text' },
    initialLines: { control: false },
    promotions: { control: false },
  },
};
export default meta;

type Story = StoryObj<DemoArgs>;

// --- States (flip the `themeName` control to preview any state in any theme) ---
export const MultipleItems: Story = {};
export const Empty: Story = { args: { initialLines: [] } };
export const SingleItem: Story = { args: { initialLines: [chardonnay] } };
export const Discounted: Story = { args: { initialLines: [memberDiscount, saleDiscount] } };
export const WishlistMix: Story = { args: { initialLines: [cabernet, atLimit] } };
export const WishlistOnly: Story = {
  args: { initialLines: [byRequest, { ...byRequest, id: 'syrah', title: '2018 Library Syrah', unitPrice: 6400 }] },
};
export const Processing: Story = { args: { mutating: true } };
export const ErrorState: Story = { args: { errorMessage: 'We couldn’t update your cart. Please try again.' } };

// --- Automatic order promotions (cart-level) ---
// Below threshold: a nudge + progress bar at the top of the sheet.
export const PromotionNudge: Story = {
  args: { initialLines: [cabernet, chardonnay], promotions: [freeShipNudge] },
};
// Threshold met: a non-monetary perk line in the footer totals.
export const PromotionApplied: Story = {
  args: { initialLines: sixBottles, promotions: [freeShipApplied] },
};
// Percentage-off applied: a savings amount + "You save" line in the footer.
export const PromotionPercentOff: Story = {
  args: { initialLines: sixBottles, promotions: [bulkApplied] },
};
// Two unmet promotions stack as nudges.
export const PromotionMultipleNudges: Story = {
  args: { initialLines: [cabernet], promotions: [freeShipNudge, bulkNudge] },
};

// --- Per-line member pricing (already modeled; needs a data pipeline) ---
// Struck list price + MEMBER/SALE tag + savings note per line.
export const MemberPricing: Story = {
  args: { initialLines: [memberDiscount, saleDiscount] },
};
// Per-line member pricing + an applied order promotion together.
export const MemberPricingWithPromotion: Story = {
  args: { initialLines: [memberDiscount, cabernet], promotions: [freeShipApplied, bulkApplied] },
};

// --- Theme showcase ---
export const ThemeNoir: Story = { args: { themeName: 'noir', initialLines: [memberDiscount, cabernet] } };
export const ThemeCellarDark: Story = { args: { themeName: 'cellar', initialLines: [memberDiscount, cabernet] } };
export const ThemeTerracotta: Story = { args: { themeName: 'terracotta', initialLines: [memberDiscount, cabernet] } };
export const ThemeLedgerMono: Story = { args: { themeName: 'ledger', initialLines: [cabernet, atLimit] } };
