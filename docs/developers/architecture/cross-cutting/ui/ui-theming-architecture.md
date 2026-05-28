# UI theming architecture

Both front-ends are themeable down to a single JSON file: a customer brand skin can
recolor, re-font, and re-logo the entire surface without touching component code.
This rests on a layered CSS-variable token system plus a runtime theme loader. The
rule that makes it work — and that this doc and its CI guards enforce — is that no
component ever hardcodes a visual value; everything resolves through tokens.

## 1. The layered token model

Tokens live in `packages/ui-shared/src/styles/` and stack in three layers:

- **Layer 1 — raw tokens** (`global.css`): the `--g-*` palette and scales (color
  ramps, spacing, etc.). This is the floor every other layer builds on.
- **shadcn / Tailwind v4 layer** (`prime-shadcn-tokens.css`): a `@theme` block of raw
  values plus an `@theme inline` block that maps shadcn's semantic names
  (`--color-background`, `--color-primary`, the `--radius-*` scale, …) onto
  underlying variables. This is a *definition* file — it is the one place hex is
  allowed in CSS, and the design-token guard exempts it.
- **Layer 2 — semantic tokens** (`light.css` / `dark.css`): `:root` /
  `[data-theme="light"]` / `[data-theme="dark"]` blocks that bridge the per-mode
  semantic names components use — the `--color-*` family (including the status
  colors), `--sidebar-*`, and `--shadow-*` — to the shadcn tokens. (The
  mode-independent scale tokens — spacing, radius, transition, z-index — live in
  Layer 1 and need no per-mode bridge.) Status colors (`--color-success` / `warning`
  / `danger` / `info`) deliberately resolve to the stable Layer 1 `--g-*` palette, so
  that success-green and danger-red carry the same business meaning across every theme.

Components reference only Layer 1 and Layer 2 variables; they never see hex.

## 2. Theme packs

A theme is a JSON file under `public/themes/` (mirrored in both
`packages/control-plane-ui/` and `packages/agent/ui/frontend/`). The repo ships
three — `default` (the AlphaBitCore brand), `morningstar`, and `rbc` — and customers
add their own. Each pack carries the brand block (product name, tagline, logos,
favicon), typography (the font families), a `layer1` block (radii and effect tokens),
and `lightTokens` / `darkTokens` — the Layer 2 variable overrides for each mode. A
pack may also add an optional `charts` block to override the built-in Recharts
palette (see [§3](#3-chart-colors)); the shipped packs rely on the built-in palette.

The loader is `packages/ui-shared/src/theme/themeLoader.ts`. `loadTheme(themeId)`
fetches the pack; `applyThemeTokens` injects a single scoped `<style>` block into
`<head>` — `lightTokens` under `:root, [data-theme="light"]` and `darkTokens` under
`[data-theme="dark"]`. Switching brand swaps that block; switching light/dark flips
the `[data-theme]` attribute. The Control Plane UI wires this through a
`ThemeProvider`, and the shared theme context (`ThemeContext`, `ThemeConfig`) lets
both bundles read the active theme.

## 3. Chart colors

Recharts needs JavaScript color strings, not CSS variables, so charts cannot resolve
tokens at render the way the rest of the UI does. `packages/ui-shared/src/theme/chartColors.ts`
is therefore the single sanctioned source of hex in the UI: every chart in both
bundles imports its palette from there, and no chart inlines its own hex. It layers
built-in light/dark palettes (the floor) under a per-theme override
(`ThemeConfig.charts`), so a brand's colors reach charts the same way they reach
every other surface — through the active theme. Components read it through hooks
(`useChartSeriesColors`) under the `ThemeProvider`.

## 4. Enforcement

Theming is only robust if nothing escapes the token system, so four CI guards (all in
`check:all`) hold the line:

- **`check-design-tokens.mjs`** — every visual value (color, spacing, font size and
  weight, border radius, box shadow, transition, z-index) in a `*.module.css` or an
  inline `style={{}}` must be a CSS variable from Layer 1 or Layer 2. The
  `prime-shadcn-tokens.css` definition file is the only exemption.
- **`check-theme-completeness.mjs`** — every theme pack must define every required
  token (the set in `ui-shared/src/theme/completeness.ts`) in **both** `lightTokens`
  and `darkTokens`. Because the loader merges a theme's `<style>` over the previous
  one, a missing token would silently inherit the prior theme's value rather than the
  new brand's.
- **`check-effect-tokens.mjs`** — every `--g-effect-*` token defined in `global.css`
  must be consumed somewhere, and every `var(--g-effect-*)` reference must resolve to
  a defined token, so effect tokens don't rot into dead knobs or dangling typos.
- **`check-brand-strings.mjs`** — the product name and tagline must come from
  `ThemeConfig.brand`; a hardcoded brand string anywhere but a theme-pack JSON would
  defeat single-file rebranding.

## References

- `packages/ui-shared/src/styles/` — the token layers (`global.css`, `prime-shadcn-tokens.css`, `light.css`, `dark.css`, …)
- `packages/ui-shared/src/theme/themeLoader.ts` — runtime theme loader + token injection
- `packages/ui-shared/src/theme/chartColors.ts` — the sanctioned Recharts palette
- `packages/ui-shared/src/theme/completeness.ts` — required-token set for theme packs
- `packages/control-plane-ui/public/themes/` — theme packs (default + branded skins), mirrored under `packages/agent/ui/frontend/public/themes/`
- `scripts/check-design-tokens.mjs`, `scripts/check-theme-completeness.mjs`, `scripts/check-effect-tokens.mjs`, `scripts/check-brand-strings.mjs` — the token/theme/brand guards
