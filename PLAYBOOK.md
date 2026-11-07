# Winery Website Playbook

Status: canonical
Owner: Pretty Good engineering
Applies to: all winery sites; one designated reference site is the current pattern for pipeline, config and tests
Last verified: 2026-10-08
Update trigger: the reference site's build, deploy, URL or test practice changes, or a rule in `RULES.md` changes.

The repeatable process for taking a winery from "signed" to "live website on the
Pretty Good platform." Grounded in the first production sites (retail, allocation
club, club-first, hospitality with a large catalog, and two brands with a
per-product lens) and designed to scale to the next 10–20 wineries.

Every site is: **Astro 7 + @pretty-good/storefront-kit + Sanity + Tailwind 4,
deployed as a Cloudflare Worker** (`@astrojs/cloudflare` 14). Live builds are
**static** (every page prerendered; a Sanity publish triggers a rebuild); preview
builds (staging, local dev) render **on demand** so Studio Presentation is live.
Only the `/api/*` routes are always on demand. The site talks to the platform's
public Storefront API (`/api/public/v1`) from the browser, with hosted-checkout
handoff. Older sites may still be Astro 6 SSR; `docs/site-migration.md` ("Catching an older site up") is the path.

---

## 0. Intake — decide the product lens

One conversation with the winery decides most of the build. Capture it in
`docs/<brand>-store-requirements.md` (fork `docs/winery-store-requirements.md`,
keep the same section numbering).

| Lens | Who it fits | Kit configuration |
|------|-------------|-------------------|
| `retail` | Public catalog, anyone can buy; optional club discounts | `usePurchasePanel({ lens: 'retail' })` |
| `retail` + club-first IA | Small catalog, club is the hero product | retail lens, club-forward pages |
| `allocation` | Members-only purchasing, waitlist, entitlements | `usePurchasePanel({ lens: 'allocation', waitingListHref })` |
| `retail` + hospitality | Tasting room/tours drive revenue; wines + experience products | retail lens + tastingExperience content type |
| `retail` + `allocation` per product | Two brands in one org; some wines allocated; club joins and tasting bookings on the hosted store | `lens` chosen per product (`<Brand>PurchasePanel`); `buildClubJoinUrl` / `buildBookingUrl` for hosted joins and bookings |

