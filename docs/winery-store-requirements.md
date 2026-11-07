# Winery Marketing Site — Requirements

Canonical requirements for the marketing, content, and commerce features of every winery
site we build. This is the **singular working reference**: when a site feature is added or
changed on any site, update this doc in the same PR. New sites are generated from this doc, not from
reading an existing site's code.

**File paths:** "Reference" lines point to the closest current implementation in a site
repo unless they name a kit package.

**How to use for a new site:** fill in the Per-Site Configuration table, then implement
every section marked *Required*. Sections marked *Optional* ship only if the brand needs them.

---

## 1. Per-Site Configuration

Everything that varies between winery sites. All other behavior in this doc is identical
across sites.

| Parameter | Description | Example |
|---|---|---|
| `{brand}` | Short lowercase brand slug, used in storage/cookie key prefixes | `example` |
| Marketing domain | Where the Astro site is served | `example.com` |
| Store origin | External platform storefront (checkout, hosted auth, club join) | `https://store.example.com` |
| `PUBLIC_PG_STOREFRONT_API_URL` | Public storefront API base | `https://store.example.com/api/public/v1` |
| `PUBLIC_PG_PUBLISHABLE_KEY` | Browser-safe API key | `pgpk_live_…` |
| Sanity project | CMS project ID + dataset | `<project-id>` / `production` |
| Time zone | IANA zone for event/date display and announcement scheduling | `America/Los_Angeles` |
| Brand tokens | Colors, fonts (Tailwind config) | per brand book |
| Lead-capture provider | Newsletter/contact/waiting-list delivery target | per brand |

**Configuration rule:** required provider config is fail-fast. Missing storefront,
Sanity, or conversion-provider env must stop local dev, build, or deploy before the
site can serve a misleading experience. The mock cart is only for explicit tests,
stories, and isolated component development; a winery site must never silently switch
to mock commerce because provisioning is incomplete.

---

## 2. Stack Baseline (Required)

- **Astro**, deployed as a **Cloudflare Worker**. Live builds prerender every page and a CMS
  publish triggers a rebuild; preview builds render on demand; `/api/*` routes are always on
  demand.
- **Sanity CMS** for editorial content; **storefront API** for commerce facts. Never store
  prices/inventory in the CMS as source of truth — CMS price fields are display fallbacks only.
- **Tailwind CSS**, strict **TypeScript**, functional-core/imperative-shell: commerce logic
  in pure modules (`src/lib/…`), side effects at the edges (adapters, API routes, components).
- All storefront API responses validated with **Zod** before use.
- All form/provider inputs validated at the boundary; secrets are read server-side only.

---

## 3. UTM Attribution (Required)

Capture campaign attribution on the marketing site and hand it to the store at checkout
and login, so orders are attributable even though checkout happens on another origin.

**Behavior**
- Capture `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` from the
  URL on **every page load** (a small component included in the base layout).
- **Last-touch attribution:** new UTM params replace the stored set wholesale — never merge
  across campaigns.
- Store in `localStorage` key `pg_utm_v1` as `{ params, capturedAt }` with a **30-day TTL**;
  expired records read as "no attribution". Sites that predate the kit keep their original
  `{brand}_utm_v1` key through `configureUtmStorage` / `utmStorageKey`.
- Storage failures (private mode, disabled storage) degrade silently to no attribution.
- **Forwarding:** append stored params to (a) the checkout redirect URL and (b) the auth
  `return_to` URL, without overwriting params already present on the target URL.

**Reference:** `src/components/UtmCapture.astro`, `src/lib/utm/core.ts`, `src/lib/utm/storage.ts`

---

## 4. Products with Variations (Required)

**Data split**
- **Sanity:** editorial product content (for wines: name, varietal, appellation, tasting
  notes, imagery) plus a `storefrontProductSlug` link field.
- **Storefront API:** commerce facts — product ID, variations, prices (cents), availability.
  Read by hydrated commerce islands using `PUBLIC_PG_STOREFRONT_API_URL` +
  `PUBLIC_PG_PUBLISHABLE_KEY`. The server-rendered HTML uses CMS display facts only.

