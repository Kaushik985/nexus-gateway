# Control Plane architecture

The Control Plane is the Go admin API server — the management surface of the
gateway. It serves admin CRUD, the OAuth/OIDC authentication server, the agent
and internal APIs, and a BFF reverse proxy to the data-plane services (Nexus
Hub, AI Gateway, Compliance Proxy). It owns the configuration source-of-truth
tables; admin writes propagate to the data-plane Things through the Hub shadow.
This doc is the service front door — the route and auth model at a glance, an
index into the per-concern docs, and the thin platform substrate shared by
every admin domain.

## Request entry & route groups

The Control Plane runs a single Echo server. A global middleware stack wraps
every request: panic recovery, a Nexus request-ID stamp, an access log, and
request metrics. `/healthz` and the Prometheus `/metrics` endpoint are always
mounted.

Admin traffic is split into route groups, each with its own authentication:

| Group | Auth | Purpose |
|---|---|---|
| `/api/admin/*` | `AdminAuth` — an admin JWT (checked by the admin JWT verifier) or an admin API key | The full admin CRUD surface |
| `/api/admin/ai-gateway-simulator/forward` | bypasses `AdminAuth`; validates a virtual-key credential itself | Operator probe that replays a request against the gateway |
| `/api/internal/*` | internal service token | Hub→CP auth callbacks |
| `/api/my/*` | `AdminAuth` | Personal self-service for the signed-in user |
| `/scim/v2/*` | SCIM bearer token | SCIM 2.0 user / group provisioning |
| `/oauth/*`, `/authserver/*`, `/.well-known/*`, `/api/agent/sso-enroll` | per-endpoint (PKCE, OIDC state, enrollment code) | OAuth+PKCE admin login, external-IdP SSO, agent SSO enrollment — mounted by the auth server |

Every `/api/admin` route is wrapped by an IAM permission check: `iamMW(action)`
resolves to a `RequireIAMPermission` middleware, and device-scoped routes
(`/agent-devices/:id/...`) use a device-aware variant that resolves the
device's group memberships at request time so group-scoped policies enforce.
See [iam-identity-architecture.md](iam-identity-architecture.md).

## Admin domain map

The `/api/admin` surface is partitioned into domains, each owned by a handler
subpackage under `internal/`. Most domains have a dedicated sub-doc; the rest
are cross-cutting concerns documented elsewhere.

| Domain | Code | Where it is documented |
|---|---|---|
| AI providers, models, credentials, virtual keys (and approval), routing rules, quota, prompt/semantic/extract cache, gateway simulator | `internal/ai/` | [cp-ai-providers-virtualkeys-architecture.md](cp-ai-providers-virtualkeys-architecture.md) |
| Kill-switch, hooks, interception policy, AI-Guard, DSAR, exemptions, emergency passthrough, rule packs | `internal/governance/` | [cp-governance-compliance-admin-architecture.md](cp-governance-compliance-admin-architecture.md) |
| IAM policies / groups / attachments, users, organisations, projects, API keys, sessions, IdP and SCIM admin | `internal/identity/` | IAM, OAuth, JWT, SSO, tenancy docs below |
| Agent devices, device groups, fleet users | `internal/fleet/` | this doc |
| Traffic events, analytics, compliance reports, forward-proxy dashboard, admin audit log | `internal/traffic/` | this doc |
| Nodes BFF, runtime introspection, config-sync, jobs, per-Thing overrides, diagnostics, readiness | `internal/infrastructure/` | this doc |
| System settings, device-auth, cache management, observability, payload-capture, streaming-compliance | `internal/settings/` | this doc |
| Alerting, dead-letter queue, retention, ops-metrics, SIEM, per-Thing stats | `internal/observability/` | this doc |

Several domains do not store their own truth: the dead-letter-queue and
per-Thing-stats handlers proxy to or read Hub-owned tables, and the kill-switch,
passthrough, and retention handlers write through the Hub client. The platform
core below and the cross-cutting references cover those paths.

## Sub-doc index

