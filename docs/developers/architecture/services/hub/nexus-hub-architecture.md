# Nexus Hub architecture

The Nexus Hub is the platform operations center. It owns the Thing registry and
config-sync authority, runs the scheduled-job fleet, is the sole service that
writes the `traffic_event` and `AdminAuditLog` tables, and serves the Hub
HTTP/WebSocket API that every other service and the Control Plane talk to. This doc is the service front door — the boot sequence, the HTTP
surface, the thin core that does not warrant its own doc, and an index into the
per-concern docs.

The four data-plane services (Control Plane, AI Gateway, Compliance Proxy,
Agent) register with the Hub as Things and pull their config from it. The Hub
itself is also a Thing — it writes its own registry row directly (see
[Self-registration](#self-registration-and-self-shadow)).

## Boot sequence

`cmd/nexus-hub/main.go` wires the process in dependency order; each `wiring.Init*`
helper returns a typed result the next stage consumes:

1. `bootenv.LoadFromRepoRoot` then `config.Load` — YAML + env overrides (see
   [Configuration load](#configuration-load)).
2. Infrastructure: `InitDB` (pgx pool), `InitRedis`, `InitMQ` (NATS JetStream).
3. `InitStorage` — the main `store.Store` plus the spill backend and the Cat B
   loader registry. A one-shot `RunConfigKeyAudit` then WARNs (without failing
   boot) on any `thing_config_template` row whose `(type, key)` is not registered
   in `configkey.ValidByThingType`.
4. `InitConsumerManager` — starts the MQ consumers (see [HTTP and WebSocket
   surface](#http-and-websocket-surface) for what feeds them).
5. `InitIdentity` — Agent CA, enrollment service, JWKS cache (see
   [nexus-hub-enrollment-architecture.md](nexus-hub-enrollment-architecture.md)).
6. `InitFleet` — the Thing manager and the WebSocket server/pool.
7. `InitOpsMetrics`, `InitDiagSink`, `StartWSSignalSubscriber` — observability
   plus the MQ→WS signal fan-out that pushes config-changed notifications to
   connected Things.
8. `InitSelfReg`, `InitOTEL`, `InitSelfShadow`, `InitSelfInstrumentation` — the
   Hub's own Thing row, tracing, and live-reload listener.
9. `InitAlerts`, `InitSIEMBridge`, `InitScheduler` — alert engine, SIEM
   forwarder, and the scheduled-job pool (gated by `scheduler.enabled`).
10. `BuildEchoConfig` → `InitEcho` → `MountRoutes` — the HTTP server.

Shutdown is signal-driven (`SIGINT`/`SIGTERM`): `GracefulShutdown` stops the
Echo server, deregisters the Hub Thing, drains the WS server and consumers, and
closes the enroll API within `server.shutdownTimeout`.

## HTTP and WebSocket surface

`internal/handler/routes.go` registers every route across three auth domains.
Echo matches routes in registration order, so static prefixes are always
registered before their parametric `:id` siblings.

| Group | Auth | Caller | Purpose |
|---|---|---|---|
| `/api/hub/*` | service token (`ServiceAuth`) | Control Plane | Thing list/detail/shadow, per-Thing config overrides, drift, config history + catalog, job list/trigger, dead-letter-queue admin, enrollment-token mint, runtime-introspection bridge |
| `/api/internal/things/*` | device-or-service auth (`DeviceOrServiceAuth`) | Agents + data-plane services | register, heartbeat, shadow report, bulk + single config pull, audit upload, agent-audit upload, exemption upload, update-check, cert renew, attestation-pubkey lookup, spill-upload mint, diag-event drain |
| `/api/v1/alerts/*`, `/api/v1/admin/alerts/*` | device token / service token | data-plane producers / Control Plane | raise/resolve alerts; admin rule + channel + alert CRUD |

Three routes sit outside those groups: `GET /api/public/agent-bootstrap`
(unauthenticated — pre-enrollment agents discover the CP URL and current
`device_auth_mode`), `POST /api/internal/things/enroll` (the enrollment
handshake, gated by its own JWT/CSR validation), and `GET /ws` (the WebSocket
upgrade). Health and observability endpoints (`/healthz`, `/readyz`, `/metrics`,
`/debug/runtime`) are mounted directly on the Echo instance in `InitEcho`.

**Hub exposes no user-JWT-protected HTTP surface.** End-user and admin
operations reach the Hub only through the Control Plane's `/api/admin/*` routes,
which proxy to `/api/hub/*` using the internal service token. Direct browser or
end-user traffic to the Hub is not part of the deployment topology.

The MQ consumers behind `InitConsumerManager` are where the data-plane traffic
lands: the `traffic-event-writer` drains three event queues into `traffic_event`
(consumer group `hub-db-writer`) — the Hub is the sole writer of that table; the
`admin-audit-writer` drains admin-audit events into `AdminAuditLog`; an
exemption consumer applies agent-reported exemptions. The MQ pipeline and the
`*_normalized` sidecar are owned by
[audit-pipeline-architecture.md](../../cross-cutting/observability/audit-pipeline-architecture.md);
SIEM forwarding by
[siem-bridge-architecture.md](../../cross-cutting/observability/siem-bridge-architecture.md).

## Thin core

### Configuration load

`internal/config/config.go` loads `nexus-hub.config.yaml`, applies `NEXUS_HUB_*`
and shared env overrides, then validates. A missing file is not an error —
defaults apply. Secrets are env-only: `auth.internalServiceToken` is tagged
`yaml:"-"` and read from `INTERNAL_SERVICE_TOKEN` so a stale YAML field cannot
override the env value. `publicURL` is required — it is reported to the Thing
Registry as `staticInfo` so the admin UI can render the Hub endpoint without a
hardcoded hostname. The `authServer` block (`jwksURL` / `issuer` / `url`) carries
the OAuth verification parameters that must match the Control Plane side; see
[nexus-hub-enrollment-architecture.md](nexus-hub-enrollment-architecture.md).
The four-layer config model and the env/YAML split are owned by
[configuration-architecture.md](../../cross-cutting/foundation/configuration-architecture.md).

### Route registration

`handler.SetupRoutes` takes a single `RouteConfig` struct holding every wired
subsystem and registers the groups above. Several handlers are registered
conditionally on their dependency being non-nil — the runtime bridge only when
the store is present, the admin-alerts group only when the alert store + rule +
sender registries are wired, the agent-bootstrap endpoint only when `cfg.CpURL`
is set, the enroll route only when the Agent CA is configured. This keeps test
harnesses able to call `SetupRoutes` with a partial config.

### Self-registration and self-shadow

The Hub cannot call its own enrollment endpoints, so `internal/self/reg` writes
the Hub's `thing` row directly with type `nexus-hub`. A heartbeat loop refreshes
`last_seen`; if the row is pruned mid-run (for example by a dev DB reset), the
loop self-heals by re-upserting it, so Hub metrics keep landing instead of
failing the `metric_ops_raw` foreign key. The Hub's `role` (`scheduler` vs
`default`) is derived from `scheduler.enabled`.

`internal/self/shadow` subscribes to the PostgreSQL `LISTEN config_changed`
channel, filters to the Hub's own instance ID, and dispatches per-key reload
handlers. Two keys are live-reloadable: `observability` reconfigures the
swappable tracer provider, and `log_level` swaps the slog level in place. The
Thing-shadow contract these ride on is owned by
[thing-config-sync-architecture.md](../../cross-cutting/foundation/thing-config-sync-architecture.md).

### Agent compliance-config aggregation (Cat B)

Category B config keys are not stored as inline shadow state — their
authoritative value lives in Control Plane business tables. When an agent pulls a
Cat B key via `GET /api/internal/things/config/:key`, the handler dispatches to a
`CatBLoader` registered in the `store.CatBRegistry`. `wiring/storage.go`
registers seven `(agent, key)` loaders from `internal/compliance/catbagent`:
hook configs, interception domains, payload-capture settings, streaming-compliance
settings, installed rule packs, user context, and exemptions. Each loader reads
the relevant CP tables from the Hub DB pool and returns a state shape that
matches the agent's ShadowApplier verbatim.

Two contract rules are load-bearing. An **empty scope returns `{}`** (an empty
JSON object), which agents treat as "leave local defaults intact" — a loader must
never return an authoritative empty list, which would wipe the agent's local YAML
defaults. A **loader error surfaces a 500** and the handler deliberately does not
fall back to the `thing_config_template.state` path, because a silent fallback
would replay an empty payload to the Thing on a transient DB blip.

The hook loader additionally enriches rule-pack-backed hooks with their bound
installs (`rulepack.Enrich`) before shipping, so rule-pack-engine hooks arrive
ready to evaluate; the same enrichment runs in AI Gateway and Compliance Proxy.
Today every agent sees every enabled hook — per-agent scoping by device group is
not yet wired and would only change the loader's `WHERE` clause.

## Sub-doc index

| Concern | Doc |
|---|---|
| Hub-side agent enrollment authority: token lifecycle, device CA, enrollment-JWT validation, bootstrap | [nexus-hub-enrollment-architecture.md](nexus-hub-enrollment-architecture.md) |

## Cross-cutting concerns the Hub implements

The Hub is the implementation site for many platform-wide concerns, but each is
documented as a cross-cutting concern rather than duplicated here:

| Concern | Doc |
|---|---|
| Internal Thing/Shadow model + IoT terminology mapping | [thing-model.md](../../cross-cutting/foundation/thing-model.md) |
| Config-sync: desired/reported state, drift, change-signal push | [thing-config-sync-architecture.md](../../cross-cutting/foundation/thing-config-sync-architecture.md) |
| Hub coordination + service-call framework | [service-call-framework.md](../../cross-cutting/foundation/service-call-framework.md) |
| Scheduled jobs: cron pool, retention purge, drift check | [jobs-architecture.md](../../cross-cutting/foundation/jobs-architecture.md) |
| Audit MQ pipeline + db-writer consumer + `*_normalized` sidecar | [audit-pipeline-architecture.md](../../cross-cutting/observability/audit-pipeline-architecture.md) |
| SIEM bridge poll/checkpoint, sink, wire formats | [siem-bridge-architecture.md](../../cross-cutting/observability/siem-bridge-architecture.md) |
| Per-Thing stats + quota rollup | [metrics-rollup-architecture.md](../../cross-cutting/observability/metrics-rollup-architecture.md) |
| Alert rule engine + dispatch + channels | [alerting-architecture.md](../../cross-cutting/observability/alerting-architecture.md) |
| `/debug/runtime` snapshot + `/runtime/*` introspection bridge | [runtime-introspection-architecture.md](../../cross-cutting/observability/runtime-introspection-architecture.md) |
| Retention purge + DSAR erasure jobs | [data-retention-purge-architecture.md](../../cross-cutting/storage/data-retention-purge-architecture.md) |
| Quota sliding window + scoping | [quota-architecture.md](../../cross-cutting/safety/quota-architecture.md) |
| Emergency passthrough + kill-switch expiry job | [emergency-passthrough-architecture.md](../../cross-cutting/safety/emergency-passthrough-architecture.md) |

## References

- `packages/nexus-hub/cmd/nexus-hub/` — service entry point and `wiring/` helpers
- `packages/nexus-hub/internal/config/` — YAML + env config load and validation
- `packages/nexus-hub/internal/handler/` — route registration, middleware, service auth
- `packages/nexus-hub/internal/fleet/` — Thing registry, manager, shadow, overrides
- `packages/nexus-hub/internal/self/` — Hub self-registration and self-shadow
- `packages/nexus-hub/internal/storage/store/` — main store and Cat B loader registry
- `packages/nexus-hub/internal/compliance/catbagent/` — agent Cat B config loaders
- `packages/nexus-hub/internal/observability/consumer/` — MQ consumers (traffic-event, admin-audit, exemption)
- `packages/nexus-hub/internal/ws/` — WebSocket server, pool, signal fan-out