**Two-template model**
- Every marketing-site product page is backed by a Sanity document: **specialized** pages
  for wines at `/wine/[slug]` and events at `/event/[slug]` (see §13), and the planned
  generic `/product/[slug]` page, which needs a minimal `product` document keyed by
  `storefrontProductSlug` (see `docs/general-product-pages-architecture.md`). A product with
  no CMS document can still sell on the hosted store, but has no marketing page.

**Purchase-state ladder (canonical)**

One pure state machine resolves every PDP purchase panel. It is implemented once, in
`winery-kit/packages/storefront-kit` (`src/pdp/purchase-panel-state.ts`), and consumed
through the `usePurchasePanel` hook and the `@pretty-good/winery-ui` `PurchasePanel`
compound API. Sites pick a **lens**; the lens decides which states are reachable:

| Lens | Model | Reachable states |
|---|---|---|
| `retail` (default) | Public catalog — anonymous visitors can buy | `purchasable` · `in-cart` · `unavailable` · `restricted` · `by-request` · `degraded` |
| `allocation` | Members-only store | `members-only` · `purchasable` · `in-cart` · `not-allocated` · `by-request` · `degraded` |

- `purchasable` — price + enabled add-to-cart. Member pricing swaps in per the pricing
  bullet below.
- `in-cart` — a cart line matches the selected variation: quantity stepper + VIEW CART.
- `unavailable` (retail) — availability affirmatively blocks the purchase (sold out,
  caps): muted price, no enabled purchase CTA; the alternative suggestion (below) fills
  the CTA slot.
- `members-only` (allocation) — anonymous or non-member visitor: price visible,
  waiting-list CTA, never an enabled purchase CTA.
- `not-allocated` (allocation) — member without (or with exhausted) entitlement: muted
  price, explanation copy, no CTA.
- `restricted` (retail) — entitlement-gated wine on a public catalog: visible to
  everyone, purchasable by entitled customers. **The platform decides it**: asserted
  when the availability read (answered for anonymous visitors too) reports
  `status: 'restricted'` (kit `permission: 'restricted'`) for a blocked variation. Sites
  must not supply it from the CMS; the kit's old site-supplied `restricted` input is
  deprecated and only asserts the state when the platform returned no row for the
  variation. Copy is **scarcity-first**
  ("LIMITED ALLOCATION" / "Reserved for select members"), never membership mechanics;
  full-strength price (gated, not gone); sign-in prompt (may reveal availability) +
  club/list CTA; never an enabled purchase CTA.
- `by-request` — the platform wishlist: a **request to purchase that may be approved
  immediately**, not a notify-me list. Asserted from affirmative availability facts
  (`canAddToWishlist` without purchase permission) on either lens, and it outranks the
  unavailable / not-allocated dead ends. Full-strength price, "BY REQUEST" status,
  primary REQUEST TO PURCHASE CTA (a site-supplied link); on approval the panel re-resolves to purchasable.
- **Fractal scarcity status row** — restricted / by-request / members-only render one
  status-row anatomy (eyebrow · divider · cap): the public offer-level cap signed out
  ("LIMIT 6 PER CUSTOMER", "LIMIT 2 REQUESTS PER CUSTOMER", from `publicQuantityLimit` /
  `requestCap` inputs), the personal counter ("4 OF 6 BOTTLES REMAINING") signed in.
- `degraded` — a **first-class designed state**, not an environment fallback: nothing
  blocked the purchase, but the page could not establish that it may be bought — no
  add-to-cart input could be wired (for example, no storefront product or sellable
  variation resolved), or, on the retail lens, the availability read failed. Renders
  the CMS fallback price and a **disabled** "UNAVAILABLE" CTA. Only ever asserted from
  affirmative facts ("no cart product", "availability read failed") — callers that
  don't know assume purchasable.

