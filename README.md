# winery-kit

Shared libraries, components, and docs for Pretty Good winery websites. This is
the breakout home for everything that was previously forked verbatim across the
per-winery site repos.

## What lives here

| Path | Purpose |
|------|---------|
| `packages/storefront-kit` | `@pretty-good/storefront-kit` — Storefront API clients (products, auth, customer context), cart store + adapters, the unified PDP purchase-panel state machine (retail + allocation lenses), UTM attribution, top-of-funnel analytics (Amplitude), and headless React components/hooks |
| `packages/winery-ui` | `@pretty-good/winery-ui` — presentational components over the headless hooks (PurchasePanel). Structure + behavior shared; ALL visual styling injected per-brand via `classes` slot maps. `react` and `@pretty-good/storefront-kit` are PEERS so the site's cart-store singleton is shared — never list them as deps |
| `docs/` | Canonical cross-site docs: `winery-store-requirements.md`, `storefront-api-pdp-modifications.md` (the Storefront API wire contract), product page architecture, themeable component conventions |
| `PLAYBOOK.md` | The end-to-end playbook for onboarding a new winery website |

## Principles

- **Headless by design.** The kit owns behavior — state machines, data
  fetching, cart orchestration (`usePurchasePanel`, `useCartStore`, …) — and
  never renders brand markup. Each winery keeps its own presentation layer
  (panel layouts, buttons, type, spacing) over the same hooks, because display
  requirements differ per brand (e.g. a stacked full-width add-to-cart vs an
  inline price bar — same hook, different JSX).
- **Functional core, imperative shell.** The kit is pure/parameterized: it never
  reads `import.meta.env` or hardcodes a brand. Each site keeps a thin shell
  (`src/lib/storefront-api/config.ts`) that reads its env and injects config.
- **Lenses, not forks.** Commerce differences between wineries are modeled as
  configuration (`lens: 'retail' | 'allocation'`, waitlist hrefs, unit nouns),
  not divergent copies of the state machine.
- **Required config fails fast.** Missing commerce config is a provisioning error,
  not a runtime mode. Runtime commerce-data failures degrade to designed
  anonymous/unavailable states.

## Consuming from a site repo

Site repos are siblings of this folder and consume the kit via `file:` deps:

```jsonc
// package.json
"dependencies": {
  "@pretty-good/storefront-kit": "file:../winery-kit/packages/storefront-kit"
}
```

Build the kit before installing/building a site:

```bash
cd winery-kit && pnpm install && pnpm build
```

Versioned releases are also published as GitHub Release tarballs that a site can
install by URL with no token. See [`docs/releasing.md`](docs/releasing.md) for
how to cut a release, install, upgrade and develop against a local kit.

### Keeping `dist/` fresh in dev

Sites consume the kit as built `dist/`, not source. So **editing kit `src/`
without rebuilding leaves a site running against stale `dist/`.** The failure is
nastier than a missed change: a stale/rebuilt dist churns the consuming site's
Vite **optimized-deps** hash, so an already-served island chunk imports
`…/.vite/deps/@pretty-good_winery-ui.js?v=<old-hash>` which now **404s**. The
dynamic import fails, the React island never hydrates, and any SSR-rendered
button silently does nothing (this is exactly how the PDP "add to cart" went
inert). Console shows: `Failed to fetch dynamically imported module`.

- **Watch (preferred):** `cd winery-kit && pnpm build:watch`, so `src/` edits
  recompile `dist/` and the site's HMR picks them up.
- **Unblock a stuck session:** rebuild the kit (`pnpm build`) and/or clear the
  site's optimizer cache, then restart its dev server:
  `rm -rf <site>/node_modules/.vite`.

## Commands

```bash
pnpm build   # build all packages (tsc)
pnpm test    # run all package tests (vitest)
pnpm check   # biome lint + format check
pnpm docs:check # cross-repo docs and story-contract checks
```

## Documentation

The documentation model is layered:

