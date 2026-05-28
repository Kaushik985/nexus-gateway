# IAM & identity

IAM is the authorization layer for the Control Plane admin API. A canonical
resource/verb taxonomy feeds three consumers that all speak the same action
strings: the policy engine that decides allow or deny, the request-time
middleware that gates every admin route, and the admin UI that gates its nav
items and routes. Keeping those three in lockstep on one action string is what
makes a permission grant mean the same thing end to end.

## Canonical catalog

`packages/shared/identity/iam/` is the single source of truth for the resource
type set, the verb set permitted on each resource, the action-string format, the
NRN template, and the SIEM event-type format. A `ResourceDef` carries a
kebab-case `Name`, an owning `Service`, and a closed list of permitted `Verbs`.
Five services partition the catalog — `gateway`, `compliance`, `agent`,
`platform`, and `iam` — and become the second segment of every NRN. The verb set
is closed: standard CRUD plus lifecycle verbs such as `approve`, `revoke`,
`renew`, `toggle`, `simulate`, `export`, `emergency-enable`, `probe`, `rotate`,
`import`, `fulfill`, and `enroll`.

From a `ResourceDef` the catalog derives every identifier mechanically:
`Action(verb)` returns `admin:<resource>.<verb>` and panics at startup if the
verb is not declared on the resource; `NRN(scope, id)` returns
`nrn:nexus:<service>:<scope>:<resource>/<id>`; and `SIEMEventType` returns
`<resource>.<verb>` — the action body with the `admin:` prefix stripped, so an
operator sees the same string in an IAM policy and in a SIEM filter. Handlers
must construct identifiers through these helpers; hand-typed `admin:…` strings
and audit-entity literals are prohibited by CI consistency gates. `AllActions`
enumerates the full action set and feeds the per-principal permissions endpoint.

## NRN scheme

`packages/control-plane/internal/identity/iam/nrn.go` defines the Nexus Resource
Name: `nrn:nexus:<service>:<scope>:<resourceType>/<resourceID>`. A policy's
`Resource` patterns and a request's resource are both NRNs, matched segment by
segment. Service, resource type, and resource id match with glob wildcards (`*`
matches any segment, `gpt-*` matches `gpt-4o`). The scope segment matches
hierarchically: a pattern of `org-acme` matches both `org-acme` and
`org-acme/engineering`, so an organisation-scoped grant covers its descendant
projects — see [organization-hierarchy-architecture.md](organization-hierarchy-architecture.md).

`BuildRequestNRNForAction` derives the NRN a request is checked against from the
action alone: it parses the resource and looks up the owning service in the
catalog, producing `nrn:nexus:<service>:*:<resource>/*` so resource-scoped
policies evaluate correctly; a non-canonical action falls back to a
fully-wildcarded NRN. `BuildDeviceCandidateNRNs` expands a device action into the
unscoped resource plus one `group:<group-id>/<device-id>` candidate per group the
device belongs to.

## Policy model and evaluation

A policy is an AWS-style document — a `Version` and a list of `Statement`s, each
with an `Effect` of `Allow` or `Deny`, an `Action` list, a `Resource` list, and
an optional `Condition` block. Action and resource lists accept either a single
string or an array. The engine
(`packages/control-plane/internal/identity/iam/engine.go`) evaluates a statement
as a match when its action pattern globs the request action, any of its resource
patterns matches the request resource, and its conditions hold. The decision
order is explicit `Deny` over explicit `Allow` over default deny; a `Deny` that
matches any candidate resource denies the whole request, so a scoped `Deny` can
override a broader `Allow`.

`EvaluateMulti` is the candidate-list form: the same request can be authorised
by an unscoped grant or by a group-scoped grant, so the device-group candidates
and the unscoped resource are all scanned and any matching `Allow` authorises the
call. Conditions
(`packages/control-plane/internal/identity/iam/conditions.go`) support operators
including `StringEquals`, `StringLike`, `IpAddress`, the numeric comparators, and
the date comparators, evaluated against a request context that carries
`nexus:SourceIp` and `nexus:CurrentTime`.