Precedence — customer-meaningful facts win:
- `in-cart` outranks everything (the line is already held).
- An open request path (`by-request`) outranks the `unavailable` / `not-allocated` /
  `restricted` dead ends.
- Availability facts (`unavailable` / `not-allocated` / `restricted`) outrank the
  `degraded` wiring gap.
- The allocation lens **fails closed**: when a credentialed read fails or hasn't loaded,
  render `members-only` — never fabricate `not-allocated` from missing data.
- The retail lens **fails closed too**: the availability read is what tells a gated wine
  from a purchasable one, so the add-to-cart CTA stays disabled (pending, add label)
  while the read is in flight, and a failed read renders `degraded` (logged) — never
  fabricate purchasability of what may be a gated wine. A loaded read that carries no
  row for the selected variation keeps the public default (purchasable); the platform
  still enforces the gate at cart mutation.

Every reachable state must have a designed render per site (the Pencil per-state mock
sheets). Sites compose `PurchasePanel.States`, whose props are lens-discriminated so
omitting a reachable state is a **compile error**.

**Behavior**
- The server-rendered product page fetches the Sanity document only. The hydrated
  purchase island fetches the storefront product by slug (`GET /products/:slug`) using
  the required public storefront config. If the product read returns no sellable cart
  input, the editorial page remains visible and the panel renders the designed
  **degraded** state (see ladder above).
- Add-to-cart is enabled only when the product resolves and the selected variation has
  a price.
- **All variations are purchasable.** When a product has more than one variation the PDP
  renders a format selector: `variations[]` **array order is the API contract**
  (server-sorted volume-ascending), `unitName` is the card label, `volumeMl` the volume
  line, prices formatted from cents. Single-variation products render the plain price.
- **Customer pricing is promotion evaluation.** The PDP island calls
  `POST /purchase-context` (credentialed, browser-side) and swaps in the pricing
  block's `customerPrice` with struck-through retail and the server-computed
  savings note when a promotion applies. The client never does price math and
  renders `appliedPromotions[].name` verbatim.
- **Club-discount upsell (optional).** Brands that run club discounts may market them to
  non-members on purchasable PDPs: a site-supplied, pre-formatted `clubUpsell` input
  (`{ label?, price?, note?, cta? }`) flows through the kit, which gates rendering —
  purchasable state only, never for active members (they see real promotion pricing),
  and never as a purchase path (add-to-cart stays the primary CTA). Anonymous visitors
  can't call `/pricing/preview`, so the strings come from site/CMS config — the client
  still does no price math. Presentation is brand-chosen from the
  `PurchasePanel.ClubUpsell*` parts: a primary price-row element
  (`label` "CLUB PRICE:" + `price`) or a secondary caption teaser (`note` + club-page
  `cta`). Ships dark until a site passes the input.
- **Customer availability and badges.** The same `purchase-context` response
  drives the unavailable / not-allocated states (muted price, "N OF M BOTTLES REMAINING"
  from `quantityLimit`, release name from `grantContext.name`, no CTA — waitlist/wishlist
  is deferred) and the signed-in member badge (`clubName` rendered verbatim).
- **In-cart state.** A cart line matching the selected variation (`purchaseOptionId`)
  swaps the CTA to a quantity stepper + VIEW CART; `allocation_exceeded` errors carry
  `data.quantityLimit`, which caps the stepper client-side.
- **Alternative suggestion.** When a PDP's wine can't be purchased (no sellable
  storefront product, or the entitlement-gated unavailable state), suggest the best
  alternative as an outline CTA: the most recent current-collection vintage of the same
  wine ("TRY THE 2023 VINTAGE"), else another available wine ("TRY {NAME}"). Candidates
  must be linked to a storefront product; when the page itself is unsellable, the hydrated
  purchase island verifies candidates against the storefront so the CTA never points at another
  dead end.
- **Previous vintages.** The PDP lists up to three earlier vintages of the same wine
  (sibling documents matched by display name). Each entry **links to that vintage's wine
  page**. Earlier vintages are never invented: with no sibling documents, the section
  renders nothing.
