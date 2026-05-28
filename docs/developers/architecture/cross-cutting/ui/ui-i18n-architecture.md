# UI i18n architecture

Both front-ends — the Control Plane web admin and the Agent desktop Dashboard —
are fully internationalized: every user-visible string goes through `t()`, and the
three supported locales (English, 中文, Español) are kept at exact key parity by a
CI guard. English is the canonical source and the fallback. This doc covers how the
two bundles load translations, how they share strings, and how parity is enforced.

## 1. Two bundles, two loading models

The two front-ends run in different environments, so they load locales differently:

- **Control Plane UI (web)** — `packages/control-plane-ui/src/i18n/index.ts` uses
  i18next with the HTTP backend. English is bundled into the JS at build time for an
  instant first render with no network wait; the other locales are fetched on demand
  from `/locales/{lng}/{ns}.json` (`partialBundledLanguages` is on). The chosen
  language persists in `localStorage` under `nexus-language`.
- **Agent Dashboard (Wails desktop)** — `packages/agent/ui/frontend/src/i18n/index.ts`
  bundles **every** locale directly into the JS chunk. There is no HTTP backend: the
  Wails WebView's network plane is firewalled, so all translations must be embedded.
  The chosen language persists under `nexus-dashboard-language`.

Both set `fallbackLng: 'en'`, so a key missing in the active locale renders the
English string rather than the raw key.

## 2. Namespaces and the shared namespace

Keys are addressed as `t('namespace:section.key')` (for example
`t('pages:infrastructure.runtime.title')`). Each bundle owns its own namespaces and
both pull one shared namespace:

- **Control Plane UI** — `common`, `nav`, `pages` (default `common`), at
  `packages/control-plane-ui/src/i18n/locales/{en,es,zh}/{common,nav,pages}.json`.
- **Agent Dashboard** — `dashboard` (default), at
  `packages/agent/ui/frontend/src/i18n/locales/{en,es,zh}/dashboard.json`.
- **`shared`** — `packages/ui-shared/src/i18n/{en,es,zh}/shared.json`, imported by
  **both** bundles from `@nexus-gateway/ui-shared`. Common action and status labels
  live here once and are translated once, so the admin UI and the Dashboard show
  identical wording for shared concepts.

## 3. The build bridge

For the Control Plane UI's HTTP backend to serve the non-English locales, the source
JSON has to reach the served directory. `scripts/sync-locales.mjs` copies every
namespace from `packages/control-plane-ui/src/i18n/locales/<lang>/` and
`packages/ui-shared/src/i18n/<lang>/` into
`packages/control-plane-ui/public/locales/<lang>/`, where the backend loads them
from. English needs no copy — it is bundled directly through the JSON imports in
`src/i18n/index.ts`. The Agent Dashboard skips this entirely, since it bundles all
locales.

## 4. Parity enforcement

Internationalization is a binding convention: every user-visible string must use
`t()`, and the locales must stay at key parity. Two layers enforce it:

- **`scripts/check-i18n-parity.mjs`** (the `check:i18n` npm script, part of
  `check:all` and CI). It flattens every locale file to dotted-path keys and confirms
  the key sets match across locales, using English as the reference — any key missing
  from, or extra in, a non-English locale fails the check with a precise diff. It
  scans all three locale sources: the Control Plane UI, `ui-shared`, and the Agent
  Dashboard.
- **The `i18n-gap-check` skill** is the broader development-time scan over both
  bundles. Beyond key parity it flags keys used in source but missing from English
  (which would render as raw strings), orphaned and unused keys, dynamic `t()`
  template literals that need manual review, and hardcoded English in `.tsx` that
  bypasses `t()` altogether.

`scripts/check-json-dupkeys.mjs` additionally rejects duplicate keys within a locale
JSON file.

## References

- `packages/control-plane-ui/src/i18n/index.ts` — Control Plane UI i18next setup (bundled en + HTTP backend)
- `packages/agent/ui/frontend/src/i18n/index.ts` — Agent Dashboard i18next setup (all locales bundled)
- `packages/control-plane-ui/src/i18n/locales/` — `common` / `nav` / `pages` namespaces
- `packages/agent/ui/frontend/src/i18n/locales/` — `dashboard` namespace
- `packages/ui-shared/src/i18n/` — `shared` namespace, consumed by both bundles
- `scripts/sync-locales.mjs` — copies source locales into the served `public/locales/`
- `scripts/check-i18n-parity.mjs` — CI key-parity guard across all three locale sources
