# Storefront API Modifications — PDP Purchase States

_Changes to the platform's public storefront API (`/api/public/v1`, the "client
site API") needed to implement the PDP (product detail page) purchase states.
The current contract is §9 of
[winery-store-requirements.md](./winery-store-requirements.md); everything here is
**additive** to that contract. Money is integer cents throughout; percentages are
integer **basis points** (`2000` = 20%), matching platform conventions._

Status: **platform side implemented** — shapes below are the real wire contract,
verified against the implementation. **Client adoption (§6) is implemented** (PDP
purchase panel island, see `src/components/pdp/<Brand>PurchasePanel.tsx` in a site
repo), and the behavior is promoted into
`winery-store-requirements.md` §4/§9 per the same-PR rule.

**Vocabulary** (verified against the platform):

- **Entitlement** — a customer's right to purchase (or wishlist) a product variation,
  optionally quantity-limited (`quantityLimit`, redemptions). This is the platform term
  for what the mock's display copy calls "allocation".
- **Allocation** — on the platform this means **payment allocations** (payment-to-order
  ledger entries). Never use "allocation" for purchase limits in API or code identifiers.
  (The mock's on-screen "ALLOCATION" label is design copy and may be revisited.)
- **Promotions are the pricing model** — there is exactly one price per variation
  (`product_variations.price`); every customer-visible discount is an active
  **promotion** evaluated against the customer's context (club memberships,
  customer lists, dates, cart contents). The `DiscountSource` values
  `manual | loyalty | club | employee` are **staff-applied at order time** and can
  never appear on a product page — PDP custom pricing is promotion evaluation,
  nothing else.
- **`clubPrice` never existed.** No `clubPrice` (or `memberPrice`) field has ever
  been sent by the platform — those fields in our client Zod schema
  (`src/lib/storefront-api/products.ts`) are dead code and must be deleted, not
  preserved. There is no second static price to be backward-compatible with.
- **Memberships are plural** — a customer holds at most one active membership per club
  but any number across clubs (unique index on `(customerId, wineClubId)` where
  `status != 'cancelled'`). Membership surfaces are arrays.
- **Club → release naming**: new fields use club-agnostic terms; no new `club*`
  identifiers beyond `clubId`/`clubName` (which name the actual wine-club aggregate).

---

## 1. Why

The mock introduces capabilities the current marketing-site contract does not cover:

| Mock scenario | Gap (corrected against the real API) |
|---|---|
| 02, 05, 06, 07 — format selector | **Mostly existed**: `GET /products/{slug}` has always returned `variations[]` (`id`, `price`, `sku`, `isDefault`, `unitName`) — our client only consumed `defaultVariation`. Platform added `volumeMl` + deterministic ordering (M1) |
| 01, 05, 06 — "YOUR PRICE" member pricing | Real gap. New `POST /pricing/preview` (M2) — pricing is **not** embedded in the product read, which stays anonymous and cacheable |
| 01, 05, 06 — "SIGNED IN · ALLOCATION MEMBER" badge | Real gap. New `GET /memberships` (M3) — **not** added to `/auth/session`, which stays a fast JWT-only check |
| 04 — "0 OF 6 BOTTLES REMAINING" | **Already fully implemented**: `POST /availability/customer` resolves the signed-in customer's availability when called with credentials. Client adoption only (M4) |
| 04 — "JOIN WAITLIST" CTA | **Deferred** — see §4 |

Scenario 03 (already in cart) needs **no API change** — see M6.

## 2. Data Flow

Anonymous rendering uses CMS display data in SSR, then the purchase island reads the
storefront product with the publishable key. Customer context is a **browser-side
progressive enhancement**, because it depends on the signed-in visitor's session and
cannot be part of an anonymous render.