- Every credentialed fetch failure degrades to the anonymous retail render; nothing
  blocks page render.
- Add-to-cart input carries `productId`, `purchaseOptionId` (= variation ID), `variantId`,
  `sku`, `quantity`, plus a `display` object (title, unitPrice, imageUrl) used only for
  rendering — never as transaction truth.

**Reference:** `src/pages/wine/[slug].astro`, `src/components/pdp/<Brand>PurchasePanel.tsx`,
`src/lib/wine-display.ts`; the state machine and data wiring live in the kit —
`winery-kit/packages/storefront-kit/src/pdp/purchase-panel-state.ts` (+ retail/allocation
test suites) and `winery-kit/packages/winery-ui` (PurchasePanel compound API);
`docs/storefront-api-pdp-modifications.md` (decision record)

---

## 5. Cart + Cart Sidebar (Required)

**State management**
- A single external cart store (`useSyncExternalStore` pattern) shared by all Astro islands —
  indicator, sidebar, and add-to-cart buttons subscribe to one source of truth.
- Store state: `{ cart, error, isLoading, isMutating, isSidebarOpen }`.
- **No optimistic math:** every mutation returns the full cart snapshot from the API and
  replaces state wholesale.
- Window events for cross-island coordination: `pg:cart-refresh` (refresh) and
  `pg:cart-open` (open sidebar + refresh). These are kit-level event names shared by
  every site; do not brand-prefix new implementations.

**Adapters (swappable at runtime, identical interface)**
1. **Mock adapter** (explicit tests, stories, and isolated component development only):
   Astro API routes under `/api/cart/*`, identity via `pg_mock_cart_id` cookie (path=/, lax,
   30-day).
2. **Storefront API adapter** (every winery site): activated by the `client:load`
   `CartRuntime` component from the required public config; calls the platform public v1
   cart endpoints with an
   `X-Cart-Token` header. Token created lazily via `POST /carts` and persisted in
   `localStorage` (`wine_turbo_public_cart_token`). `credentials: 'omit'` on cart calls.

**Cart contract** (normalized across adapters)
- `CartSnapshot`: `{ id, currency: 'USD', itemCount, subtotal (cents), checkoutUrl, lines, updatedAt }`
- `CartLine`: `{ id, productId, purchaseOptionId?, variantId?, sku?, title, quantity, unitPrice (cents), imageUrl? }`

**Sidebar behavior**
- Opens automatically on add-to-cart success; stays open on errors with a retry affordance.
- Quantity update and line removal mutate via the adapter and re-render from the returned snapshot.
- Errors render inline in the sidebar (typed error payload, see §9); recoverable errors keep
  buttons enabled for retry.

**Reference:** `packages/storefront-kit/src/cart/` (store, types, adapters), `src/components/cart/`,
`docs/themeable-component-template.md` (presentation layer)

---

## 6. Checkout (Required)

- Triggered from the cart sidebar. Flow: read stored UTM → `POST /checkout/session`
  (body may include `{ utm }`) → receive `{ checkoutUrl, sessionId }` → redirect via
  `window.location.href = appendUtmToUrl(checkoutUrl, utm)`.
- Checkout happens entirely on the **store origin** — the marketing site never handles
  payment, shipping, or compliance.
- On failure: surface `checkout_unavailable` in the sidebar, keep it open, allow retry.

---

## 7. Login / Auth (Required)

**Model: hosted OTP on the store origin + a site-domain session.** The marketing site never
handles credentials. The store runs the OTP form; the site exchanges the resulting
authorization code server-side and keeps the tokens sealed in its own HttpOnly cookie, so
the browser talks only to same-origin endpoints: no publishable key, no cross-site cookie,
no CORS. The kit's `customer-auth` module owns the protocol; each site owns the
`/api/auth/*` and `/api/store/*` endpoints and the cookie.