Also capture: brand voice & design tokens (`docs/design-system.md`,
`docs/brand-voice-messaging.md`), product catalog source (existing site,
WineDirect/Vinoshipper export, spreadsheet), club structure, fulfillment
constraints, and which decisions are open (number them D1, D2, … and resolve
them in the doc as they're decided).
Create or update `docs/README.md` in the site repo so these docs are indexed by
status (`site-delta`, `working-plan`, `exploration`, `archive`). Follow
`docs/documentation-strategy.md` for lifecycle fields and update rules.

## 1. Platform provisioning (Pretty Good admin)

1. Organization exists (or create it) — note org id/slug.
2. Default brand exists.
3. Confirm product **units** (Bottle 750ml, Magnum, …; service unit for
   experiences).
4. Seed the **catalog**: one product per wine (slug `2023-cabernet` style);
   bottle formats are *variations on one product*, never separate products
   (e.g. a wine's bottle + magnum). Service products for tastings/tours
   with `duration`. Publish each product to the site.
5. **Site + domain**: a site record with the store domain
   (e.g. `store.example.com`) — this hosts the
   public API, hosted login, and hosted checkout.
6. **API key** (admin UI): create the publishable
   key (`pgpk_live_…`, allowed origins = every marketing-site origin: production
   `www`, staging, `*.workers.dev` fallbacks, local dev). Server-rendered data
   still comes only from Sanity, and commerce islands read the storefront with the
   publishable key. Session auth (§4) additionally needs the store's **secret**
   key (`pgsk`) as `PRIVATE_PG_SECRET`: a runtime **Worker secret**
   (`wrangler secret put PRIVATE_PG_SECRET --name <worker>`), never a build
   variable, a GitHub variable or `PUBLIC_`. It serves only the `/api/auth/*` and
   `/api/store/*` routes, so RULES.md Rule 1 (no Store API during SSR) is
   unaffected. Until the publishable key exists, local dev, build and deploy fail
   fast (§3); mock commerce exists only in stories and tests.

## 2. Sanity provisioning

```bash
npx sanity init -y --bare --project-name "<Winery Name>" --organization <org-id> --dataset production
```

Record the project id. Schemas live in the site repo (`schemas/`), forked from
the existing site closest to the lens. Workflow after any schema change:

```bash
npx sanity schema deploy && pnpm sanity:deploy --yes && pnpm typegen
```

Seed content with `scripts/seed-sanity.ts`. The reference site runs it as a plain `tsx` script
(`"seed": "tsx scripts/seed-sanity.ts"`), **dry run by default**:

```bash
pnpm seed                                  # dry run against development; prints the plan, writes nothing
pnpm seed --apply --dataset development    # writes
```

It needs an editor-role Sanity token in `SANITY_PROJECT_API_TOKEN` (falling back
to `SANITY_API_READ_TOKEN`, which can only write if it was given the editor role),
read from `.env` (never logged) or the exported environment; create it at
`sanity.io/manage/project/<id>/api`. It errors without one, even for a dry run. After
writing, it re-reads the dataset with **no** token and requires every planned
document to come back, which catches path-scoped `_id`s that only a token can see.
A seed is a fixture loader for `development` only: it `createOrReplace`s documents
and may delete editor-created ones (`--prune-orphans`), so it refuses every other
dataset outright, dry run included, and never inherits `SANITY_DATASET` (reference site:
`scripts/seed/options.ts`, with a unit test; RULES.md Rule 6). `sanity.cli.ts` defaults the CLI dataset to `development` for
the same reason. `production` content is edited in Studio; a script under
`scripts/migrate/` exists only to reshape documents after a schema change, and is
deleted once applied.

## 3. Scaffold the site repo

Fork the existing site repo closest to the lens, and take the workflows, build
config and tests from the reference site (see "Current reference practices"
below), which is ahead of the others on all three. Then:

1. Rebrand identifiers: package name, worker names in `wrangler.json`,
   `src/lib/site.ts` (`SITE_ORIGIN`, `EXTERNAL_STORE_ORIGIN`, `ROUTES`),
   Sanity project id, `.env.template`.
2. The kit comes via `"@pretty-good/storefront-kit": "file:../winery-kit/packages/storefront-kit"` —
   build the kit first (`cd ../winery-kit && pnpm install && pnpm build`).
   Keep `vite.resolve.dedupe: ['react', 'react-dom']` in astro.config.mjs.
3. Site-local shims stay thin (this is the whole architecture):
   - `src/lib/storefront-api/config.ts` — reads `PUBLIC_PG_*` env
   - `src/lib/storefront-api/products.ts` — uses
     `createConfiguredStorefrontProductFetchers` to bind site config onto kit fetchers
   - `src/lib/cart/mock.ts` — `configureMockCarts({ checkoutUrl: EXTERNAL_STORE_ORIGIN })`
4. New sites use the standard storage keys (`pg_utm_v1` etc.). Never fork kit
   code into the site; if the kit is missing something, extend the kit.

### Design system

Each winery gets a real design system, not a reskin: palette + type +
texture rules documented in `docs/design-system.md` before building pages.
(Compare a burgundy fine-wine serif look, monochrome zero-radius minimalism,
earthy warmth, and a ledger-style serif and mono look.) Distinctiveness comes from typography,
spacing, and one signature device — not from changing component behavior.

### Required config fails fast (non-negotiable)

Missing commerce env, Sanity env, or active form-provider env must stop local dev,
build, or deploy before the site serves misleading content. The kit mock cart exists
for explicit tests, stories, and isolated component development only; winery sites
must not silently switch to mock commerce because provisioning is incomplete.
RULES.md Rule 5 is the invariant; this is what the reference site does about it:

- **Build config throws.** `astro.config.mjs` resolves `SANITY_PROJECT_ID`,
  `SANITY_DATASET`, `PUBLIC_PG_STOREFRONT_API_URL`, `PUBLIC_PG_PUBLISHABLE_KEY`
  and `PUBLIC_STORE_ORIGIN` with a `requireEnv` that throws naming the variable;
  runtime modules do the same through `requireConfig` (`src/lib/config.ts`). No
  defaults for any of them.
- **Customer auth is session auth, with no mode switch.** A site that still
  carries `PUBLIC_PG_AUTH_MODE` must make it required with no default and build
  `session` everywhere (CI, preview, prototype), then delete the flag and the
  cross-origin `direct` model. It needs `PRIVATE_PG_SECRET` as a runtime Worker
  secret (§1); the deploy refuses a Worker without it (§5). The session flow is
  `docs/winery-store-requirements.md` §7 (reference site:
  `src/lib/storefront-api/browser-auth.ts`, `src/pages/api/store/[...path].ts`).
- **Seeds and scripts never default to production** (§2, RULES.md Rule 6).
- **An empty prerendered page fails the build.** A throw in a page body is logged
  by the prerenderer, which then writes a zero-byte `index.html` and exits 0.
  the reference site's `<site>:fail-on-empty-pages` integration (`astro:build:done`) turns that
  into a failed build naming the pages; throw from `getStaticPaths` where there
  is one.
- **The Sanity read token is a runtime secret.** Read it with `getSecret` from
  `astro:env/server` (reference site: `src/lib/sanity.ts`), never `import.meta.env`, which
  Vite inlines into any bundle that ships on-demand pages. The production build
  gets no token at all.
- **Editorial gaps follow the same rule:** a required field empty in a draft shows
  a problem block in a preview build and throws in a production build
  (reference site: `src/lib/problems.ts`, `src/lib/content/route.ts`).

## 4. Commerce integration checklist

- [ ] PDP renders from `usePurchasePanel` view model — all states for the lens
      (retail: purchasable / in-cart / unavailable; allocation: members-only /
      purchasable / in-cart / not-allocated)
- [ ] Multi-format wines show the FormatSelector (server-sorted variations);
      products with options (merch Color, Size) show the kit's `OptionSelector`.
      Compose both; the kit renders at most one
- [ ] Cart sidebar, header indicator, add-to-cart all driven by kit hooks
- [ ] Checkout hands off to the hosted checkout URL (with UTM appended)
- [ ] Sign-in: every "Log in" link is the site's own `/api/auth/login`
      (`ROUTES.login`), which 302s to the hosted OTP form; the callback exchanges
      the code and lands the customer on the hosted account. `/sign-in` survives
      only as the page a failed round trip lands on. No `direct` cross-origin mode
- [ ] **Never prefetch `/api/*`.** `prefetchAll` is fine for pages but
      `/api/auth/login` mints a CSRF nonce per GET, so a prefetch can overwrite the
      nonce of a login in progress in another tab. Every anchor that can carry an
      endpoint href sets `data-astro-prefetch` from `prefetchAttr(href)` (reference site:
      `src/lib/site.ts`), and the route answers a prefetch request (`Sec-Purpose`,
      `Purpose` or `X-Moz` containing `prefetch`) with `204` and no cookie
- [ ] Club-join and booking links come from the kit's `buildClubJoinUrl` and
      `buildBookingUrl` (`@pretty-good/storefront-kit/links`), never a hand-built
      store URL; club and experience slugs are CMS content. The same builders
      produce legacy-URL redirect targets
- [ ] Sanity `wine.storefrontProductSlug` matches the platform product slug
      for every purchasable wine
- [ ] Required `PUBLIC_PG_*`, Sanity, and active provider env verified before deploy

## 5. Deploy

The reference site's pipeline is the pattern; its `docs/ci.md` is the runbook and
the workflow files are the source of truth. Paths in this section are relative to
that site's checkout.

**Accounts and config**

- **The winery owns a Cloudflare account** and every Worker (production, staging,
  Storybook) lives on it. The account id is pinned in each deploy job's `env`, and
  **nowhere in `wrangler.json`**: the adapter copies a top-level `account_id` into
  the generated `dist/server/wrangler.json`, where it overrides the account the
  deploy step targets. One API token for that account, as a **repository** secret;
  an environment secret of the same name would silently take over production
  deploys.
- `wrangler.json`: top level is production, `env.staging` is
  `<brand>-marketing-staging` with its own `routes` and `vars`
  (`PREVIEW_MODE_DEFAULT`, dataset); `nodejs_compat`; `observability`;
  `assets.html_handling: "drop-trailing-slash"` (§7). Do not add
  `assets.headers` (wrangler ignores it); headers are covered below. The adapter
  writes the immutable cache rule for `/_astro/*` into `_headers`.
- **The adapter resolves the wrangler environment at BUILD time**, not deploy time:
  it flattens `env.staging` into `dist/server/wrangler.json`, and deploys use
  `wrangler deploy --config dist/server/wrangler.json`. `--env staging` is silently
  ignored. Set `CLOUDFLARE_ENV=staging` on the **build step only**: left set for
  `wrangler deploy`, wrangler applies the environment a second time and deploys
  `<brand>-marketing-staging-staging`.
- **`.github/scripts/check-worker-config.mjs`** runs after every build, in CI and
  in the deploys, and fails when the generated config has the wrong Worker name
  (a staging build without `CLOUDFLARE_ENV` would deploy over production), a
  pinned `account_id`, an unexpected `SANITY_DATASET` or `PREVIEW_MODE_DEFAULT`
  var, or the wrong routes.
- **Adapter shell-env-wins workaround.** `@astrojs/cloudflare` 14.1.2+ merges
  wrangler `vars` and `.env` into `process.env` during `astro:config:done` and
  overwrites what the shell exported, so `PREVIEW_MODE_DEFAULT=false pnpm build`
  silently built a preview site (drafts, stega, edit island). The reference site restores the
  shell's values with the `<site>:shell-env-wins` integration (a once-per-process
  snapshot) and a contract test that fails without it, and resolves the preview
  flag once (`src/lib/build-preview.ts`, `src/lib/preview-flag.ts`). Keep both
  until the adapter has a supported option.
- **Public storefront config** (`PUBLIC_PG_STOREFRONT_API_URL`,
  `PUBLIC_PG_PUBLISHABLE_KEY`, `PUBLIC_STORE_ORIGIN`) lives in repository
  variables, never hardcoded in a workflow; production-only values sit on the
  `production` environment (`PRODUCTION_PUBLIC_*`) so a missing one fails the run
  instead of inheriting staging's.
- **Datasets** are a per-site decision. The reference site reads `production` in
  staging and production alike and preview on/off is the only difference
  (drafts + stega vs published); `development` is the seeded fixture the test gate
  reads. The older pattern, staging on `development`, needs content copied there
  (`sanity dataset export production t.tar.gz && sanity dataset import t.tar.gz development`;
  `dataset copy` needs a paid feature).

**Pipeline** (`.github/workflows/`)

1. **`ci.yml`** on PRs to `main` and pushes to other branches, and called by the
   staging deploy. One aggregate check, **`CI passed`**, is the only required
   check (a `main` ruleset: PR required, linear history, squash or rebase only,
   branch up to date). A `Detect changes` job skips the heavy jobs for
   markdown-only PRs, which still report as passing. Jobs: lint (Biome + Knip),
   `pnpm typegen` with a failure if the committed `sanity.types.ts` is stale,
   `astro check`, unit and story tests; Storybook build; production build (no
   Sanity token); staging build (`CLOUDFLARE_ENV=staging`); Playwright contract in
   both preview modes (§6). Each build job starts with a **Require configuration**
   step that names any missing secret or variable in seconds, then runs the shared
   composite action
   `pretty-bonafide/winery-kit/.github/actions/setup-winery-site@main`.
2. **`deploy-staging.yml`** on push to `main`: re-runs `ci.yml` as a reusable
   workflow, then deploys the staging site Worker and the Storybook Worker in
   parallel, then runs the **post-deploy smoke**. Deploys queue and are never
   cancelled mid-flight (`cancel-in-progress: false`, per job).
3. **Production follows staging.** On a push to `main` only, job `production`
   (`needs: site`) calls **`deploy-production.yml`**, so a merge ships only after
   CI, the staging deploy and the staging smoke passed. A protected `production`
   GitHub environment and guard checks in the deploy workflow restrict what can
   ship. There is deliberately no `package.json` script for a production deploy.
4. **`content-rebuild.yml`**: live builds are prerendered, so a Sanity publish
   reaches the live site only through a rebuild. A Sanity webhook on the
   `production` dataset (published documents only; no drafts, versions or asset
   documents) sends a GitHub `repository_dispatch` of type `sanity-publish`, which
   rebuilds staging (`content-only`: skips CI and Storybook) and production in
   parallel.
5. **Storybook** deploys on `main` after CI as its own Worker on
   `storybook.<domain>`, in its own `storybook` environment.

**Runtime secrets, headers, smoke**

- **Worker secrets.** `PRIVATE_PG_SECRET` is set once per Worker with
  `wrangler secret put`; `wrangler deploy` neither sets nor clears it, so a Worker
  without it deploys green and then fails every sign-in. Both deploys run
  `.github/scripts/require-worker-secret.mjs`, which lists the Worker's secret
  *names* and fails first. Staging also needs `SANITY_API_READ_TOKEN` (it reads
  drafts per request); the deploy ships it with
  `wrangler deploy --secrets-file`, so the code and the token it needs go live in
  one version. Production gets no Sanity token. Any other non-public provider
  (form delivery keys) follows the same rule.
- **Secrets are step-scoped.** Pass a secret only to the step that reads it. A
  job-level `env` exports it to `pnpm install` and so to every dependency's
  lifecycle scripts.
- **Security headers** are one pure module, `src/lib/security-headers.ts`:
  HSTS, `nosniff`, `Referrer-Policy`, and a framing policy. The build appends it as
  a `/*` rule to `dist/client/_headers` (`<site>:security-headers`), which covers
  prerendered pages and assets; `src/middleware.ts` sets the same policy on
  on-demand HTML, which never passes through `_headers`. A live build sends
  `frame-ancestors 'none'` plus `X-Frame-Options: DENY`; a preview build allows
  the Studio origins (the deployed Studio, `www.sanity.io`, the local
  `sanity dev` port) because Presentation frames it. The contract suite asserts
  the served headers against the same module.
- **Post-deploy smoke** (`scripts/smoke.ts`, list and rule in
  `tests/visual/smoke.ts`): after every deploy, fixed checks (home, a page, a wine
  page, a product page, one legacy 301, `sitemap.xml`, `robots.txt`, and
  `/api/auth/session` returning 200 JSON, which proves the Worker holds its
  secret), then every URL in the deployed sitemap must answer 200 HTML with no
  redirect hop. Redirects are not followed; failed probes retry (rollout lag).
  Staging renders on demand, so a page that throws on its content surfaces here as
  a 500. The deployed origin comes from `scripts/deployed-origin.ts`, not from a
  string in the workflow.
- **Route mode (optional, for a zone that is not yet on the winery's account).**
  The reference site builds with an explicit `WORKER_ROUTE_ENABLED` (no default) that selects
  workers.dev or the Custom Domain, set from repository variables
  (`STAGING_ROUTE_ENABLED`, `PRODUCTION_ROUTE_ENABLED`): `src/lib/worker-routing.ts`,
  `.github/scripts/route-mode.mjs`. It is not skippable after cutover: the
  integration always parses it (`parseRouteEnabled` throws when it is unset), the
  build and deploy workflows resolve it, and `check-worker-config.mjs` requires
  `--route-enabled`. So after cutover **keep it explicitly `true`**. A new site that
  starts with its zone already on the account can instead leave the integration out
  and remove its workflow steps and the checker's flag together, never one of them.

Deploy the Studio separately (`pnpm sanity:deploy`), and after any schema change
`npx sanity schema deploy` as well (§2).

## 6. QA gate (every site, every launch)

```bash
pnpm test && pnpm check && pnpm build && pnpm test:stories
```

(`pnpm check` is Biome plus Knip.) CI runs the same, plus the suites below.

For docs or shared storefront-contract changes, also run:

```bash
cd ../winery-kit && pnpm docs:check
```

- **Contract** (`pnpm test:contract`): a Playwright project with no browser, run
  in CI against `astro preview` over a fresh build, **once per preview mode** (live
  and preview) on the seeded fixture dataset. Asserts: every sitemap URL answers
  200 HTML; title, canonical and Open Graph; one `<h1>`; no problem block in a live
  build; every internal link and fragment resolves with no hop; one URL form (each
  sitemap URL is its own canonical and its slashed spelling is one redirect); every
  legacy redirect is one hop to a 200; unknown path is a 404 with `noindex` and no
  canonical; `robots.txt`; the security headers; `/_astro/*` is immutable (reference site:
  `tests/visual/site-contract.spec.ts`, `redirects.spec.ts`, `routes.spec.ts`).
  **The exceptions are explicit, asserted exactly, and can only shrink:**
  `HEADING_OUTLINE_EXCEPTIONS` (pages whose legacy markup has zero or several
  `<h1>`) and `KNOWN_BROKEN_LINKS` (internal links known to 404, each with its
  reason; the test fails when one starts resolving, so the fix must delete the
  entry), both in `tests/visual/contract.ts`. Not followed: external store
  destinations (the contract asserts the first hop's status and `Location`, never
  the store's page), and the login endpoint, which is checked as one hop to the
  hosted login and not as a page; the three legacy `/profile` auth URLs make a
  second, cross-origin hop through it by design. Unit tests cover published-routes
  integrity (sitemap ⇄ route files ⇄ redirect map), loader fail-fast, and render
  parity (`src/lib/published-routes.test.ts`, `src/lib/render-parity.test.ts`).
- **Accessibility** (`pnpm test:a11y`): axe-core, WCAG 2.x A/AA serious and
  critical, over every sitemap route plus the 404. Report-only by default; run with
  `A11Y_STRICT=1` to fail on findings.
- **Visual** (`pnpm test:visual`), where the site ports an existing design: a pixel
  comparison against captured goldens, run in **both** configurations (preview on,
  and `PREVIEW_MODE_DEFAULT=false`) against the seeded fixture, never live
  content. The reference site runs it locally before merge, not in CI: its goldens were captured
  on macOS and Linux portability is unproven (`visual-linux.yml` is non-blocking).
- **Golden re-capture policy** (reference site: `tests/visual/README.md`): a golden changes
  only for a visual change decided *before* the run, never to make a run pass. The
  change is its own PR, titled `visual: …`, replacing only the goldens that
  change, with before/after images, the gate green in both configurations, and
  reviewed and merged by the maintainer; an agent opens the PR and stops.

Then a browser pass: home, wines index, one single-format PDP, one
multi-format PDP, add to cart → sidebar → checkout handoff, sign-in
round-trip, 404, mobile nav, `prefers-reduced-motion`. For allocation sites:
anonymous, signed-in non-member, and member-with-entitlement PDP states.

## 7. Cutover

DNS to the worker (custom domain in wrangler), store subdomain live, redirects
from legacy URLs, analytics/UTM verified end-to-end (attribution lands on
checkout), legacy platform (Squarespace/WineDirect/Vinoshipper/Commerce7) wound
down. The URL decisions below are made once and then asserted by the contract suite.

- **`www` is the canonical host.** `site: 'https://www.<domain>'` in
  `astro.config.mjs`, a `www.<domain>` Custom Domain route in `wrangler.json`
  (`{"pattern": "www.<domain>", "custom_domain": true}`), and the apex redirected to
  `www` by a **Redirect Rule on the zone**, which is not part of the repo. Grep
  every hardcoded origin: Studio preview URLs and CORS, the publishable key's
  allowed origins, SEO, sitemap. Update the key origins, Sanity CORS and the
  Studio preview URL to the Custom Domains at cutover.
- **One URL form: no trailing slash.** `trailingSlash: 'never'` plus
  `assets.html_handling: "drop-trailing-slash"`, so a slashed spelling is a single
  redirect (Cloudflare uses a 307; accepted). CMS hrefs pass through
  `slashlessHref` (reference site: `src/lib/site.ts`) so editor-typed links never ship a hop.
- **Canonical comes from `Astro.site` plus the pathname, never the request
  origin** (reference site: `src/layouts/BaseLayout.astro`): a request-derived canonical
  pointed staging's pages at staging. Tracking params are stripped
  (`canonicalizeUrl`). **Noindex pages carry no canonical and no `og:url`**
  (404, `/sign-in`, problem pages; `src/components/Head.astro`).
- **`robots.txt` opens at cutover.** A pure `robotsTxt({ preview, origin })` (reference site:
  `src/lib/robots.ts`): the live build serves `Allow: /` and `Disallow: /api/`;
  every preview build serves `Disallow: /`. Until cutover keep the live build
  disallowing everything, so the legacy site is not competing with a second copy;
  the cutover change flips it.
- **Legacy redirects are data** (reference site: `src/lib/redirects.ts`): one list feeding
  Astro `redirects`, `_redirects` (both slash spellings, derived catalog
  redirects such as `/item/<slug>`, and hosted-store hops built with the kit's link
  builders), and the sitemap. A published-routes test checks that no redirect
  chains and no redirected path is in the sitemap; the contract suite checks each
  is one hop to a 200.

## Current reference practices (2026-10)

Where a site and the reference site disagree on anything below, the reference site
is the pattern unless a site doc records a deliberate override. Paths are relative
to its checkout.

| Practice | Where |
|---|---|
| Rules, as the site applies them (YAGNI, fail fast, one owner per field, environments, parity) | `CLAUDE.md` |
| CI gate, deploy pipeline, secrets, environments, ruleset, content rebuild, cutover | `docs/ci.md`, `.github/workflows/*.yml` |
| Worker-config, Worker-secret and route-mode checks | `.github/scripts/*.mjs` |
| Live static / preview on-demand switch; empty-page guard; shell-env-wins | `astro.config.mjs`, `src/lib/build-preview.ts`, `src/lib/preview-flag.ts` |
| Dynamic pages resolve their own params on demand | `src/lib/content/on-demand.ts` |
| Problem block in preview, throw in production | `src/lib/problems.ts`, `src/lib/content/route.ts` |
| Static/dynamic parity guard | `src/lib/render-parity.test.ts` |
| Seed and migration safety | `scripts/seed/options.ts`, `scripts/seed/options.test.ts` |
| Session auth, login, prefetch guard | `src/pages/api/auth/`, `src/lib/storefront-api/auth-flow.ts`, `prefetchAttr` in `src/lib/site.ts` |
| Hosted join and booking links | `src/lib/content/store-links.ts`, `src/lib/content/load.ts`, `src/lib/redirects.ts` |
| Security headers | `src/lib/security-headers.ts`, `src/middleware.ts` |
| URL policy, canonical, robots, redirects | `src/lib/site.ts`, `src/components/Head.astro`, `src/lib/robots.ts`, `src/lib/redirects.ts` |
| Post-deploy smoke | `scripts/smoke.ts`, `scripts/deployed-origin.ts`, `tests/visual/smoke.ts` |
| Contract, a11y and visual suites; golden policy | `playwright.config.ts`, `tests/visual/README.md` |
| Dependabot (grouped, 1-day cooldown matching pnpm's `minimumReleaseAge`), CODEOWNERS, PR template | `.github/dependabot.yml`, `.github/CODEOWNERS`, `.github/pull_request_template.md` |

---

## Scaling notes (the next 10–20)

- **One kit, five proofs.** Commerce logic changes go to `winery-kit` with
  tests (100 and counting), never into a site. If two sites need the same
  component, it moves to the kit.
- **Migration recipe** for any pre-kit site: `docs/site-migration.md`
  (about 3,300 lines deleted per site in past migrations).
- **Known gaps** (candidates for the next phase): publishable-key creation is a
  manual admin step; the presentational PDP/cart components are still per-site
  (extract a themeable component package once the pattern is obvious); sites
  should move from `file:` to versioned releases ([docs/releasing.md](docs/releasing.md)).