| Concern | Doc |
|---|---|
| AI providers / models / credentials / virtual keys / routing / quota / cache admin | [cp-ai-providers-virtualkeys-architecture.md](cp-ai-providers-virtualkeys-architecture.md) |
| Governance & compliance admin (kill-switch, hooks, interception, AI-Guard, DSAR, exemptions, passthrough, rule packs) | [cp-governance-compliance-admin-architecture.md](cp-governance-compliance-admin-architecture.md) |
| IAM permission checks, action catalog, NRN building | [iam-identity-architecture.md](iam-identity-architecture.md) |
| OAuth + PKCE admin login, bearer issuance, refresh rotation | [oauth-pkce-admin-auth-architecture.md](oauth-pkce-admin-auth-architecture.md) |
| Multi-issuer JWT validation, JWKS polling | [jwt-verifier-architecture.md](jwt-verifier-architecture.md) |
| External-IdP SSO (OIDC / SAML), JIT provisioning, SCIM | [idp-sso-architecture.md](idp-sso-architecture.md) |
| Organisation + project hierarchy, policy inheritance | [organization-hierarchy-architecture.md](organization-hierarchy-architecture.md) |
| Virtual-key → organisation resolution | [vk-org-resolution.md](vk-org-resolution.md) |

## Platform core

The substrate under `internal/platform/` and `internal/store/` is shared by
every admin domain.

**Admin HTTP stack.** Echo with the global middleware described above.
`AdminAuth` (`internal/platform/middleware`) accepts either an admin JWT or an
admin API key.

**Database.** `internal/store` is a hand-written pgx layer; every query is
hand-written SQL matching the Prisma schema (no sqlc). Each subsystem owns a
sub-store — `agentstore`, `iamstore`, `userstore`, `trafficstore`, `modelstore`,
`credstore`, and others. The `DB` wrapper exposes two views of one pool: `Pool`,
the concrete `*pgxpool.Pool` used by transaction code and by constructors that
take the concrete type, and `InternalPool()`, the interface view used by store
methods and satisfied by a pgxmock pool in tests.

**Credential vault.** `internal/platform/crypto` provides the AES-256-GCM vault
(and a multi-key vault) that encrypts provider credentials at rest. The
encryption scheme and the gateway-side decrypt path are in
[credentials-architecture.md](../../cross-cutting/safety/credentials-architecture.md).

**Hub client.** `internal/platform/hub` is the Control Plane's connection to
Nexus Hub; the Control Plane itself registers as a Thing. Admin writes reach the
data-plane Things two ways: `NotifyConfigChange` pushes a specific config blob
into a Thing's shadow and returns the Hub response, while the invalidate signal
tells the owning Things to re-read the changed config from their own store on the
next request. The invalidate signal has two variants: `InvalidateConfig` is
fire-and-forget (errors are logged) for non-security keys that self-heal on the
next write or the reconcile loop, and `InvalidateConfigE` returns the push error
so security-sensitive Type-B writes — credentials, virtual keys, routing rules,
quota policies/overrides, providers, models — can return HTTP 502 with a
`propagation_error` envelope rather than a false 2xx when the push to Hub fails.
Every security-sensitive handler routes through one truthful propagation path:
Category-A full-state pushes call `PushTypeA` and all failures render the single
canonical 502 via `RespondPropagationFailure`, so cache, passthrough, kill switch,
and every Type-B domain emit the identical envelope instead of the five divergent
policies they grew by accretion. `InvalidateConfigE` additionally records the
Category-B propagation ledger (see Config reconciliation below) so a missed push
self-heals. The same client reverse-proxies the Hub-owned
operations the Control Plane exposes under `/api/admin` — dead-letter-queue
listing and retry, force-resync, enrollment-token creation, agent certificate
rotation, and per-Thing runtime reads. The Control Plane consumes only two of
its own shadow keys through the config loader: `observability` (reconfigure the
telemetry provider) and `log_level` (set the process log level); unknown keys
are echoed back unchanged so Hub observes no spurious drift. The shadow model
and config propagation are in
[configuration-architecture.md](../../cross-cutting/foundation/configuration-architecture.md)
and
[thing-config-sync-architecture.md](../../cross-cutting/foundation/thing-config-sync-architecture.md).