**Behavior**
- **Start login:** every sign-in link is the site's own `/api/auth/login`, reached by
  top-level navigation (not fetch, and never prefetched). The endpoint mints a CSRF nonce
  and redirects to `{API}/auth/login?return_to={callback}&key={publishableKey}&response_type=code`
  (`getAuthorizationUrl`). `{callback}` is a bare URL with no query of its own. The site's
  own `return_to` must carry stored UTM (see §3) so attribution survives the round trip.
- **Callback:** after OTP the store redirects to `{callback}?code={code}&status=success`.
  The callback rejects a failure (`readCallbackError`), then exchanges the code server-side:
  `POST {API}/auth/token` with `Authorization: Bearer {secret key}` and
  `{ grantType: 'authorizationCode', code }`. The secret key (`pgsk`) is required and the
  publishable key is rejected. The response is `{ accessToken, expiresAtEpochMs, refreshToken }`
  with no customer object: the display identity is decoded from the access JWT, for the
  account UI only and never for authorization.
- **Session storage:** `sealSession` seals the token bundle with AES-256-GCM, keyed from a
  site secret, into the site's own HttpOnly cookie. `unsealSession` reads it back; a tampered
  or undecryptable cookie is no session.
- **Session read:** the browser client (`createSessionAuthClient`) calls `GET /api/auth/session`
  with `credentials: 'same-origin'` → `{ status: 'authenticated', customer: { id, firstName?, email? } }`
  or `{ status: 'anonymous' }`.
- **Refresh:** server-side only. Within 60 seconds of expiry the session endpoint calls
  `POST {API}/auth/token` with `{ grantType: 'refreshToken', refreshToken }` and reseals the
  cookie. A browser-initiated refresh is a session re-read.
- **Customer-scoped reads:** credentialed commerce reads go through the same-origin
  `/api/store/*` proxy, which attaches `getServerHeaders({ customerToken })`: the secret key
  as `Authorization: Bearer` and the access token as `x-customer-token`. Pass that proxy as
  `customerContextApi` on `CartRuntime`; the cart adapter keeps its direct base.
- **Logout:** `POST /api/auth/logout` clears the session and returns the anonymous view.
- `/sign-in` is the page a failed round trip lands on, not the entry point.
- Any auth error degrades silently to anonymous — never block page render on auth.

The secret key is a runtime server secret (`PRIVATE_PG_SECRET`), never a build variable or a
`PUBLIC_` value. The cross-origin `createStorefrontAuthClient` remains exported for older
sites; new sites use session auth only.

**Reference:** `packages/storefront-kit/src/customer-auth/`, `src/pages/api/auth/`,
`src/pages/api/store/[...path].ts`

---

## 8. Header: Login State + Cart Indicator (Required)

- Header/nav renders **anonymous by default** (SSR), then a client script checks the session
  and progressively upgrades:
  - Elements tagged `data-auth-signin-label` swap text "SIGN IN" → "ACCOUNT" (and aria-label).
  - Elements tagged `data-auth-anonymous-only` (e.g., "Create Account") are hidden.
  - Applies across all nav surfaces: desktop nav, mobile menu, mobile tab bar.
- **Cart indicator:** hydrated island in the header showing item count badge (capped display
  at "99+"); subscribes to the cart store; click opens the sidebar.
- Auth check failures leave the default anonymous header — no errors surfaced.

**Reference:** `src/components/NavBar.astro`, `src/components/cart/<Brand>HeaderCartIndicator.tsx`

---

## 9. Storefront API Contract (Required)

**Endpoints** (base = `PUBLIC_PG_STOREFRONT_API_URL`)

