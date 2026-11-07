# Customer Site Rules

Status: canonical
Owner: Pretty Good engineering
Applies to: every winery site
Last verified: 2026-10-08
Update trigger: an invariant is added, changed or retired, or a site is added.

Non-negotiable rules every Pretty Good winery site must follow. These are
invariants, not suggestions — a site that breaks one has a bug. Each site's `AGENTS.md`/`CLAUDE.md` should link here;
where a site doc and this file disagree, **this file wins**.

For *how* to build a site, see `PLAYBOOK.md`; for *what the kit is*, see
`README.md`. This file is only the rules.

---

## 1. One source of truth for server-side data

A site's server-side rendering (SSR) reads from a **single source of truth**.
The two data sources — the **Store API** (live commerce) and the **CMS**
(flexible editorial content) — must never be mixed server-side. Blurred data
provenance ("where did this value come from?") is itself the bug this prevents.

In practice that single source is the **CMS**: every winery needs editorial
content that marketing can change without a deploy, so a CMS is always present.
The Store API is therefore consumed **only client-side**, by the cart/purchase
island after hydration.

Concretely:

- **No Store API calls during SSR.** Server-rendered pages read the CMS only.
  This keeps render times low and shrinks blast exposure when the Store API is
  slow or down. Reading the *public Store config* (publishable key / base URL)
  server-side to hand to a client island is fine — that is not a network call.