- `RULES.md` — invariants every winery site must obey.
- `PLAYBOOK.md` — repeatable onboarding/build/launch process.
- `docs/winery-store-requirements.md` — canonical commerce contract.
- `docs/documentation-strategy.md` — docs lifecycle and ownership rules.
- `docs/releasing.md` — cutting releases and installing them in a site.

## Storybook

`packages/storefront-kit` ships a React Storybook for the kit's presentational
components (currently `CartSidebar`). It's a React-Vite Storybook — the right
home for these React components, since the *sites'* Storybook is Astro-SSR and
can't render the kit's React islands.

```bash
cd packages/storefront-kit
pnpm storybook        # dev server on :6066
pnpm build-storybook  # static build → storybook-static/ (gitignored)
```

Stories live outside `src/` (in `stories/`) so they're never compiled into
`dist`. `CartSidebar.stories.tsx` covers every state (empty, discounted,
wishlist mix, wishlist-only, processing, error) and renders the pure
`CartSidebarView`, so no cart store is needed. Flip the `themeName` control — or
open a `Theme…` story — to preview any state across the reference themes in
`src/react/cart-sidebar-example-themes.ts` (`noir`, `cellar`, `terracotta`,
`ledger`). Those are **prototyping presets, not the production site themes** —
copy one into a new site's `CartSidebarTheme` and retune.

**Building the next themeable component?** Follow
[`docs/themeable-component-template.md`](docs/themeable-component-template.md) — the
reusable View/Theme/Storybook conventions, with `CartSidebar` as the worked example.

## Analytics (Amplitude)

`@pretty-good/storefront-kit/analytics` sends a fixed top-of-funnel schema to
the winery's own Amplitude project (one project, one browser API key, per
winery). Purchases and orders are out of scope.

| Event | Fired by | Properties (besides `site` and the acquisition properties below) |
|-------|----------|-----------------------------------------------|
| `page_viewed` | the site, via `trackPageView()` | `path` (no query string) |
| `product_viewed` | `usePurchasePanel` (PDP) or `usePurchaseAction` (product card), once per mount, when its product has resolved and half of the `viewRef` element has been on screen | `surface` (`page` from the panel, `card` from a card), `product_slug`, `product_name`, `price_cents` |
| `product_added_to_cart` | `useAddToCart`, after a successful add | `product_slug`, `product_name`, `price_cents`, `quantity` |
| `checkout_started` | `useCartSidebar().checkout` (the `CartSidebar` button) | `cart_item_count`, `cart_subtotal_cents` |

Money is always integer cents.

