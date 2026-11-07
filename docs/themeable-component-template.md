# Themeable Component Template & Conventions

How to build a **shared presentational component** in `@pretty-good/storefront-kit`
that every winery site reuses but themes with its own tokens. `CartSidebar` is the
reference implementation — copy its shape for the next component (cart drawer line,
header indicator, mini-cart, checkout summary, …).

> Companion docs: [`winery-store-requirements.md`](./winery-store-requirements.md) §5
> (the headless cart store/adapter behavior) and the kit
> [`README.md`](../README.md) (Storybook + dist-freshness). This doc is about the
> **presentation layer** — the View/Theme/Storybook pattern that's reused per component.

---

## Why this pattern (the two hard constraints)

1. **The kit can't use Tailwind classes.** No site's Tailwind `content`/`@source`
   globs scan `node_modules/@pretty-good/**`, and the sites' token vocabularies are
   disjoint (`text-primary` / `store-fg` / `ink` / `--color-ink`). A class shipped
   from the kit would be purged or unmapped. → **Style from CSS custom properties
   set by a `theme` prop.**
2. **Behavior is shared, presentation is per-brand.** The kit owns state machines and
   the cart store (headless); each site owns colors/fonts/spacing. → **Split a pure
   presentational View from the connected shell** (functional core / imperative shell).

---

## The three layers

```
<Name>View        pure, presentational — ALL data + handlers via props (functional core)
   ▲
<Name>            connected shell — wires kit hooks/store to the View (imperative shell)
   ▲
Site wrapper      thin — passes the site's theme + copy, mounts the component
```

### 1. `<Name>View` — pure presentational (functional core)
- Receives everything as props: data (a view-model), state flags (`loading`,
  `mutating`, `errorMessage`), handlers (`onClose`, `onCheckout`, …), `theme`, copy.
- No store, no env, no network. Renders identically in the app, Storybook, and tests.
- May own UI-only side effects (focus, scroll-lock, Escape) via `useEffect` — that's
  presentation behavior, not business logic.
- Derives display values purely (totals, counts) inside the View.

### 2. `<Name>` — connected shell (imperative shell)
- Calls the kit hook(s) (`useCartSidebar()`, …), maps raw data → the View's
  view-model, and renders `<NameView … />`. Nothing visual lives here.
- This is the component sites mount. Keep its public props stable.

### 3. Site wrapper — thin
```tsx
// <site>/src/components/.../<Site><Name>.tsx
import { <Name> } from '@pretty-good/storefront-kit/react';
import { <site><Name>Theme } from './<site>-<name>-theme';
export default () => <<Name> theme={<site><Name>Theme} brandEyebrow="…" … />;
```
The wrapper is the only place site tokens are named, for example
`src/components/cart/<Site>CartSidebar.tsx` + `<site>-cart-theme.ts`.

---

## Theming convention (CSS custom properties)

Define a `<Name>Theme` interface — semantic roles, not raw scales. Group `colors`
and `fonts`; add primitives (`radius`, feature flags like `showLineImages`):

```ts
export interface <Name>Theme {
  colors: { surface: string; border: string; textPrimary: string; /* … */ };
  fonts: { display: string; body: string };
  radius?: number;            // default 0
  /* feature flags as needed */
}
```

- **Document every field with a one-line JSDoc** — that interface IS the canonical
  variable reference (see `CartSidebarTheme` in `src/react/CartSidebar.tsx`).
- **Project the theme to CSS variables** with a `themeToVars(theme)` helper that
  returns a `CSSProperties` of `--<prefix>-*` custom properties, set inline on the
  component root. Style the component from those vars in a single scoped `<style>`
  string. Cast the var object `as CSSProperties` (custom props are allowed by
  `@types/react` 19).
- **Prefix everything with a short, component-unique token** so multiple kit
  components on one page never collide: cart uses **`pgc`** → `--pgc-surface`,
  `.pgc-root`. A new component picks its own (e.g. `--pgn-*` / `.pgn-*`).
- **Never hardcode a brand value** (hex, font, radius) in the component — every
  visual value flows through the theme. The scrim/shadow are the only allowed
  literals.
- **Two greys, not one.** Real designs use a mid grey *and* a fainter grey; give the
  theme both (`textMuted` + `textFaint`) rather than overloading one.

---

## View-model convention (degrade gracefully)

The View consumes a **presentation view-model**, not the raw cart/API type. Sites map
their data into it in the connected shell (or via an injectable `mapLine`-style prop).

- **Optional, additive fields.** New capabilities (discount, wishlist, badges) are
  optional on the view-model; the View renders nothing for absent fields. This lets a
  site adopt the component **before** the data pipeline that feeds those fields exists.
  (A site can render plain purchase lines and leave wishlist/discount fields unset.)
- Keep the view-model in the kit's `cart-types.ts` (or a `*-types.ts`) so both the
  mapping and the View import one shape. Reference: `CartLineView`.

---

## Dependency rules (keep the kit lean)

- **Peer deps only: `react`.** Don't pull UI libs into the kit. The reference sheet
  is **dependency-free**: its own scrim/panel (no Radix), **inline SVG icons** (no
  lucide), basic a11y (Escape, scroll-lock, focus) by hand. Sites stay decoupled and
  bundles stay small.
