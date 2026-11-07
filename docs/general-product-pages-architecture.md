# General Product Pages Architecture

This note records the decision for how winery sites sell products that are not wines —
tickets, merchandise, events, gift items — before we know how each winery wants to brand or
categorize them.

Status: **specialized event page + `/events` listing shipped (2026-06-16), promoted to
`winery-store-requirements.md` §13.** The generic `/product/[slug]` fallback remains
revised but unimplemented.

## Problem

Wineries will inevitably sell more than wine. We cannot predict the taxonomy ("tickets" vs
"experiences" vs "events"), the navigation placement, or the page design each winery will
want. Waiting to model all of that before anything is sellable blocks revenue; modeling it
prematurely bakes in a taxonomy wineries will fight against. At the same time, winery
marketing sites have a hard boundary: server-rendered page data comes from the CMS, and
storefront reads happen only in hydrated commerce islands.

## Prior Art: The Shopify Model

Shopify solved exactly this problem, and its shape is worth copying. It decouples
**purchasable** from **branded** with four layers:

1. **One canonical generic product page.** Every product — wine, ticket, hoodie, gift card —
   lives at `/products/{handle}` and renders through a single default template: title,
   media, price, variant selector, description, add-to-cart. The moment a product exists in
   the admin, its page exists. No per-product page building.
2. **Alternate templates as opt-in specialization.** Merchants create named templates (e.g.
   `product.wine`) and assign them per product. Specialization is additive on top of a
   working default, never a prerequisite for selling.
3. **Loose categorization, decided later.** Products carry free-form tags and types;
   collections layer merchandising and branding on after the catalog exists. Products never
   need a category to be sellable.
4. **Metafields for type-specific data.** Schema extensions (tasting notes, event dates,
   size charts) are added when a product type proves it needs them, not designed up front.

## Where We Already Are

The commerce layer is already fully generic. `StorefrontProduct`,
`StorefrontProductVariation` (`src/lib/storefront-api/products.ts`), and the cart contract
(`AddToCartInput`, `CartLine` in `src/lib/cart/cart-types.ts`) carry no wine semantics, and
the storefront endpoint is `GET /products/:slug`, not `/wines/:slug`. Wine specialization
lives entirely in the Sanity `wine` schema and `src/pages/wine/[slug].astro`.

In Shopify terms: we built the `product.wine` alternate template first and never built the
default template. This decision adds the default template.

## Revised Architecture

### Generic route: `/product/[slug]`

A single product route that preserves the current site boundary: server-rendered HTML
uses a CMS `product` document, while live commerce data is resolved by the hydrated
purchase island from the storefront API using the publishable key. It renders:

- CMS name, image, description, and display price/copy. There is no server-side
  storefront read and no JSON-LD commerce offer emitted from CMS display price.
  Customer-resolved pricing comes from `POST /purchase-context` exactly as on the
  wine PDP (see `docs/storefront-api-pdp-modifications.md`).
- default variation add-to-cart through the existing cart store and adapters
  (`src/lib/cart/`) — no cart changes required
- the standard unavailable/disabled add-to-cart fallback when the product or price does not
  resolve

**A CMS product document is required for the marketing site route.** A product created
only in the source system can still sell on the hosted store, but it does not create a
server-rendered marketing page until the CMS has at least a minimal product document
keyed by `storefrontProductSlug`.

### CMS product model (future)

A thin `product` document keyed by `storefrontProductSlug` should carry the generic
page's server facts: title, description/body, image, display price/copy, SEO, and
optional links/classification. This schema is **not** being added now; it gets designed
when the first winery asks for editorial control over a non-wine product page.

### Specialized templates stay specialized

`/wine/[slug]` is unchanged. Wines keep their Sanity-first editorial pages (varietal,
appellation, tasting notes, winemaker quote).

New specialized pages follow the same escalation path. Example: an event selling 100
tickets that deserves its own custom event page gets a bespoke layout, but reuses the
existing purchase plumbing as-is: CMS event data for SSR, then the purchase island
fetches the storefront product by slug and wires add-to-cart through the cart store
(`src/lib/cart/`, `src/components/cart/`). A custom page costs only design and layout
work; the buy logic is already componentized.

**Dedup rule:** a storefront product that has a matching Sanity `wine` document canonically
lives at its wine URL. The generic page must 301 to the specialized page when one exists,
so two URLs never compete for the same product.

### Template resolution

```
      GET /product/[slug]
               |
               v
+-----------------------------+
| Matching Sanity product or  |
| specialized document?       |
+--------------+--------------+
               |
          +----+-------------------+
          |                        |
   specialized                 generic product
          |                        |
          v                        v
+-------------------+   +---------------------+
| 301 redirect to   |   | Render generic      |
| /wine/[slug] or   |   | product template    |
| /event/[slug]     |   | from CMS data       |
+-------------------+   | + purchase island   |
                        +---------------------+
```

## Deferred, With Triggers

Each deferred piece has a concrete condition that promotes it to active work:

| Deferred                       | Build it when…                                          |
| ------------------------------ | ------------------------------------------------------- |
| Multi-variant selector UI      | first merch with sizes/colors                           |
| Product listing/discovery page | Shipped — `/events` listing (2026-06-16); see §13       |
| Per-type routes (`/tickets/…`) | a winery's branding explicitly demands type URLs        |
| Type-specific fields/layouts   | a product type needs data the generic page can't show   |
| Taxonomy (`productType`)       | merchandising/navigation needs grouping, not before     |

## Explicitly Not Decided Now

- Product taxonomy or category names — wineries tell us, we don't guess.
- Navigation placement for non-wine products.
- Listing-page design (the "collections" equivalent).

## References

- `docs/winery-store-requirements.md` §4 (product data split)
- `src/lib/storefront-api/products.ts` — generic product fetch, reused as-is
- `src/lib/cart/` — cart contract and adapters, reused as-is
- `src/pages/wine/[slug].astro` — the existing specialized template