- **One owner per field.** A field is owned by exactly one source. You may
  compose fields from both sources into a single view, but never source the same
  field from two places and never fall back across sources (no "API price, else
  CMS price"). If the owning source is empty, render bare (Rule 2) when the field is
  optional; a required one follows Rule 5.
- **The cart island is the only Store API client.** It fetches commerce data
  client-side from the CMS-held join key + required public config, and degrades
  to the designed anonymous/unavailable state on runtime data failures.

## 2. No CMS-masking fallbacks

When **optional** CMS content is missing, the site renders **bare**. Never hide
it behind hardcoded placeholder content — fabricated copy, synthetic list items,
default headings, stand-in marketing text. Missing content must be visibly
missing: an unfilled optional field is a content task, not something the template
invents.

What counts as optional is the site's decision, and the rest is **required**:
documents and fields the page cannot be correct without (for example, a site's
`siteSettings` and `navigation` documents). A missing
required document or field is not rendered bare; it follows Rule 5 (a problem block
in preview, a thrown error in production).

This is the editorial counterpart to commerce runtime failure handling: missing
required config and required content fail fast, while missing *optional* content
renders empty rather than fabricated copy.

## 3. Attribution is propagated, never re-authored

UTM parameters answer one question: **"what external thing brought this visitor
to the brand?"** A brand's marketing site and its store are **conceptually one
property on two origins** (e.g. `example.com` → `store.example.com`); they are
not external to each other. A visitor's journey has a *single* acquisition event,
and that attribution must be **carried forward** across every internal hop —
never **re-generated** at each link. Stamping a site's own domain as the
`source`/`medium` of an internal link is self-referral: it overwrites the real
acquisition (a new UTM'd landing starts a fresh campaign session in GA4) and
fills campaign reports with traffic the brand sent itself.

Concretely:

- **Internal links never author acquisition.** A link between pages/origins the
  brand owns (including the marketing → store hop) must not set `utm_source`,
  `utm_medium`, or `utm_campaign` to describe itself. Its job is **propagation**:
  forward the visitor's captured acquisition unchanged. The kit's
  `captureUtmFromLocation` + `forwardUtmToLinks` (storefront-kit `/utm`) does this
  — store-bound links carry the *stored* acquisition, which outranks any per-link
  value, so the store sees where the visitor really came from.
- **Per-link differentiation is limited to `utm_content`** (placement/variant:
  `homepage-hero`, `footer-cta`, `nav-shop`). This is the one dimension that is
  legitimately per-button, and only worth adding where a report will read it.
  Reserve `utm_campaign` for real, time-boxed initiatives (a release, a holiday
  push), authored centrally (ideally a CMS link), never hardcoded evergreen.
- **Site-level defaults are a single low-precedence gap-fill.** A `source`/
  `medium` default (e.g. `{source: '<brand>-site', medium: 'referral'}`) belongs
  in *one* place — the `forwardUtmToLinks` call — and only fills keys an
  otherwise-unattributed (direct) visitor leaves empty. It is never repeated
  per button.
- **Canonical URLs stay UTM-free.** `rel=canonical` (and internal share links)
  must strip UTM params, or tagged URLs leak into search indexes and create
  self-referrals.

If two origins of one brand share an analytics property, **cross-domain
measurement** (the GA4 linker) is the correct mechanism for session continuity —
not internal UTMs. The propagation above is the cross-tool / order-metadata
backstop and the source of placement (`utm_content`) data; it must stay
consistent with cross-domain measurement by never re-authoring `source`/`medium`/
`campaign`.

## 4. Delete what is not used

No speculative schema types, components, fields, modes, scripts or docs "for
later". If nothing queries, renders or references it, remove it; git keeps the
history. That includes code that has done its job: a **migration script is
deleted once it has been applied**, and a configuration mode no environment
builds goes the same way. A
Studio list that can never change the site is a bug. Run the site's dead-code
check (Knip) before opening a PR.

## 5. Fail fast, never mask

A broken configuration or a gap in required data stops the **build or deploy**;
it never reaches a visitor as a quietly different page.

- **Required config** (Sanity project and dataset, Store API URL and publishable
  key, store origin, Worker secrets) throws at dev, build or deploy and names the
  variable. No silent defaults, no default auth mode, no fallback to mock commerce
  outside stories and tests.
- **A production build throws** on a missing required field in a published
  document (never a Store API read: Rule 1). Throw from
  `getStaticPaths` where the route has one: a throw in a page body is swallowed by
  the prerenderer, which writes a zero-byte page and exits 0, so a build guard must
  fail on any empty prerendered page.
- **A preview build shows the problem**: an explicit, visible problem block in
  place of the page body, or of the one entry (nav item, link) that has the gap,
  never a stand-in value.

Rule 2 decides what a missing *optional* field looks like (bare). This rule
decides what happens when something the page *requires* is missing, including a
required document in a CMS that is not yet filled in.

## 6. Scripts never default to production

A script that writes (seed, migration, backfill, import) targets `development` or
requires an explicit `--dataset`; it never inherits `SANITY_DATASET` or `.env`,
which may point local dev at `production`. The `sanity` CLI's default dataset is
`development` too.

- A **seed** is a fixture loader for `development` only: it replaces documents
  and may prune editor-created ones, so it **refuses every other dataset with no
  override**, and the refusal is unit-tested.
- A **migration** reshapes existing documents after a schema change (not a
  handful of edits an editor can make in Studio in ten minutes). It is dry-run
  first, requires `--dataset`, refuses `production` without an explicit
  `--allow-production`, and is deleted once applied (Rule 4).
- Production content is edited in Studio.

## 7. Static and dynamic render the same

A page must render identically prerendered (a live build) and on demand (a preview
build, where Studio Presentation needs every edit visible on the next request).

- **No request-scoped data in a prerenderable page or component.** Use only
  `Astro.url.pathname` and `.search`, never the origin, host, `Astro.request`,
  cookies, client address or `locals`: prerendered, `Astro.url` is the configured
  `site` URL; on demand it is the origin that was requested (a canonical built
  from it pointed staging at staging). Request-scoped work belongs in `/api/*`
  routes (`prerender = false`) and client islands.
- **A page with `getStaticPaths` also resolves its own params on demand**, since
  Astro never calls it for an on-demand request.
- **Secrets are read at runtime** (`getSecret` from `astro:env/server`), never
  through `import.meta.env`, which Vite inlines into the bundle that on-demand
  pages ship in.
- Enforce all three with a source-level test, and run the contract suite in both
  modes (see `PLAYBOOK.md` §6).