Policies are loaded per principal through a `PolicyLoader`; the production loader
reads a principal's direct policy attachments unioned with the policies of every
group the principal belongs to (enabled policies only). Results are cached: an
in-process L1 cache always, and an optional Redis L2 cache when the engine is
built with the Redis option. Only non-empty policy sets are cached, and the
engine exposes per-principal and global cache invalidation. Each evaluation
reports whether it was a cache hit, which feeds the `cache` label on the
`iam.eval_total` metric.

## Principals, groups, and managed roles

IAM stores attachments and group memberships keyed on a principal type and id.
The principal type is `nexus_user` (a dashboard session's `admin_user` type is
mapped to it before any IAM lookup) or `api_key`. A principal receives policies
either by a direct attachment or by membership in a group that has policies
attached.

Built-in groups and managed policies are seeded — groups such as `super-admins`,
`provider-admins`, `security-admins`, and `viewers`, and managed policies such as
`NexusSuperAdmin` (every action on every resource), `NexusProviderAdminAccess`,
`NexusSecurityAdminAccess`, `NexusViewerAccess` (the read-only set across the
catalog), and `NexusIncidentResponse`. The catalog documents which service each
role owns — the provider-admin role owns the gateway service, the security-admin
role owns compliance and agent, and the viewer role reads across the catalog.

## Request-time enforcement

`packages/control-plane/internal/platform/middleware/iamauth.go` is where a grant
becomes an allow or a 403. Handlers wrap each admin route with
`iamMW(action)`, which is `RequireIAMPermission` bound to the engine and a
catalog action. The middleware requires an authenticated admin (401 otherwise),
short-circuits for the `bootstrap` and `dev` principals, derives the request NRN
via `BuildRequestNRNForAction` (or a caller-supplied resource function), maps the
session principal type to the IAM type, and evaluates. On a deny it returns 403
with an `IAM_ACCESS_DENIED` body carrying the action, resource, and reason; every
evaluation increments `iam.eval_total` labelled by decision and cache outcome.

`RequireIAMPermissionForDevice` is the device-scope-aware variant for routes that
act on a single agent-device identified by a path parameter. It resolves the
device's group memberships through a `DeviceGroupLookup` and evaluates against the
candidate NRN list. The resolution fails closed: a nil lookup or a lookup error
leaves the device with no group memberships, so a scoped-policy admin is denied
while a fleet-wide grant still allows the call.

## UI and handler in lockstep

The admin UI gates the same way, against the same action strings. The route
configuration (`packages/control-plane-ui/src/routes/shellRouteConfig.tsx`)
declares an `allowedActions` list per route and per nav item, and the
`RequireRole` guard renders a route only when the signed-in principal's
permissions intersect that list. Those permissions come from the per-principal
permissions endpoint, which evaluates every catalog action for the caller.

Because the UI and the handler both key on the canonical action string, the two
must stay aligned: if a route's `allowedActions` and the handler's `iamMW(action)`
name different actions, the UI shows a page the API then denies — a silent 403.
Any change that adds, moves, renames, or removes an admin endpoint, a nav item,
or a route path therefore has to update both sides to the same action.

## References

- `packages/shared/identity/iam/` — canonical resource/verb/service catalog
- `packages/control-plane/internal/identity/iam/` — engine, NRN, conditions, cache, validator
- `packages/control-plane/internal/platform/middleware/iamauth.go` — request-time enforcement middleware
- `packages/control-plane/internal/identity/users/iamstore/` — policy / group / attachment storage + loader
- `packages/control-plane/internal/identity/users/handler/me.go` — per-principal permissions endpoint
- `packages/control-plane-ui/src/routes/shellRouteConfig.tsx` — UI route + nav `allowedActions`
- `packages/control-plane-ui/src/auth/guards/RequireRole.tsx` — UI permission guard
- `tools/db-migrate/seed/data/seed-baseline.sql` — seeded managed policies + built-in groups
