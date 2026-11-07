# Migrating a site repo onto @pretty-good/storefront-kit

Status: canonical
Owner: Pretty Good engineering
Applies to: winery sites that predate the kit, and kit sites that predate the reference site's practices
Last verified: 2026-10-08
Update trigger: the kit's import surface changes, or the reference site's pipeline, config or test practice changes.

Recipe for converting a pre-kit winery site from forked `src/lib` code to the
shared kit. For everything that is not kit wiring (CI, deploys, build config,
URLs, tests), the **reference site** is the current pattern source: see "Catching
an older site up" at the end and `PLAYBOOK.md`, "Current reference practices".

## 1. Dependency

```jsonc
// package.json dependencies
"@pretty-good/storefront-kit": "file:../winery-kit/packages/storefront-kit"
```

Run `pnpm install` (the kit must already be built: `cd ../winery-kit && pnpm build`).

Add react dedupe to `astro.config.mjs` so the symlinked kit can never pull a
second React copy into islands:

```js
vite: {
  resolve: { dedupe: ['react', 'react-dom'] },
  // ...existing vite config
}
```

## 2. Delete the forked lib code (now in the kit)

Remove these files plus their `.test.ts` siblings:

- `src/lib/cart/` — everything EXCEPT a new `mock.ts` shim (below)
- `src/lib/pdp/purchase-panel-state.ts` (+ test)
- `src/lib/storefront-api/products.ts`, `auth.ts`, `customer-context.ts` (+ tests)
- `src/lib/utm/` (both files + tests)
- `src/lib/money.ts`
- `src/components/cart/headless/`

KEEP (site-specific): `src/lib/storefront-api/config.ts` (the env-reading
shell), `src/lib/site.ts`, `src/lib/queries.ts`, `src/lib/sanity.ts`, mocks,
wine-display helpers, etc.

## 3. Import rewrites

| Old | New |
|-----|-----|
| `…/lib/cart/cart-store`, `cart-types`, `rest-cart-client`, `storefront-api-cart-adapter`, `storefront-api-schemas`, `cart-indicator-state`, `mock-cart-store`, `mock-api` | `@pretty-good/storefront-kit/cart` |
| `…/lib/cart/use-add-to-cart`, `use-cart-store`, `use-cart-indicator`, `use-cart-sidebar` | `@pretty-good/storefront-kit/react` |
| `…/lib/pdp/purchase-panel-state` | `@pretty-good/storefront-kit/pdp` |
| `…/lib/storefront-api/products`, `auth`, `customer-context` | `@pretty-good/storefront-kit/storefront-api` |
| `…/lib/storefront-api/config` | unchanged (stays site-local) |
| `…/lib/utm/core`, `utm/storage` | `@pretty-good/storefront-kit/utm` |
| `…/lib/money` | `@pretty-good/storefront-kit/money` |
| `…/components/cart/headless/CartItemsIndicator` | `@pretty-good/storefront-kit/react` |

## 4. Site shims (imperative shell)

**`src/lib/storefront-api/products.ts`** — keep page call-sites unchanged by
re-exporting kit fetchers bound to site config:

```ts
import {
  createConfiguredStorefrontProductFetchers,
  type FetchStorefrontProductOptions,
} from '@pretty-good/storefront-kit/storefront-api';
import { getStorefrontApiConfig } from './config';

export type { StorefrontProduct, StorefrontProductVariation } from '@pretty-good/storefront-kit/storefront-api';

const productFetchers = createConfiguredStorefrontProductFetchers({
  getConfig: getStorefrontApiConfig,
});

export const fetchStorefrontProductBySlug = (slug: string | undefined, options = {}) =>
  productFetchers.fetchStorefrontProductBySlug(slug, options);
export const fetchStorefrontProductsByWineId = (
  wines: Parameters<typeof productFetchers.fetchStorefrontProductsByWineId>[0],
  options: FetchStorefrontProductOptions = {},
) => productFetchers.fetchStorefrontProductsByWineId(wines, options);
export const isStorefrontProductApiConfigured = productFetchers.isStorefrontProductApiConfigured;
```

**`src/lib/cart/mock.ts`** — mock cart routes shim (configures checkout
destination once, re-exports route helpers):

```ts
import { configureMockCarts } from '@pretty-good/storefront-kit/cart';
import { EXTERNAL_STORE_ORIGIN } from '../site';

configureMockCarts({ checkoutUrl: EXTERNAL_STORE_ORIGIN });

export {
  addMockCartLine,
  getMockCartId,
  getRequestMockCart,
  json,
  readJsonBody,
  removeMockCartLine,
  updateMockCartLine,
} from '@pretty-good/storefront-kit/cart';
```

API routes under `src/pages/api/cart/` import from `…/lib/cart/mock` instead
of `…/lib/cart/mock-api` / `mock-cart-store`.

## 5. UTM continuity (pre-kit sites only)

The kit's default storage key is `pg_utm_v1`; pre-kit sites keep their original
key so returning visitors' attribution survives:

- `UtmCapture.astro` script: `configureUtmStorage({ storageKey: '<brand>_utm_v1' })`
  before `captureUtmFromLocation()`.
- `<BrandCartRuntime>` → kit `CartRuntime` with `utmStorageKey="<brand>_utm_v1"`.

## 6. Cart runtime + events

`<Brand>CartRuntime.tsx` is replaced by the kit's `CartRuntime`
(`@pretty-good/storefront-kit/react`), keeping the site's island mount:

```tsx
import { CartRuntime } from '@pretty-good/storefront-kit/react';
// <CartRuntime client:load storefrontApi={config} utmStorageKey="<brand>_utm_v1" />
```

Window events are standardized: `<brand>:cart-refresh` / `<brand>:cart-open`
become `pg:cart-refresh` / `pg:cart-open`. Grep for the old names (none of the
first three sites dispatched them anywhere).

## 7. Purchase panel → usePurchasePanel

`<Brand>PurchasePanel.tsx` keeps ONLY presentation. All data wiring moves to
the kit hook:

```tsx
const panel = usePurchasePanel({
  storefrontApi,
  variations,
  cartProduct,
  fallbackPriceLabel,
  unitNoun,
  lens: 'retail',            // or 'allocation'
  waitingListHref: ROUTES.waitingList, // allocation lens only
});
// panel.view drives the same JSX as before; panel.selectFormat,
// panel.setCartQuantity, panel.submitAddToCart, panel.openSidebar,
// panel.addLabel, panel.addDisabled replace the local logic.
```

The local `FormatSelector`/`FormatCard`/`PriceSummary`/`QuantityStepper`
subcomponents and all JSX stay byte-identical — only the wiring changes.

## 8. Verify

```bash
pnpm install
pnpm test           # unit tests green
pnpm check          # biome green
pnpm build          # astro build green (needs site env)
pnpm test:stories   # story SSR smoke tests green
```

Grep checklist — all should return nothing:

```bash
grep -rn "lib/cart/cart-store\|lib/cart/use-\|lib/pdp/purchase-panel-state\|lib/utm/\|lib/money\|storefront-api/products'\|storefront-api/auth\|storefront-api/customer-context\|components/cart/headless" src
grep -rn "<brand>:cart-" src
```

## 9. Catching an older site up to the reference site

Sections 1–8 put a site on the kit. A site that already uses the kit but predates
the reference site's practices (2026-10) can differ from it in how it is built,
deployed, routed and tested. Work it as staged PRs, each deployable on its own. If merging
to `main` deploys production, every stage must build and be safe for production,
so safety goes first and anything that changes rendering goes later.

For each stage, diff the site against the reference-site files in the `PLAYBOOK.md`
reference table and copy the file, not the idea. Site-specific differences go in
the site's own docs (`docs/README.md`, `docs/ci.md`), not in the kit docs.

1. **Safety.** CI on PRs to `main` with one aggregate required check, `CI passed`,
   plus a ruleset that requires it. Production deploy gated behind CI, a
   `production` environment and a concurrency group. Sanity token out of the
   bundle (`getSecret`, a Worker secret). Seeds refuse any dataset but `development`
   (dry run by default); migrations require an explicit `--dataset` and, for
   `production`, `--allow-production`; `sanity.cli.ts` defaults to `development`
   (RULES.md Rule 6). Session
   auth only, with `PRIVATE_PG_SECRET` as a runtime Worker secret checked before
   deploy, and the login prefetch guard (`PLAYBOOK.md` §4). Public storefront config in
   repository variables, not in workflows. A build-first `deploy:staging` script
   (`CLOUDFLARE_ENV=staging pnpm build && wrangler deploy --config dist/server/wrangler.json`,
   with the account id set in the script), replacing any `deploy` that skips the build.
   Production deploys only through the workflow: no `package.json` script deploys
   production from a laptop.
2. **Pipeline.** Staging deploys from `main` after CI and production after
   staging (`workflow_call`), `CLOUDFLARE_ENV` on the build step only, the
   worker-config check, the post-deploy smoke, a Storybook deploy, Dependabot,
   CODEOWNERS, a PR template, and a `docs/ci.md` (`PLAYBOOK.md` §5). A pinned
   top-level `account_id` must move to the workflow `env`.
3. **Edge and URLs.** `www` canonical host with the apex redirected by a zone
   rule, canonical from `Astro.site` plus the pathname, `trailingSlash: 'never'`
   with `html_handling: "drop-trailing-slash"`, `robots.txt`, security headers,
   legacy redirects as data, noindex pages without a canonical (`PLAYBOOK.md` §7).
4. **Framework upgrade.** Astro 7 with Vite 8 (they cannot land separately), the
   Cloudflare adapter 14, `@astrojs/react` 6, Vitest 5, Sanity 6 and its client 8.
   Watch for `compressHTML: true`, `astro preview --ignore-lock`, and the
   shell-env-wins workaround for the adapter.
5. **Static rendering** (RULES.md Rule 7). One build-time preview flag; preview
   builds render every route on demand and live builds prerender; no per-request
   preview override (a prerendered page cannot read the query); dynamic pages
   resolve their own params on demand; the problem/route boundary; the empty-page
   guard; the Sanity publish webhook and `content-rebuild.yml`; the parity test.
6. **Tests.** The Playwright contract project in both preview modes, axe a11y
   (report-only), published-routes integrity and loader fail-fast tests
   (`PLAYBOOK.md` §6).
7. **Clean-up** (RULES.md Rule 4). Delete migration and backfill scripts once
   confirmed applied, and replace hand-built store URLs with the kit's
   `buildClubJoinUrl` and `buildBookingUrl`.

Verify each stage with `pnpm build`, `pnpm test`, `pnpm test:stories` and
`pnpm check`, and add the stage's checks to CI in the same PR.
