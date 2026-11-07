# Releasing winery-kit

Status: canonical
Owner: Pretty Good engineering
Applies to: winery-kit and every winery site that installs it from a release
Last verified: 2026-11-06
Update trigger: any change to the release scripts, `.github/workflows/release.yml`, or how sites install the kit

`@pretty-good/storefront-kit` and `@pretty-good/winery-ui` are versioned in
lockstep: both always share one semver version, and `winery-ui`'s peer on
`storefront-kit` is always `^<version>`. Tags are `vX.Y.Z`. Each release is a
GitHub Release with both tarballs and a `SHA256SUMS` file attached. There is no
package registry, so sites install by URL and need no token.

## Cut a release

1. On a branch from `main`, set the version. This updates both packages and the
   peer range, and rejects anything that isn't `X.Y.Z` or `X.Y.Z-prerelease`.
   Build metadata (`+build`) is rejected too: GitHub rewrites `+` in asset
   names, so the install URL would not exist.

   ```bash
   pnpm release:set-version 0.3.0
   ```

2. Open a PR and merge it. CI runs `pnpm release:check` and `pnpm release:pack`,
   so a PR that can't produce valid tarballs fails before it merges.

3. Tag the merge commit on `main` and push the tag:

   ```bash
   git switch main
   git pull --ff-only
   git tag v0.3.0
   git push origin v0.3.0
   ```

`.github/workflows/release.yml` then runs install, check, build, test,
docs check, `pnpm release:check v0.3.0` and `pnpm release:pack`, and creates the
GitHub Release with generated notes. It fails if the tag doesn't equal
`v<version>` or the release already exists. A tag with a hyphen, such as
`v0.3.0-rc.1`, becomes a GitHub prerelease.

Published tags and assets are immutable: sites and their lockfiles pin them. To
correct a bad release, ship a new version. Don't move a tag or replace an asset.

While the kit is `0.x`, a breaking change bumps the minor version (`0.2.x` to
`0.3.0`). `^0.2.0` does not accept `0.3.0`, so the peer range enforces this.

## Check a release locally

```bash
pnpm release:check          # lockstep versions and peer range
pnpm release:check v0.3.0   # same, plus the tag
pnpm release:pack           # writes release-artifacts/ (gitignored)
```

`release:pack` removes `dist`, rebuilds, copies the root `LICENSE` into each
package for the duration of the pack, then checks the result: every relative
import in `dist` must resolve under Node ESM, and each tarball must hold `dist`,
`package.json`, `LICENSE` and every `exports` target, with no source, tests or
stories.

Relative imports in `packages/*/src` must carry their extension (`./cart-store.js`,
`../cart/index.js`). `tsc` passes specifiers through unchanged and accepts
extensionless ones under `moduleResolution: bundler`, but a package installed in
`node_modules` can be loaded by Node directly, for example when Vite externalizes
it for SSR.

## Test a pull request build

CI uploads every run's tarballs and `SHA256SUMS` as the `release-tarballs` artifact and
keeps them for 14 days. Actions artifacts need a GitHub login, so a site can't install
one by URL or use it in production. Download it and point the site at the file:

```bash
gh run download <run-id> --repo pretty-bonafide/winery-kit --name release-tarballs --dir /tmp/winery-kit-pr
```

```json
"@pretty-good/storefront-kit": "file:/tmp/winery-kit-pr/pretty-good-storefront-kit-0.2.0.tgz"
```

The run ID is in the pull request's CI link. The tarball carries the version on that
branch, so the filename alone doesn't identify the pull request. Don't commit this
dependency: a site's lockfile should only reference published releases.

## Install in a site

Add both packages by exact release URL, with the same version:

```jsonc
// package.json
"dependencies": {
  "@pretty-good/storefront-kit": "https://github.com/pretty-bonafide/winery-kit/releases/download/v0.2.0/pretty-good-storefront-kit-0.2.0.tgz",
  "@pretty-good/winery-ui": "https://github.com/pretty-bonafide/winery-kit/releases/download/v0.2.0/pretty-good-winery-ui-0.2.0.tgz"
}
```

`react` 19 is a peer of both. A site that uses `winery-ui` must list
`storefront-kit` too: on its own, pnpm's `auto-install-peers` looks for the peer
on the npm registry, where it doesn't exist, and the install fails with
`@pretty-good/storefront-kit is not in the npm registry`.

No `.npmrc` entry or token is needed, and `pnpm-lock.yaml` records each tarball's
integrity hash. This works on pnpm 10 and pnpm 11.

## Upgrade a site

1. Read the release notes.
2. Change the version in both URLs. It appears twice per URL, in the tag and in
   the file name.
3. Run `pnpm install` and commit `package.json` with `pnpm-lock.yaml`.

Never upgrade one package without the other: the peer range only accepts the
matching release line.

## Develop against a local kit

Point the site at a local checkout with overrides, which keeps the release URLs
in `package.json` untouched. In the site's `pnpm-workspace.yaml`:

```yaml
overrides:
  '@pretty-good/storefront-kit': link:../winery-kit/packages/storefront-kit
  '@pretty-good/winery-ui': link:../winery-kit/packages/winery-ui
```

Then build the kit and install the site:

```bash
(cd ../winery-kit && pnpm install && pnpm build)
pnpm install
```

Run `pnpm build:watch` in the kit while you work, because sites load `dist`.

`pnpm link ../winery-kit/packages/storefront-kit` writes the same override for
one package. In both cases, undo it by removing the `overrides` entries and
running `pnpm install`; don't rely on `pnpm unlink`, which doesn't remove the
override on every pnpm version. Don't commit the overrides or the lockfile
changes they cause.

A linked package resolves its own `node_modules`, so `react` can load twice. If
hooks fail with an invalid-hook-call error, add `react` and `react-dom` to the
site's Vite `resolve.dedupe`.
