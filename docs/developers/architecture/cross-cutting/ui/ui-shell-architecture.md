# UI shell architecture

The shell is the structural skeleton both front-ends are built on: how a screen
fetches data, how the app is laid out into routes and navigation, and the shared
component library the two bundles draw from. Theming and internationalization are
separate concerns — see
[ui-theming-architecture.md](ui-theming-architecture.md) and
[ui-i18n-architecture.md](ui-i18n-architecture.md).

## 1. Data layer

Reads go through `useApi` (`packages/control-plane-ui/src/hooks/useApi.ts`), a thin
wrapper over TanStack React Query that returns `{ data, loading, error, refetch }`.
Two deliberate defaults shape its behavior:

- **Freshness first.** `staleTime` defaults to `0` and `refetchOnMount` to
  `'always'`, so every mount and nav-back refetches. An admin console prizes seeing
  the current state over saving a request — a row edited on another page shows fresh
  without every mutator having to remember to invalidate it. A view that genuinely
  wants to coalesce repeat reads (an immutable catalog, say) opts in with `staleMs`,
  which switches `refetchOnMount` back to `'true'` so the cache is respected.
- **Explicit keys.** The `queryKey` must carry every input that affects the result.
  React Query stores entries under `['api', ...queryKey]`.

Other options cover the common cases: `skip` (conditional fetch), `refetchInterval`
(polling a live value without WebSocket plumbing), and `staleMs` (above). Writes go
through `useMutation` (`hooks/useMutation.ts`), which wraps TanStack's mutation hook
with the query client so a successful write can invalidate the affected reads.

### queryKey shape (binding)

Every `useApi` query key starts with a domain prefix and a resource:

```
['admin' | 'my' | 'user' | 'proxy', '<resource>', '<variant?>', ...stateVars]
```

For example `['admin', 'routing-rules', 'list', search, enabled, offset, limit]`,
`['admin', 'policies', 'detail', id]`, or `['admin', 'providers', 'list',
'model-list-picker']` where the variant suffix disambiguates two views of the same
resource. The domain prefix keeps one page's cache from colliding with another's.
`scripts/check-useapi-querykey.mjs` (in `check:all`) enforces it, flagging keys that
are empty, state-variables-only, or carry just a single string literal.

## 2. Information architecture

`packages/control-plane-ui/src/routes/shellRouteConfig.tsx` is the single source for
the authenticated shell's routes and its sidebar navigation metadata. The app
renders its routes from this list, and the sidebar builds its sections from the same
list via `buildSidebarNavSections()`, so a route and its nav entry never drift. Pages
are loaded lazily.

Navigation is organized into domain-driven sections (`NavSectionKey`): overview, AI
gateway, compliance, alerts, devices, infrastructure, IAM, system, and settings; each
section carries metadata for its title and collapse behavior. Per the pre-GA policy,
there are no backward-compatibility redirect routes — when a path moves or is renamed,
the old path is removed in the same change.

`Sidebar.tsx` (`components/ui/Sidebar/`) renders those sections and maps each route to
its icon. Because that icon mapping is a separate switch from the route config, a
rename can leave a dead icon arm behind; `scripts/check-sidebar-icon-mapping.mjs` (in
`check:all`) compares the two and reports any orphaned arm.

## 3. The shared component library

`packages/ui-shared` is the library both front-ends draw from — its `src/` holds the
shared `components`, the `shadcn` primitives, `lib` utilities, the `theme` token
system, the `i18n` shared namespace, `styles`, and `types`, exported through a public
barrel. Putting them here means the Control Plane UI and the Agent Dashboard render
the same components, tokens, and shared strings rather than maintaining parallel
copies.

`ui-shared` is a **dependency leaf**: it may import external packages (React,
react-i18next, Recharts, …) but must never import from a consumer bundle
(`packages/control-plane-ui`, `packages/agent`, or any other). The dependency edge
runs consumer → `ui-shared` only, never the reverse, which keeps it safely shared by
both. `scripts/check-ui-shared-boundary.mjs` (in `check:all`) scans the package and
fails on any import that crosses back into a consumer.

(This is the UI-bundle shared library; it is distinct from the Go `packages/shared`
module covered in
[shared-packages-architecture.md](../shared/shared-packages-architecture.md).)

## References

- `packages/control-plane-ui/src/hooks/useApi.ts` — the read hook + queryKey contract
- `packages/control-plane-ui/src/hooks/useMutation.ts` — the write hook + invalidation
- `packages/control-plane-ui/src/routes/shellRouteConfig.tsx` — single-source routes + nav metadata
- `packages/control-plane-ui/src/components/ui/Sidebar/Sidebar.tsx` — sidebar + icon mapping
- `packages/ui-shared/src/` — the shared component library (leaf dependency)
- `scripts/check-useapi-querykey.mjs`, `scripts/check-sidebar-icon-mapping.mjs`, `scripts/check-ui-shared-boundary.mjs` — the shell guards