- Anything Storybook-only (`@storybook/*`, `react-dom`, `vite`) is a **devDependency**
  of the kit package and never ships (the package is `files: ["dist"]`).

---

## File & naming conventions

| Thing | Convention | Cart reference |
|---|---|---|
| Pure view | `<Name>View` | `CartSidebarView` |
| Connected shell | `<Name>` (also `default`) | `CartSidebar` |
| Theme type | `<Name>Theme` | `CartSidebarTheme` |
| Props types | `<Name>Props`, `<Name>ViewProps` | same |
| Theme→vars helper | `themeToVars()` (module-local) | same |
| Scoped CSS | one `STYLES` string, `.<prefix>-*` classes | `pgc` |
| CSS variables | `--<prefix>-*`, set via inline `style` | `--pgc-*` |
| View-model | `<Thing>View` in `*-types.ts` | `CartLineView` |
| Example themes | `<name>-example-themes.ts` → `example<Name>Themes` | `cart-sidebar-example-themes.ts` |
| Stories | `stories/<Name>.stories.tsx` (outside `src/`) | `stories/CartSidebar.stories.tsx` |

Export the View + connected component + types from `src/react/index.ts`. **Do NOT
export the example themes from the barrel** — keep them importable directly so
consuming sites don't gain an extra `dist` file they must reinstall to resolve.

---

## Storybook convention

The kit ships a React-Vite Storybook (the sites' Storybook is Astro-SSR and can't
render React islands). Run: `cd packages/storefront-kit && pnpm storybook` (`:6066`).

- **Stories live in `stories/`, outside `src/`**, so `tsc -p tsconfig.build.json`
  (which builds `src/`) never compiles them into `dist`. This keeps tsconfig untouched.
- **Render the pure `<Name>View`** so no cart store/setup is needed. Drive it with a
  small stateful harness (local `useState`) so steppers/remove/etc. work for
  prototyping.
- **Example themes** are the story's reference presets (`noir`, `cellar`, `terracotta`,
  `ledger` for cart) — light/dark, serif/mono, image-ful/-less, sharp/soft — so the
  themeability is visible. They are **prototyping presets, not production site themes.**
- One story per **state** (empty, loading, populated, each feature, processing, error)
  plus **theme-showcase** stories, plus a `themeName` select control so any state can
  be previewed in any theme.

---

## Build & consumption gotchas (hard-won)

- **A new export needs reinstall + dev restart in each site.** Sites consume the kit
  as a `file:` (hard-linked) dep. Edits to *existing* dist files propagate via shared
  inodes, but a **new** file/export does not — run `pnpm install` in the site. And a
  long-running dev server caches the kit's SSR module graph, so a newly-imported named
  export resolves to `undefined` → React "element type is invalid" → the streamed page
  **truncates** (a `200` with no `</body>`). Fix: rebuild kit → `pnpm install` in site
  → `rm -rf node_modules/.vite` → **restart the site dev server**. See the kit README
  "Keeping dist fresh in dev".
- **Keep new files out of the public barrel** unless sites need them (example themes,
  fixtures) — re-exporting them from `react/index.ts` couples every consumer to that
  file.
- **Verify on the real origin.** Cart mutations need the allowlisted site origin
  (`<site>.localhost`), not a throwaway port; the publishable key 403s elsewhere.

---

## Checklist for a new themeable component

1. `src/react/<Name>.tsx`: `<Name>Theme` (documented), `themeToVars()`, `STYLES`
   (scoped `--<prefix>`/`.<prefix>`), inline icons, **`<Name>View`** (pure), **`<Name>`**
   (connected). Default export = `<Name>`.
2. View-model in `*-types.ts` with optional/additive fields.
3. Export View + component + types from `src/react/index.ts` (not example themes).
4. `src/react/<name>-example-themes.ts` with a few archetype presets.
5. `stories/<Name>.stories.tsx` — pure View + stateful harness + `themeName` control +
   state and theme-showcase stories.
6. `pnpm build` (kit) → `pnpm build-storybook` to confirm it compiles.
7. Each adopting site: thin wrapper + `<site>-<name>-theme.ts`; then reinstall +
   restart dev (see gotchas) and verify on the real origin.

---

## Reference implementation map

| File | Role |
|---|---|
| `src/react/CartSidebar.tsx` | `CartSidebarTheme`, `themeToVars`, `STYLES`, icons, `CartSidebarView` (pure), `CartSidebar` (connected) |
| `src/cart/cart-types.ts` | `CartLineView` view-model (+ mode/discount/stock) |
| `src/react/cart-sidebar-example-themes.ts` | `noir` / `cellar` / `terracotta` / `ledger` presets |
| `stories/CartSidebar.stories.tsx` | states + themes, interactive harness, `themeName` control |
| `.storybook/main.ts`, `.storybook/preview.ts` | stories glob (`../stories`), `layout: fullscreen` |
| `<site>/.../<Site>CartSidebar.tsx` + `<site>-cart-theme.ts` | site wrapper + token map |
