# setup-winery-site

Composite action for Pretty Good winery marketing sites that still consume
`@pretty-good/storefront-kit` and `@pretty-good/winery-ui` through
`file:../winery-kit/...`.

It checks out:

- the caller site repository into `site/`
- `pretty-bonafide/winery-kit` into sibling `winery-kit/`

Then it sets up pnpm/Node, builds `winery-kit`, and installs the site
dependencies. Site workflows should run all checks/builds from `site/`.

Requirements:

- Caller repos must pass `secrets.WINERY_KIT_TOKEN`.
- `WINERY_KIT_TOKEN` needs read access to `pretty-bonafide/winery-kit`.

This action is an interim bridge until these packages are published as versioned
releases.

Optional inputs (the defaults keep the behaviour above):

- `site-sparse-checkout` / `site-sparse-checkout-cone-mode`: sparse-checkout
  patterns for the site checkout. Empty (the default) checks out the whole
  tree. A deploy job can leave out paths it never reads, for example
  visual-regression goldens:

  ```yaml
  site-sparse-checkout: |
    /*
    !/docs/legacy-capture/screenshots/
  site-sparse-checkout-cone-mode: 'false'
  ```

  `actions/checkout` then fetches with `--filter=blob:none`, so the excluded
  blobs are never downloaded. Keep the full tree in any job that reads them.
  With `dependency-cache: actions`, keep `pnpm-lock.yaml` in the sparse set:
  the cache key hashes it.
- `dependency-cache`: `actions` (default) caches the pnpm store in the GitHub
  Actions cache through `actions/setup-node`. `none` skips the store cache,
  installs Node first and then pnpm from npm. Use `none` on ephemeral runners
  where a cache restore costs as much as a fresh install from the registry.
  pnpm then comes from `npm i -g`, which sets no `PNPM_HOME`, so `pnpm add -g` is unavailable.