```
SSR (Astro worker)                     Browser (PDP island, credentialed)
  |                                      |
  | Sanity wine/event/page data          | GET  /products/:slug             (M1 variations)
  | CMS display price fallback           | POST /pricing/preview           (M2 prices)
  |                                      | POST /availability/customer (M4 limits)
  v                                      v   X-Publishable-Key + credentials: 'include'
+--------------------------- storefront API ---------------------------+
| anonymous:       product + variations[] (retail), public promotions, |
|                  guest entitlements                                  |
| authenticated:   + member promotion pricing, customer entitlements,  |
|                  memberships                                         |
+----------------------------------------------------------------------+
```

If a credentialed fetch fails, the PDP fails closed (§7): it never fabricates a
purchasable state for what may be an entitlement-gated wine.

---

## 3. Modifications

### M1 — Variation volume + ordering on product read (shipped platform-side)

`GET /products/{slug}` has always returned `variations[]` alongside
`defaultVariation`. The shape, with the added `volumeMl`:

```jsonc
{
  "id": "prod_123",
  "slug": "example-cabernet",
  "name": "Example Cabernet",
  "imageUrl": "…",
  "defaultVariation": { /* same shape as a variations[] entry */ },
  "variations": [
    {
      "id": "var_demi",
      "price": 3000,          // cents — the ONE price; custom pricing is M2
      "sku": "EXC22-375",
      "isDefault": false,
      "unitName": "Demi",     // the unit's display name — the format-card label
      "volumeMl": 375         // numeric volume in milliliters (always present)
    }
    // … bottle, magnum
  ]
}
```

Contract notes (deliberate non-additions):

- **Array order is the contract**: server-sorted volume-ascending (default
  variation first on ties). There is no `sortOrder` field — render in array order.
- **One display name**: `unitName` IS the format label (`product_units.name`,
  e.g. "Demi", "Bottle", "Magnum"). There is no second `name` field.
- **No `clubPrice`** — see vocabulary. Customer pricing comes from M2.
- **No `available` flag**: the product read is static/cacheable. Live sellability
  comes from `GET /inventory/stock?variationIds=…` (stock) and
  `POST /availability/customer` (status + limits), read by the purchase island
  and revalidated by cart/checkout mutations.
- **No per-variation publishing exists** in the platform (publishing is
  product-per-site); every variation of a published product is returned.

Covers scenarios 02 and 07; combined with M2 it covers 05 and 06.

### M1a — Product options on product read (shipped platform-side, adopted 2026-09)

Non-wine products (merch) vary by **options** rather than unit/volume. The
product read carries `options[]` (each `{ id, name, position, values: [{ id,
optionId, value, position }] }`), and every variation carries `title`,
`derivedTitle` and `optionValues: [{ optionId, optionValueId }]`. A merch
variation has `unitName: null`, `volumeMl: null`, `derivedTitle: "Navy + Mesh"`
(or `"XS / blue"` for two options); a wine has `options: []` and variations
with `title: "750"`, `unitName: "750 mL bottle"`. A multi-option product may be
a partial grid — not every combination has a variation.

Kit contract (`storefront-kit/pdp`, `purchase-panel-state.ts`):

- **Label precedence**: a variation with non-empty `optionValues` is named
  `(unitName ?? derivedTitle ?? title ?? '')` uppercased; every other
  variation keeps the `unitName`-only label (`(unitName ?? '')` uppercased),
  so wines keep "750 ML BOTTLE" rather than their `title` "750".