```
POST   /carts                        create anonymous cart → { cartToken, draftId }
GET    /carts/current                read cart (X-Cart-Token)
POST   /carts/current/items          add { productVariationId, quantity }
PATCH  /carts/current/items/:id      update { quantity }
DELETE /carts/current/items/:id      remove line
POST   /checkout/session             start checkout { utm? } → { checkoutUrl, sessionId }
GET    /products/:slug               product + variations + prices
POST   /purchase-context             pricing + customer availability + memberships (credentialed PDP read)
POST   /pricing/preview              promotion-evaluated customer pricing (credentialed)
POST   /availability/customer        per-variation availability status + limits (credentialed)
GET    /memberships                  non-cancelled club memberships (credentialed)
GET    /auth/login?return_to=&key=&response_type=code   hosted OTP (top-level navigation, not fetch)
POST   /auth/token                   code exchange + refresh (site server, secret key only; see §7)
```

**Headers**
- Browser: `X-Publishable-Key`, `Accept: application/json`; cart identity via `X-Cart-Token`.
- Site server: `Authorization: Bearer {secret key}`; customer scope via `x-customer-token`.

**Error code mapping** (normalized `CartErrorCode`, with `{ code, message, status?, recoverable? }`)

| API condition | Code |
|---|---|
| 401 | `authentication_required` |
| 403 | `item_unavailable` |
| 404 | `cart_unavailable` |
| `data.reason: exceeds_limit` (carries `data.quantityLimit`) | `allocation_exceeded` |
| `data.reason: insufficient_stock` or `out_of_stock` | `item_unavailable` |
| `data.reason: invalid_request` | `invalid_quantity` |
| checkout 4xx / validation failure | `checkout_unavailable` |
| network/other | `cart_request_failed` |

4xx bodies carry a machine-readable `data.reason` — map it exactly (table above); a
message-substring fallback (stock/quantity/limit keywords) is retained only for
transition. `exceeds_limit` also includes `data.quantityLimit { limit, redeemed,
available }`, surfaced on the normalized error payload so the PDP stepper can cap
quantity client-side. Zod-validation failures are non-recoverable
(`recoverable: false`); everything else defaults to recoverable.

---

## 10. Wine Club (Optional — ship if brand has a club)

- CMS-managed club page (e.g., `/clubs`): benefits, how-it-works steps, Join CTA.
- **No in-site signup:** the Join CTA links to `{store origin}/clubs`. Membership, billing,
  and club pricing are the store's responsibility. There is no static `clubPrice` field on
  products — member pricing on product pages is promotion evaluation via
  the pricing block in `POST /purchase-context` (or `POST /pricing/preview` for
  narrower callers; see §4 and `docs/storefront-api-pdp-modifications.md`).

**Reference:** `src/pages/clubs.astro`, `src/lib/site.ts`

---

## 11. CMS Page Model, Navigation, and Site Settings (Required)

Every site has CMS-managed site identity, navigation, SEO metadata, and the page documents
needed for its active information architecture. Route names and page composition vary by
brand, but the source-of-truth split is standard: content in Sanity, commerce facts in the
storefront API, route constants in code.

**Site-wide documents**
- `siteSettings`: site name, tagline, logos, social links, contact email/phone, address,
  hours or hours line, default SEO fields, default share image, and Twitter/X handle.
- `navigation`: main navigation and footer navigation arrays using explicit internal or
  external links. Only implemented routes may be linked; external links must declare whether
  they open in a new tab.
- `seo` object: `metaTitle`, `metaDescription`, `ogImage`, `noIndex`. Values are rendered
  1:1; fallback/default composition is materialized in content or seed/backfill scripts, not
  guessed at render time.

**Page documents**
- Required baseline: homepage, wines/acquire listing, wine detail content, privacy, sign-in,
  404, robots, and sitemap.
- Brand-model pages: story/about, visit/tasting-room, contact/connect, wine club, waiting
  list, library/archive, ranch/hospitality, and events. Ship the pages that match the brand's
  active routes; do not add placeholder nav items for routes not implemented in code.
- Page documents carry brand copy, images with alt text, Portable Text bodies where needed,
  CTA labels/URLs, success/error copy for forms, and page-level SEO.

**Behavior**
- Base layout fetches `siteSettings` + `navigation` and renders header, mobile nav, footer,
  cart runtime, UTM capture, SEO head, and preview indicator.
