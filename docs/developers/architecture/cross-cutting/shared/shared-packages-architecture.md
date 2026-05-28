# Shared packages architecture

`packages/shared` is the one Go module every service shares — Nexus Hub, Control
Plane, AI Gateway, Compliance Proxy, and the Agent all import it. It holds the
cross-service types, transport primitives, policy engine, and schemas that would
otherwise drift if each service kept its own copy. This doc is the map of that
module: how it is wired into the services, how its code is bucketed, the
dependency discipline that keeps it lean, and the stability contract that keeps
the deployed Agent fleet from breaking.

It is a structural map, not a deep-dive — each bucket links to the architecture
doc that covers it in depth.

## 1. One module, every service

`packages/shared` is a single Go module. The workspace `go.work` at the repo root
lists it alongside the five services and the integration tests, and every service
reaches it through a `replace` directive that pins `v0.0.0` and points at the
sibling directory rather than a published pseudo-version. This is a binding
contract: a `replace` that points anywhere but the sibling source makes a
`GOWORK=off` build silently pull a stale snapshot instead of the working tree.

## 2. The eight buckets

The module is grouped into eight top-level buckets:

| Bucket | Holds | Depth doc |
| --- | --- | --- |
| `audit/` | Audit event types and body helpers (`Body`, `SpillRef`) shared by every emitter | [audit-pipeline](../observability/audit-pipeline-architecture.md) |
| `core/` | Process-lifetime primitives: `bootenv`, `logging`, `diag` (incl. `diag/runtimeintrospect`), `metrics`, `telemetry` | [otel-tracing](../observability/otel-tracing-architecture.md), [diag-event-triage](../observability/diag-event-triage-architecture.md), [runtime-introspection](../observability/runtime-introspection-architecture.md), [prometheus-naming](../observability/prometheus-naming-architecture.md) |
| `identity/` | Auth + crypto: `iam` (NRN/RBAC), `pkce`, `rstokenauth` | [iam-identity](../../services/control-plane/iam-identity-architecture.md) |
| `policy/` | Hook engine + policy data: `pipeline` (hook executor), `hooks`, `rulepack`, `payloadcapture`, `domain`, `device`, `decision` | [hook-architecture](../../services/ai-gateway/hook-architecture.md), [pii-redaction](../safety/pii-redaction-policy-architecture.md), [domain-device-predicate](../../services/compliance-proxy/domain-device-predicate-architecture.md) |
| `schemas/` | Config + type definitions: `configkey`, `configtypes`, `credstate`, `domain`, `thingtype` | [configuration](../foundation/configuration-architecture.md), [db-migration-mechanics](../storage/db-migration-mechanics-architecture.md) |
| `storage/` | Durable + cache layers: `spillstore`, `spillupload`, `cacheconfig`, `configcache`, `configstore`, `redisfactory` | [spillstore](../storage/spillstore-architecture.md), [cache-multi-tier](../storage/cache-multi-tier-architecture.md) |
| `traffic/` | The `traffic_event` row builder and the per-provider Tier-1 `adapters/` | [provider-adapter](../../services/ai-gateway/provider-adapter-architecture.md) |
| `transport/` | Network I/O and request-shape transforms: `http`, `mq`, `thingclient`, `tlsbump`, `streaming`, `normalize`, `wirerewrite`, `bodydecompress`, `responseio`, `bufconn`, `configloader`, `inputstaging`, `typology` | [normalization](../../services/ai-gateway/normalization-architecture.md), [shared-wirerewrite](shared-wirerewrite-architecture.md), [thing-config-sync](../foundation/thing-config-sync-architecture.md), [mq](../foundation/mq-architecture.md) |

Each bucket's deep behavior lives in its linked doc; this table is the index a
contributor reads to find where a concern lives before editing.

## 3. Dependency-tier discipline

The shared module's third-party dependencies are deliberately controlled, because
every dependency it pulls is a dependency the Agent binary pulls. Two tiers:

- **Core tier** — vetted dependencies usable freely across the module:
  `log/slog`, `jackc/pgx/v5`, `prometheus/client_golang`, `tidwall/gjson` +
  `sjson`, `gopkg.in/yaml.v3`, the `go.opentelemetry.io/otel*` set,
  `golang.org/x/{net,sync}`, and `google/uuid`.
- **Driver-scoped** — a heavier dependency lives only inside the one subpackage
  that needs it, never at the root. For example `nats.go` is imported only by
  `transport/mq`, `aws-sdk-go-v2` only by `storage/spillstore/s3`,
  `coder/websocket` only by `transport/thingclient` and `transport/http`, and
  `redis/go-redis` only by the cache and spill subpackages.

The `require` block in `packages/shared/go.mod` is the authoritative vetted set.
Adding a new shared dependency is a deliberate, reviewed decision, not a casual
import — the goal is a lean, auditable dependency surface for the fleet.

## 4. Stability contract

The shared API is **additive-only once a symbol has shipped in a released Agent
binary**. Deployed agents pin a specific build, so removing or renaming an
exported symbol is a binary-breaking change for the field fleet, not just a
refactor. The discipline is: add new surface, and leave shipped surface in place;
when something genuinely must change shape, do it additively and migrate callers
before retiring the old form.

Combined with the `replace`-sibling contract from [§1](#1-one-module-every-service),
this is what lets all five services build against one evolving module without a
publish-and-bump cycle and without surprising the Agent fleet.

## References

- `packages/shared/` — the shared Go module (eight buckets)
- `packages/shared/go.mod` — the authoritative dependency set
- `packages/shared/README.md` — quick layout + dependency-tier table
- `go.work` — workspace wiring for all services + the shared module