Every event also carries the visitor's stored last-touch acquisition from
`captureUtmFromLocation` (see [UTM attribution and referrer](#utm-attribution-and-referrer-utm)),
reported unchanged (RULES.md §3):

| Property | When | Value |
|----------|------|-------|
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` | the touch had that UTM | as captured |
| `referrer_domain` | the touch had an external referrer | its hostname only, e.g. `www.google.com` (never a full URL) |
| `channel` | always | `paid`, `email`, `social`, `search`, `referral`, `campaign` or `direct` |

`channel` comes from `classifyChannel` (`/utm`). UTMs win over the referrer:

| `channel` | From UTMs (`utm_medium`, case-insensitive) | Else from the referrer hostname (and its subdomains) |
|-----------|--------------------------------------------|------------------------------------------------------|
| `paid` | `cpc`, `ppc`, `paid*` (`paidsocial`, `paid_social`, …), `display`, `cpm` | — |
| `email` | `email`, `e-mail`, `newsletter` | webmail: `mail.google.com`, `outlook.live.com`, `outlook.office.com`, `mail.yahoo.com` |
| `social` | `social`, `social-media`, `organic_social` | `facebook.com`, `instagram.com`, `t.co`, `x.com`, `twitter.com`, `linkedin.com`, `lnkd.in`, `pinterest.*`, `pin.it`, `reddit.com`, `tiktok.com`, `youtube.com`, `threads.net`, `bsky.app` |
| `search` | `organic` | `google.*`, `bing.com`, `duckduckgo.com`, `yahoo.*`, `ecosia.org`, `baidu.com`, `yandex.*`, `search.brave.com`, `startpage.com` |
| `referral` | `referral` | any other external site |
| `campaign` | any other UTM, or UTMs without `utm_medium` | — |
| `direct` | — | no stored acquisition |

`brand.*` matches the brand under a short country or generic suffix
(`www.google.co.uk`, `yahoo.co.jp`), not `google.example.com`. The lists are data
in `src/utm/channel.ts`.

`product_viewed` counts wines the visitor saw, not panels or cards that
mounted: a one-page site mounts every wine's panel on load, and a shop page
mounts every card. Attach the hook's `viewRef` to the element that shows the
wine: the panel (winery-ui's `PurchasePanelRoot` does this for you) or the
whole card, not just its button. A card's view waits for its `input`; a panel's
waits for the product read. Anything with nothing attached reports no views,
so a shop card that never attaches `viewRef` drops out of the funnel at
`product_viewed` even when it adds to cart.

1. Install the optional peer in the site: `pnpm add @amplitude/analytics-browser`.
   Sites that never import `/analytics` don't need it and ship none of it.
2. Initialize in the site layout's `<head>`, so it runs before islands emit
   (events tracked before `initAnalytics` is called are dropped; events tracked
   while the SDK loads are queued):

   ```astro
   <script>
     import { initAnalytics, trackPageView } from '@pretty-good/storefront-kit/analytics';

     void initAnalytics({ apiKey: import.meta.env.PUBLIC_AMPLITUDE_API_KEY, site: 'paco' });
     // Client Router sites: astro:page-load fires on the first load and every
     // navigation. Without the Client Router, call trackPageView() once instead.
     document.addEventListener('astro:page-load', trackPageView);
   </script>
   ```

An unset `PUBLIC_AMPLITUDE_API_KEY` turns analytics off (every `track` is a
no-op); a key set to an empty string throws, because that is a provisioning
mistake. The SDK starts cookie-light: autocapture and remote config off,
identity in localStorage, no IP address on events. A failed SDK load warns once
and drops events; analytics never breaks commerce.

### First-party endpoint (`serverUrl` + `/analytics-proxy`)

Ad and DNS blockers filter `api2.amplitude.com`, so a blocked visitor's events
never arrive. To avoid that, the SDK posts to the site's own origin and a site
endpoint forwards the upload to Amplitude.

`initAnalytics` takes an optional `serverUrl`: a same-origin path (`/api/e`),
resolved against the page's origin, or an absolute `https://` URL. Anything else
throws. Leave it unset to post to Amplitude directly.

`@pretty-good/storefront-kit/analytics-proxy` is server-only and never loads the
SDK. It exports `forwardToAmplitude(request, { serverZone?, fetch? })`, which
posts the body to Amplitude's HTTP V2 API (`api2.amplitude.com`, or
`api.eu.amplitude.com` for `serverZone: 'EU'`) and returns Amplitude's status
and body. The upstream is fixed, so the endpoint can't be used as an open proxy.
Only the JSON body is sent upstream: no cookies, client headers or IP. It answers
405 (with `Allow: POST`) to other methods, 415 to a body that isn't uncompressed
JSON, 413 to one over Amplitude's 1 MB limit, 400 to invalid JSON, and 502 when
Amplitude can't be reached.

On Astro with the Cloudflare adapter, add an on-demand endpoint:

```ts
// src/pages/api/e.ts
import { forwardToAmplitude } from '@pretty-good/storefront-kit/analytics-proxy';
import type { APIRoute } from 'astro';

export const prerender = false;
export const POST: APIRoute = ({ request }) => forwardToAmplitude(request);
export const ALL: APIRoute = ({ request }) => forwardToAmplitude(request); // 405
```

Then pass `serverUrl: '/api/e'` to `initAnalytics`. Use a neutral path: blocker
lists match words like `analytics`, `amplitude`, `track` or `collect`. Use the
same `serverZone` in both calls.

Location comes from Cloudflare, at city level. Through the endpoint, the upload
request's IP is the Worker's, not the visitor's, so the forwarder adds the
visitor's `country` (English name), `region` and `city` from `request.cf` to each
event that doesn't already have them, and strips any `ip` from events (the SDK
sends none, because `trackingOptions.ipAddress` is false). Coordinates, postal
code and DMA aren't sent. No visitor IP is sent to Amplitude or stored. Amplitude
doesn't document whether these fields win over its own lookup of the request IP,
so check a staging event's location before relying on it.

