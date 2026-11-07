# Winery Sites Documentation Strategy

Status: canonical
Owner: Pretty Good engineering
Applies to: winery-kit and every winery site
Last verified: 2026-06-16

This is the documentation operating model for winery sites. The goal is to make
the docs useful during implementation without letting copied plans become stale
source material.

## Layers

| Layer | Home | Purpose |
|---|---|---|
| Rules | `winery-kit/RULES.md` | Non-negotiable invariants. If another doc disagrees, rules win. |
| Playbook | `winery-kit/PLAYBOOK.md` | Repeatable build and launch procedure. |
| Canonical contracts | `winery-kit/docs/*requirements*.md`, API and component architecture docs | Shared behavior across sites. Update with the kit/API change that changes behavior. |
| Site docs | `<site>/docs/README.md` plus site-specific docs | Brand, source-system, launch, and decision deltas only. Do not copy canonical contracts unless the site intentionally overrides them. |
| Archives/reference assets | Explicitly indexed under a site docs README | Raw extraction, Pencil files, screenshots, and label assets. These are inputs, not contracts. |

## Lifecycle Header

Every new or materially edited durable doc should start with:

```md
Status: canonical | site-delta | working-plan | exploration | archive
Owner:
Applies to:
Last verified:
Update trigger:
```

Use the status labels consistently:

- `canonical`: the source of truth for shared behavior or process.
- `site-delta`: site-specific facts that intentionally differ from canonical docs.
- `working-plan`: current implementation plan with known open items.
- `exploration`: research or design input; not binding until promoted.
- `archive`: historical context kept for reference.

## Update Rules

1. Behavior changes update the contract doc in the same PR.
2. Site-specific launch/config changes update that site's docs index or runbook.
3. Cross-repo repeated code gets documented once in `winery-kit`, then linked from sites.
4. Reference extraction and design assets must be indexed as reference inputs, not mixed into current implementation docs.
5. Stale endpoint names and removed storage keys are documentation bugs.

## Checks

Run this from `winery-kit` when changing docs or shared storefront contracts:

```bash
pnpm docs:check
```

The check is intentionally narrow. It verifies that site docs have indexes,
that PDP story harnesses mock the current `POST /purchase-context` contract,
that removed membership-cache references do not return, and that generated
Finder files stay out of docs.