- Missing optional CMS fields render as absent UI, not placeholder copy. Missing required
  launch content is a content QA issue, not a runtime exception.
- Per-brand route constants own canonical paths, sitemap static paths, and legacy redirects.

**Reference:** `schemas/siteSettings.ts`, `schemas/navigation.ts`, `schemas/pages/*`,
`src/layouts/BaseLayout.astro`, `src/lib/site.ts`

---

## 12. SEO, Indexing, Structured Data, and Preview (Required)

- The `<head>` renders CMS SEO values 1:1: title, description, `noIndex`, Open Graph,
  Twitter card, canonical URL, and page-supplied JSON-LD.
- Canonical URLs and `og:url` must strip tracking/click params (`utm_*`, `_gl`, `gclid`,
  `gbraid`, `wbraid`, `fbclid`, `msclkid`, `mc_cid`, `mc_eid`, `igshid`). Attribution is
  captured by §3, never leaked into canonical/share URLs.
- Site settings generate `Winery` and `WebSite` JSON-LD. Specialized pages add structured
  data at the page layer: wines add `Product` + breadcrumb JSON-LD; events add `Event` +
  breadcrumb JSON-LD.
- `robots.txt` allows indexing and points at `/sitemap.xml`.
- `sitemap.xml` includes all static routes configured for the site plus non-hidden Sanity
  wine/event detail pages. Hidden content is excluded. Event index routes may stay out of
  the sitemap until at least one event is authored.
- **Sold-out / unavailable detail pages stay linked and indexed.** A product or event being
  sold out (or otherwise unpurchasable) mutes its price/CTA but must never drop the
  list-card link to its detail page, remove the page from the sitemap, or `noIndex` it —
  only `hidden` does that. The winery's own product page must stay internally linked and
  crawlable so it ranks when someone searches for that wine, rather than ceding the result
  to a marketplace (e.g. wine.com). A sold-out state is a display change, not a delisting.
- Preview mode enables Sanity Visual Editing and a visible preview indicator without
  changing the public render for non-preview requests.

**Reference:** `src/components/SEOHead.astro`, `src/lib/seo/structured-data.ts`,
`src/pages/robots.txt.ts`, `src/pages/sitemap.xml.ts`, `src/components/PreviewModeIndicator.astro`

---

## 13. Events + Ticketed Experiences (Optional — ship if brand has events)

Events are a standard winery feature: dinners, pickup parties, tastings, collaborations,
release parties, and club/member gatherings. A site can market an event without selling
tickets, link to an external ticket host, or sell tickets on-site through the same purchase
panel/cart plumbing as products.

**Content model**
- `eventsPage`: SEO, heading, intro.
- `event`: internal name, display name, slug, image + alt, `eventDate`, optional `endDate`,
  location, status (`upcoming` / `past` / `hidden`), optional `sortOrder`, short
  description, Portable Text details, price label, optional numeric price, optional
  `storefrontProductSlug`, optional `externalTicketUrl`, optional `ticketCtaLabel`,
  editorial `soldOut`, and SEO.
- Event date/time rendering must use the site's configured IANA time zone; Cloudflare
  Workers may run outside the winery's local zone.

**Listing behavior**
- `/events` lists all non-hidden events, partitioned into upcoming and past. Upcoming/past is
  derived from the end date/date, with explicit status override; past events render most
  recent first.
- `hidden` suppresses the event from listings, detail fetches, and sitemap entries.
- Manual `sortOrder` wins before date ordering for upcoming events.
- List cards may show editorial sold-out only when no storefront product is linked. If a
  storefront product is linked, live store availability is authoritative. A sold-out card
  still links to the event detail page (§12) — attendees rely on it for details/directions,
  and the page must stay crawlable.

