# Domain matching & device predicate architecture

Two shared matching primitives drive interception policy: the **domain engine**
decides whether (and how) a host is intercepted, and the **device predicate**
decides which devices a smart group contains. Both live in
`packages/shared/policy` and are consumed across services.

## 1. Domain engine

`domain.Engine` (`packages/shared/policy/domain/engine.go`) holds the active
`InterceptionDomain` set and answers the hot-path questions on the forward path
(it is consumed by the shared `tlsbump` forward handler, the Agent network
bridge, and the compliance-proxy wiring).

- **`Swap(domains)`** atomically replaces the matcher set, sorted by priority
  descending, compiling a regexp per domain whose `HostMatchType` is `REGEX`.
- **`MatchHost(host)`** returns the highest-priority enabled `InterceptionDomain`
  whose pattern matches, or nil. `HostMatchType` is one of `EXACT`, `GLOB`,
  `PREFIX`, `REGEX`.
- **`PathAction(domain, path)`** resolves the effective action for a request
  path: the domain's `InterceptionPath` rules (`PathMatchType` `PREFIX` / `EXACT`
  / `REGEX`) override the domain `defaultPathAction`. A `PathAction` is `PROCESS`
  (bump + run the pipeline), `PASSTHROUGH` (tunnel without inspection), or
  `BLOCK` (reject with a 4xx before any hook runs).
- **`AllowlistEntries()`** / **`Snapshot()`** expose the current set for the
  access allowlist and for read surfaces.

Each `InterceptionDomain` carries the `adapterId` that selects the
`traffic.Adapter` for the flow (see
[compliance-pipeline-architecture.md](compliance-pipeline-architecture.md)), a
`NetworkZone` (`PUBLIC` / `INTERNAL`) stamped onto audit events, and an
`on_adapter_error` behaviour (`FAIL_OPEN` / `FAIL_CLOSED`). The in-memory types
mirror the `InterceptionDomain` / `InterceptionPath` models in
`tools/db-migrate/schema/compliance.prisma`; the forward gate that consumes the result is in
[compliance-proxy-connect-forward-architecture.md](compliance-proxy-connect-forward-architecture.md).

## 2. Device predicate

`device.Evaluate` (`packages/shared/policy/device/predicate.go`) is a pure,
stateless matcher that decides whether a `Device` satisfies a membership
predicate. It backs smart-group membership — the Hub drift job recomputes
members and the Control Plane fleet handler previews them.

- **`Device`** is the pre-loaded fact set: OS / version, agent version,
  hostname, primary IP, physical ID, status, bound user + org path, enrolment /
  heartbeat timestamps, free-form `Metadata` (string-valued, keyed
  `metadata.<key>`), `IdpGroupIDs` (the bound user's IamGroup memberships,
  pre-loaded so the matcher stays stateless), and `Tags`.
- **`Predicate`** is the parsed JSON wire shape — exactly one of `all` or `any`
  at the top level; nested groups are not allowed. Each **`Leaf`** is one
  `{field, op, value}` triplet (operators include `idp_group_member`,
  `tags_contains`, and relative-time comparisons against the passed `now`).
- **Semantics.** An empty predicate matches **nothing** — the explicit
  quarantine pattern (zero members today). A field that is empty on the device
  is **not** an error; it simply does not match. `Evaluate` returns an error only
  for predicate-shape mistakes (unknown field/op, malformed regex), leaving
  escalation to the caller.

## References

- `packages/shared/policy/domain/engine.go` — host matcher, `MatchHost`, `PathAction`, `Swap`
- `packages/shared/policy/domain/types.go` — `HostMatchType`, `PathAction`, `NetworkZone`, `AdapterErrorBehavior`, `InterceptionDomain` / `InterceptionPath`
- `packages/shared/policy/device/predicate.go` — `Device`, `Predicate`, `Leaf`, `Evaluate`
- `tools/db-migrate/schema/compliance.prisma` — `InterceptionDomain`, `InterceptionPath` models
- `packages/nexus-hub/internal/jobs/defs/drift/smart_group_recompute.go` — smart-group membership recompute
