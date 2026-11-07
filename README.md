# winery-kit

Shared libraries, components, and docs for Pretty Good winery websites. This is
the breakout home for everything that was previously forked verbatim across the
per-winery site repos.

## What lives here

| Path | Purpose |
|------|---------|
| `packages/storefront-kit` | `@pretty-good/storefront-kit` — Storefront API clients (products, auth, customer context), cart store + adapters, the unified PDP purchase-panel state machine (retail + allocation lenses), UTM attribution, and headless React components/hooks |
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

## Standard cross-site conventions

- Cart events: `pg:cart-refresh`, `pg:cart-open` (window CustomEvents any
  script can dispatch; the kit cart store listens).
- Mock cart cookie: `pg_mock_cart_id`.
- UTM storage key: `pg_utm_v1` (pre-kit sites keep their original key via
  `configureUtmStorage` / the `utmStorageKey` prop on `CartRuntime`).
- Customer commerce context: `POST /purchase-context` batches pricing,
  availability, and memberships for visible PDP variations.