**Config reconciliation.** `internal/platform/configreconcile` is a periodic
drift watchdog with two complementary arms. The **content-diff arm** compares the
Control Plane's source-of-truth value for a watched Category-A key against every
online Thing's `thing.desired.<key>`; on divergence it logs a warning, increments
`cp_config_drift_total`, and re-emits `NotifyConfigChange` to heal. Its watch set
covers the emergency-grade keys whose silent drift would be unsafe: the
prompt-cache blob (AI Gateway), agent settings (Agent), the kill-switch
(Compliance Proxy and Agent), and emergency passthrough (AI Gateway). The
**Category-B pending arm** closes the same loop for keys that carry no state into
`thing.desired` and so cannot be content-diffed (credentials, virtual keys,
routing rules, quota, providers, models): the Hub client records an intended vs
acknowledged version per `(thing type, config key)` in a durable ledger (the
`system_metadata` table, one row per key under the `propagation_ledger:` prefix) —
bumping the intended version before each `InvalidateConfigE` push and stamping the
acknowledged version only on success. Each cycle `ReconcilePending` re-pushes any
key whose last push was never confirmed, so a push lost to a Hub restart/blip
during an admin save self-heals without an admin retry. Together the two arms are
the out-of-band repair path for divergence a failed push or a mid-broadcast Hub
reconnect could otherwise leave in place. See
[kill-switch-architecture.md](../../cross-cutting/safety/kill-switch-architecture.md)
and
[emergency-passthrough-architecture.md](../../cross-cutting/safety/emergency-passthrough-architecture.md).

**Admin-audit writer.** `internal/platform/audit` publishes one audit message
per admin mutation to MQ. The Control Plane is a pure formatter-and-publisher:
the tamper-evident hash chain is computed Hub-side, so concurrent Control Plane
replicas need no shared chain head. Writes use a detached context, so a client
disconnect cannot cancel the audit write, and publish failures surface through a
failure-observer counter plus a warning log rather than failing the user
request. The MQ pipeline and the Hub-side consumer are in
[audit-pipeline-architecture.md](../../cross-cutting/observability/audit-pipeline-architecture.md).

**Metrics & telemetry.** `internal/platform/metrics` registers the Prometheus
surface served at `/metrics`; the OpenTelemetry provider is reconfigurable at
runtime through the `observability` shadow key.

## Boot sequence

`cmd/control-plane` wires the service in order: load config and logger → connect
Postgres and Redis → initialise telemetry → open the credential vault → build
the IAM engine → connect MQ → start the revocation service → build the admin JWT
verifier → build the audit writer → register with Hub (which also installs the
diagnostic log sink) → create the Echo server and the runtime-introspection
endpoints → mount the admin, internal, personal, and SCIM routes → register
readiness checks → mount the auth server → start the config-reconcile loop →
serve until signal.

## References

- `packages/control-plane/cmd/control-plane/` — entry point and wiring
- `packages/control-plane/internal/handler/` — admin route registration
- `packages/control-plane/internal/platform/middleware/` — auth and global middleware
- `packages/control-plane/internal/platform/hub/` — Hub client and config push
- `packages/control-plane/internal/platform/configreconcile/` — config drift watchdog
- `packages/control-plane/internal/platform/audit/` — admin-audit MQ writer
- `packages/control-plane/internal/platform/crypto/` — credential vault
- `packages/control-plane/internal/store/` — hand-written pgx store layer
- `packages/control-plane/internal/ai/` — AI provider / virtual-key / routing / quota / cache admin
- `packages/control-plane/internal/governance/` — kill-switch / hooks / interception / DSAR / exemptions admin
- `packages/control-plane/internal/identity/` — IAM, auth server, JWT, SSO, SCIM
- `packages/control-plane/internal/fleet/` — agent device and fleet admin
- `packages/control-plane/internal/traffic/` — traffic events, analytics, admin audit log
- `packages/control-plane/internal/infrastructure/` — nodes BFF, runtime, diagnostics
- `packages/control-plane/internal/settings/` — system settings and device defaults
- `packages/control-plane/internal/observability/` — alerting, DLQ, retention, ops-metrics, SIEM