**Detail behavior**
- `/event/[slug]` redirects to the events index when the event does not exist or is hidden.
- CTA resolution ladder:
  1. `storefrontProductSlug` present: render the brand purchase panel with `unitNoun="ticket"`
     and a CMS display seed; live product IDs, SKU, price, and availability come from the
     storefront API.
  2. No storefront product, not sold out, `externalTicketUrl` present: render an external
     ticket/RSVP link with `rel="noopener noreferrer"`.
  3. No storefront product and `soldOut`: render sold-out status and a muted display price.
  4. No purchase path: render event content and any display price without a CTA.
- Event detail pages emit `Event` JSON-LD and breadcrumb JSON-LD using UTM-free canonical
  URLs.

**Reference:** `src/pages/events.astro`, `src/pages/event/[slug].astro`,
`schemas/event.ts`, `src/lib/event-display.ts`

---

## 14. Lead Capture (Optional — ship if brand has a capture surface)

Newsletter, contact/connect, and waiting-list forms are first-class marketing surfaces.
They must be validated and attributable even when the final delivery provider is not
decided at build time.

**Behavior**
- Forms post JSON to same-origin Astro API routes; invalid JSON or schema failures return
  400 with a short machine-readable or display-safe message.
- Submissions include stored UTM params from §3 when available.
- Provider secrets are server-only. Missing provider config fails fast at startup/build
  for any form that is rendered as active. A temporary logging/no-op provider is allowed
  only when it is explicitly configured as the provider for a pre-launch site; it must
  still return a clear success or `not_configured` response and log loudly.
- Provider failures distinguish permanent rejection from retryable/provider errors where the
  provider exposes enough status to know.
- Successful responses must not expose provider internals or secrets.

**Current form models**
- Newsletter: first name, last name, email, UTM.
- Contact/connect inquiry: first name, last name, email, optional message, UTM.
- Allocation waiting list: email, optional first name, optional last name, optional referral
  ("Who can we thank?"), UTM. Mailchimp delivery uses server-side upsert and merge fields
  for referral and campaign attribution.

**Reference:** `src/pages/api/newsletter.ts`, `src/pages/api/connect.ts`,
`src/pages/api/waitlist.ts`, `src/lib/forms/*`, `src/lib/waitlist/submission.ts`

---

## 15. Announcements (Required)

Every winery needs timely, low-friction announcements: release windows, pickup parties,
tasting-room closures, weather/shipping holds, holiday deadlines, new events, and club
updates. This is required platform capability even when a launch has no active
announcement.

**Content model**
- CMS-managed announcements with: title or short message, optional body, optional CTA label
  + URL, placement (`global` at minimum; page-specific placements optional), severity/style
  (`standard`, `urgent`, `success`), `startsAt`, `endsAt`, `priority`, `dismissible`, and
  enabled/disabled status.
- Announcements are brand content, not commerce truth. They may link to products, events,
  clubs, or the store, but prices, inventory, eligibility, and checkout availability still
  come from the storefront API.

**Behavior**
- Zero active announcements renders nothing.
- Active announcements are selected by enabled status, schedule window, and priority. Schedule
  evaluation uses the site's configured time zone.
- The global announcement renders on every public page above or within the header without
  blocking navigation, auth upgrade, cart hydration, or preview mode.
- Dismissible announcements persist dismissal per announcement ID in localStorage using a
  `{brand}_announcement_dismissed_v1`-style key. Non-dismissible urgent announcements stay
  visible until disabled or expired.
- Announcement links use normal internal/external link rules; external links declare new-tab
  behavior and never receive secrets.

**Reference:** no shared implementation yet. The closest shipped precursor is a homepage
`hero.announcement` field; the cross-site model above is the standard.

---

## 16. Maintenance Rules

1. **Same-PR rule:** any change to a site feature on any winery site updates this doc in
   the same PR.
2. Keep this doc at the **requirements/contract level** — behavior, param names, endpoints,
   error codes. Implementation detail lives in the reference repo and feature decision
   records (e.g., `docs/storefront-api-pdp-modifications.md`).
3. Brand-specific values never appear outside §1 and "Reference" lines — use `{brand}` /
  `{store origin}` placeholders everywhere else.