## UTM attribution and referrer (`/utm`)

`captureUtmFromLocation()` runs on every page (the site's `UtmCapture.astro`) and
stores the visitor's **last-touch acquisition** in localStorage: the landing's
`utm_*` params and its **external referrer's hostname**. `forwardUtmToLinks` and
the cart's checkout carry the stored UTMs to the store (RULES.md §3); analytics
reports the whole record on every event.

- **A new touch** is a landing with UTMs or an external referrer. It replaces the
  stored record wholesale, keeping both when both arrived, so a later Google or
  press visit replaces last month's email UTMs. A landing with neither (direct,
  or navigation within the site) keeps the stored record. Records expire after
  30 days.
- **The referrer is reduced to its hostname** (lowercase, no path, query or port)
  and is ignored when it is internal: the page's own host, any host on the same
  site domain (the last two labels: `www.pacowinery.com` and
  `store.pacowinery.com` are both `pacowinery.com`), or a configured internal
  host. The two-label rule ignores the public suffix list, so on a `.co.uk`-style
  domain every `*.co.uk` site counts as internal; list hosts explicitly there.
- **Brand hosts on other domains** (a store on the platform's domain, an auth
  host) must be listed, or a visitor coming back from them reads as a referral
  and loses their UTMs:

  ```ts
  configureUtmStorage({
    storageKey: 'paco_utm_v1', // optional; default pg_utm_v1
    internalHosts: [EXTERNAL_STORE_ORIGIN], // origins or hostnames
  });
  ```

  Each option you pass replaces its current value and the ones you leave out
  keep theirs, so a later `configureUtmStorage({ storageKey })` (e.g. from
  `CartRuntime`) doesn't clear `internalHosts`. An entry that is neither a
  hostname nor an origin throws. Existing `configureUtmStorage({ storageKey })`
  calls need no change and capture referrers automatically.
- `document.referrer` is read on the **first capture of a document** only: under
  the Client Router it keeps the landing's value through client-side
  navigation, so re-reading it would start a new touch on every page.
- Stored shape (same key, same TTL): `{ params, referrerDomain?, capturedAt }`,
  e.g. `{"params":{},"referrerDomain":"www.google.com","capturedAt":"…"}` for a
  referrer-only touch. Records written before referrer capture (params only)
  read unchanged; older kits read a referrer-only record as no attribution.
- Readers: `readStoredUtm()` returns the stored UTM params or null (also null for
  a referrer-only touch), as before. `readStoredAcquisition()` returns
  `{ utm, referrerDomain }` (both null when there is none), and
  `classifyChannel(acquisition)` its channel.

Limitations: in-app browsers (Instagram, Facebook, TikTok) and email apps often
send no referrer, so without UTMs those visits read as `direct`; tag links you
control. Google and most sites send only their origin (the default
`strict-origin-when-cross-origin` policy), which is all the hostname needs, but
never the search terms.

## Standard cross-site conventions

- Cart events: `pg:cart-refresh`, `pg:cart-open` (window CustomEvents any
  script can dispatch; the kit cart store listens).
- Mock cart cookie: `pg_mock_cart_id`.
- UTM storage key: `pg_utm_v1` (pre-kit sites keep their original key via
  `configureUtmStorage` / the `utmStorageKey` prop on `CartRuntime`).
- Customer commerce context: `POST /purchase-context` batches pricing,
  availability, and memberships for visible PDP variations.
