# @nexus-gateway/shared (Go)

Shared Go packages consumed by every Go service (`nexus-hub`,
`control-plane`, `ai-gateway`, `compliance-proxy`, `agent`). Linked via
`go.work` at the repo root using `replace` directives — every consumer
pins `v0.0.0` and points at this sibling directory, never at a real
pseudo-version (see CLAUDE.md "replace directives — workspace-sibling
contract" binding).

## Stability contract

API-stable additive-only once shipped in a released Agent binary. A
removed symbol is a binary-breaking change for the Agent fleet.

## Layout

The module is grouped into eight top-level buckets. The canonical structure map —
with a deep-dive link per bucket — is
[shared-packages-architecture.md](../../docs/developers/architecture/cross-cutting/shared/shared-packages-architecture.md);
this tree is the quick reference.

```
packages/shared/
├── audit/       — audit event types + body helpers (Body, SpillRef); cross-service consumer
├── core/        — bootenv, logging, diag (+ diag/runtimeintrospect), metrics, telemetry
├── identity/    — iam (NRN / RBAC), pkce, rstokenauth (X-RS-Token verifier)
├── policy/      — pipeline (hook executor), hooks, rulepack, payloadcapture, domain, device, decision
├── schemas/     — configkey, configtypes, credstate, domain, thingtype
├── storage/     — spillstore, spillupload, cacheconfig, configcache, configstore, redisfactory
├── traffic/     — traffic_event row builder + per-provider Tier-1 adapters/
└── transport/   — http, mq, thingclient, tlsbump, streaming, normalize, wirerewrite,
                   bodydecompress, responseio, bufconn, configloader, inputstaging, typology
```

## Dependency tier policy

| Tier | Where | Examples |
|------|-------|----------|
| **Core (always)** | The root `shared/` tree | `log/slog`, `pgx`, `prometheus/client_golang`, `tidwall/gjson`+`sjson`, `gopkg.in/yaml.v3`, `go.opentelemetry.io/otel*`, `golang.org/x/{net,sync}` |
| **Driver-scoped** | Lives only inside the relevant subpackage | `nats.go` → `transport/mq`; `aws-sdk-go-v2` → `storage/spillstore/s3`; `redis/go-redis/v9` → `storage/configcache`, spill subpackages; `coder/websocket` → `transport/thingclient`, `transport/http`; `golang-lru/v2` → `storage/configcache`, cert-cache; `klauspost/compress` → `transport/normalize`, `transport/tlsbump`, `transport/bodydecompress`; `google.golang.org/protobuf` → `traffic/adapters/`, `transport/normalize/extract/`; `joho/godotenv` → `core/bootenv`; `labstack/echo/v4` → any subpackage that exposes a Handler |

Adding a new dependency to the core tier requires explicit user
approval. The intent is that the root `shared` builds with a tiny dep
set; driver-scoped deps living in the umbrella `go.mod` is a known
shortcut that we'd split into per-module `go.mod`s when bandwidth
permits.

## Build / test

```bash
go build ./packages/shared/...
go test -race -count=1 ./packages/shared/...
```

There is no separate `make` target; `make build-all` includes shared
transitively via each service's build.

## Architecture references

- `docs/developers/workflow/conventions.md` — module-path / replace-directive rules.
- `docs/developers/architecture/cross-cutting/foundation/thing-model.md` — what `transport/thingclient` actually does at the wire level.
- `docs/developers/architecture/cross-cutting/shared/shared-package-architecture.md` — the canonical shared-package doc.