- **`view.options`** (`PurchaseOptionView[]`) is present only when the product
  has at least one option — options ordered by `position`, values by
  `position`. Each value is `{ id, label, selected, available }`: `selected`
  when the selected variation carries it; `available` when some variation
  carries it, so every variation stays reachable on a partial grid (choosing
  a value may change the other options through the resolver's fallback).
- **`view.formats` is `undefined` whenever options exist** — the option groups
  replace the flat format list. Products without options (and variations
  without `optionValues`) render exactly as before. Custom panels that render
  `view.formats` themselves show no selector for an option product until they
  adopt `view.options`.
- **Summary**: an option product is captioned like a multi-format product —
  the summary's `hasFormats` is true when options exist, so the selected
  variation's name captions the price (no "/ bottle" unit layout in cart).
- **Selection**: `resolveVariationForOptionValue(variations, selectedId,
  optionId, optionValueId)` prefers the variation matching the current
  selection with that value swapped, else the first variation carrying the
  value, else `undefined`. The `usePurchasePanel` hook exposes it as
  `selectOptionValue(optionId, optionValueId)` (a no-op on `undefined`), and
  winery-ui renders it as `PurchasePanel.OptionSelector` — one
  `role="radiogroup"` per option, unavailable values disabled.
- **Cart-line title**: the cart normaliser (`storefront-kit/cart`,
  `normalizeStorefrontCartResponse`) titles a line from the platform's
  `storedName` (its composed display name: `"2022 Estate Reserve Magnum 1.5 L"`
  for a wine, `"Anniversary Logo Hat — Black"` for an option
  variation — product name, em dash with spaces, label) when non-blank, else `name` + `unitName` as before — merch
  lines have `unitName: null`, so without `storedName` they would show only
  the product name. Line `optionValues` is not read (its merch shape is
  unverified). The optimistic line the PDP adds before the cart read returns
  matches: for an option product `display.title` is the CMS title, `" — "`
  (U+2014 with spaces, the platform's line-name separator), then the selected
  variation's label (same precedence as above, not uppercased; multi-option
  `derivedTitle` is already `" / "`-joined) —
  `buildStorefrontCartProduct` labels the default variation and
  `buildSelectedCartInput(base, variation, pricing, productTitle)` re-titles
  for the selection; products without options keep the bare CMS title.

### M2 — Customer-resolved pricing: `POST /pricing/preview` (shipped platform-side)

A sibling endpoint to `/availability/customer`, NOT a change to the product read
(which stays byte-identical for every caller and cacheable):

```jsonc
// POST /pricing/preview   { "variationIds": ["var_demi", "var_bottle"] }
{
  "pricing": [
    {
      "variationId": "var_bottle",
      "retailPrice": 5200,           // cents — what anonymous visitors pay
      "customerPrice": 4160,         // cents — this caller's effective price
      "savings": {                   // null ⇔ no price-affecting promotion
        "amount": 1040,              // cents
        "basisPoints": 2000          // 2000 = 20% (platform percent convention)
      },
      "appliedPromotions": [
        {
          "id": "promo_member",
          "name": "Allocation Member Discount",  // server-owned display string
          "description": "20% off"               // generated effect description
        }
      ]
    }
    // … one entry per KNOWN variation id; unknown ids are omitted
  ]
}
```

Contract notes:

- `customerPrice` is computed by evaluating the **same active promotions checkout
  applies** (club-member, customer-list, date-range, cart-total conditions),
  against a quantity-1 context — so it always agrees with `POST /checkout/quote`
  for a single-item cart. This is shared code on the platform, not a parallel
  price system.
- Credentialed calls resolve the customer's club memberships and lists; anonymous
  calls still work and reflect **public** promotions (a sitewide sale shows the
  discounted price to everyone).
- There is no `DiscountSource` on the wire: promotions are the only pre-order
  discount mechanism (see vocabulary). Badges/tooltips render
  `appliedPromotions[].name` (and optionally `description`) **verbatim** — the
  client never infers copy, and never does price math (`savings` is
  server-computed), consistent with the cart's "no optimistic math" rule.
- Shipping-only promotions (free shipping etc.) never appear here — only
  price-affecting ones.
- Powers "YOUR PRICE" and the dual-price format cards (scenarios 01, 05, 06).
  Quantity limits are **not** part of this block — they come from entitlements (M4).

### M3 — Memberships: `GET /memberships` (shipped platform-side)

A separate credentialed read, NOT an extension of `/auth/session` — the session
check is a JWT-only verification that runs on every page view and stays DB-free.
(Also note: the session endpoint is `GET /auth/session`, not POST.)

```jsonc
// GET /memberships   (credentials: 'include')
{
  "memberships": [
    {
      "id": "wcm_abc",
      "clubId": "club_123",
      "clubName": "2022 Allocation",   // the wine club's name — render verbatim
      "status": "active"               // 'active' | 'paused' | 'hold_manual'
    }
    // … one entry per non-cancelled membership
  ]
}
```

Contract notes:

- Only non-cancelled memberships are returned; cancelled ones are omitted rather
  than flagged.
- Anonymous callers get `{ "memberships": [] }` — no error, no auth gate.
- The badge renders `clubName` verbatim for v1. A configurable badge label
  (e.g. "Allocation Member") is **deferred** — no such concept exists in the
  domain yet; when wineries need badge copy distinct from the club name it will
  be an admin-configurable club field, still server-owned.
- Fetch once after sign-in (or on first page load with a session) and cache
  client-side; memberships change rarely.

### M4 — Customer-scoped availability — **no API change**

`POST /availability/customer` **already** resolves the authenticated customer's
availability when called with the customer's credentials, falling back
to guest/universal availability for anonymous callers. The earlier "needs
customer-scoped resolution" claim described our client usage, not the server.
Response shape per variation:

```jsonc
{
  "availability": [
    {
      "productVariationId": "var_bottle",
      "status": "available",              // 'available' | 'sold_out' | 'restricted' | 'by_request'
      "canAddToCart": true,
      "canAddToWishlist": false,
      "quantityLimit": {                   // null = unlimited/ungoverned
        "limit": 6,
        "redeemed": 6,
        "available": 0
      },
      "grant": { "name": "2022 release", "endsAt": null }
    }
  ]
}
```

Scenario 04 renders "0 OF 6 BOTTLES REMAINING" from `quantityLimit` and the
release name from `grant.name`. `quantityLimit.available === 0` or
`status: 'sold_out'` triggers the **unavailable** purchase state preemptively.
`status: 'by_request'` routes to the request/wishlist state, and
`status: 'restricted'` (entitlement-gated for this visitor, anonymous included) to
the retail **restricted** state. The kit normalizes this wire vocabulary to its panel
model (`permission` + `grantContext`; `available`→`purchase`, `by_request`→`wishlist`,
`restricted`→`restricted`, `sold_out`→`unavailable`) at the storefront boundary.

### M5 — Structured cart error codes — mostly existed; `quantityLimit` added

Cart-mutation 4xx responses have always carried a machine-readable code in
`data.reason` — the message-sniffing in `storefront-api-cart-adapter.ts` was
never necessary and should switch to mapping `data.reason` directly. The wire
shape (oRPC error body):

```jsonc
// 400 on POST /carts/current/items when the add would exceed the entitlement
{
  "code": "BAD_REQUEST",
  "message": "Maximum available: 6",
  "data": {
    "reason": "exceeds_limit",       // 'exceeds_limit' | 'insufficient_stock'
                                     //   | 'out_of_stock' | 'invalid_request'
    "quantityLimit": {               // NEW — present only on 'exceeds_limit'
      "limit": 6,
      "redeemed": 6,
      "available": 0                 // how many the customer may still hold
    }
  }
}
```

Contract notes:

- The code is `exceeds_limit` (shipped reason value), not `entitlement_exceeded`.
  The client maps it onto its existing normalized `CartErrorCode`
  `'allocation_exceeded'` (the adapter's substring match on `'limit'` already
  does this; switch to an exact match on `data.reason`).
- `data.quantityLimit` mirrors M4's block exactly and is **new** — it lets the
  PDP stepper cap the quantity instead of bouncing off the server. It appears on
  `exceeds_limit` from add, update, and bulk-update cart mutations.
- Entitlement-gated "not purchasable at all" remains `403 FORBIDDEN` (unchanged).

### M6 — Cart line variation echo (no change — contract confirmation)

Scenario 03 ("already in cart") is derived entirely client-side: the PDP matches its
variation IDs against `CartSnapshot.lines[].purchaseOptionId`, which is normalized from
`productVariationId` on cart lines. Confirmed and now **pinned by a platform
router test** — cart lines keep exposing `productVariationId`. Quantity changes
from the PDP stepper reuse `PATCH /carts/current/items/{itemId}`.

### M7 — Combined customer-context read: `POST /purchase-context` (shipped)

The PDP island now uses one credentialed request per page instead of separately
calling `pricing/preview`, `availability/customer`, and `memberships`:

```jsonc
// POST /purchase-context   { "variationIds": [...] }
{ "pricing": [...], "availability": [...], "memberships": [...] }
```

One round trip reaches the correct customer state, one failure path drives the
designed anonymous/member-only degradation, and the individual endpoints remain
for narrower callers.

---

## 4. Deferred — Waitlist / Wishlist (scenario 04 CTA)

The mock's "JOIN WAITLIST →" CTA is **deferred**. Scenario 04 renders without the
join CTA (muted price + explanatory note only).

## 5. Scenario Coverage Matrix

| Scenario | M1 | M2 | M3 | M4 | M5 | M6 |
|---|---|---|---|---|---|---|
| 01 Custom pricing — member | | ✓ | ✓ | | | |
| 02 Multiple formats | ✓ | | | | | |
| 03 Already in cart | | | | | ✓ | ✓ |
| 04 Entitlement exhausted (mock: "Allocation Unavailable") | | | ✓ | ✓ | ✓ | |
| 05 Custom price per format | ✓ | ✓ | ✓ | | | |
| 06 Custom price in summary | ✓ | ✓ | ✓ | | | |
| 07 Two formats — equal cards | ✓ | | | | | |

(Scenario 04's join-waitlist CTA is deferred — see §4.)

## 6. Client-Side Work — implemented

1. **`src/lib/storefront-api/products.ts`** — consumes the full `variations[]` +
   `volumeMl`/`unitName`/`isDefault` in array order; dead `clubPrice`/`memberPrice`
   schema fields deleted.
2. **`src/lib/storefront-api/customer-context.ts`** — credentialed
   `POST /purchase-context` fetcher for pricing, customer availability, and
   memberships in one round trip; narrower fetchers remain for focused callers.
   Every failure degrades to `null`, which the panel renders fail-closed (§7).
3. **PDP island** — `src/components/pdp/<Brand>PurchasePanel.tsx` (imperative shell)
   over the pure view-model core `src/lib/pdp/purchase-panel-state.ts`: format
   selection, member pricing swap from `purchase-context`, entitlement-driven
   unavailable state from `availability`, in-cart detection via the cart store on
   `purchaseOptionId`, stepper wired to cart line updates. The static
   `PdpPurchasePanel.astro` components remain as the Storybook mock catalog.
4. **`src/lib/cart/storefront-api-cart-adapter.ts`** — maps `data.reason` exactly
   (substring fallback retained only for transition); surfaces
   `data.quantityLimit` on the normalized error payload to cap the PDP stepper.
5. **Badge** — `clubName` rendered verbatim from `purchase-context`.
6. Shipped behavior promoted into `winery-store-requirements.md` §4/§9 (same PR).

## 7. Degradation Rules

Consistent with the existing requirements doc:

- Anonymous → retail prices from the product read, no savings UI, no badge; the
  availability block still applies, so an entitlement-gated wine renders `restricted`.
- `purchase-context` fails → retail lens renders `degraded` (CMS price, disabled CTA,
  logged), allocation lens renders `members-only`. Neither fabricates purchasable. While
  the read is in flight the retail CTA stays disabled with the add label.
- Empty memberships → plain signed-in (or anonymous) state.
- Customer entitlement availability gaps still get enforced server-side at
  cart-add time via M5 error mapping.
- Wishlist/waitlist deferred → scenario 04 renders price muted + explanatory note, no CTA.
- Nothing above may block page render.
