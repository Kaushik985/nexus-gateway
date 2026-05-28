# Runtime introspection architecture

Runtime introspection is the operator-facing way to read the **live in-memory
state of a running service** — the configuration it has actually applied, the
caches it currently holds, the shape of its process-local runtime structures —
without adding a bespoke endpoint for every question. It answers "the admin
pushed a config template; did this service actually receive, parse, and apply
it?" by showing what the process holds *now*, next to what Hub believes is
desired.

## What this doc covers (and what it does not)

This doc covers the cross-cutting introspection surface shared by the four
server-side services (Nexus Hub, Control Plane, AI Gateway, Compliance Proxy):

- The `runtimeintrospect` carrier package and its `Source` model.
- The `/debug/runtime` snapshot endpoint each service mounts.
- The Hub bridge that proxies a Thing's snapshot to the admin UI.
- The read-only `/runtime/*` shadow API family.
- The snapshot redaction contract.

It does **not** cover the Compliance Proxy break-glass write path
(`PUT /runtime/config/{key}`), local kill-switch state, or exemption mechanics —
those live in
[compliance-proxy-runtime-api-architecture.md](../../services/compliance-proxy/compliance-proxy-runtime-api-architecture.md).
The diagnostic-mode delivery path that populates one of the Hub snapshot sources
lives in
[diag-event-triage-architecture.md](diag-event-triage-architecture.md). Process
metrics (goroutines, heap, GC) are a different surface — see
[Runtime metrics vs runtime introspection](#9-runtime-metrics-vs-runtime-introspection).

## 1. The `runtimeintrospect` carrier

`packages/shared/core/diag/runtimeintrospect/` provides the carrier; each service
provides the content. The package defines a `Source` — a named contributor to a
service's runtime snapshot:

```go
type Source interface {
    Name() string
    Snapshot(ctx context.Context) (any, error)
}
```

Source names follow a convention so the admin UI can group them: `config.<key>`
for thingclient config keys, `cache.<category>` for cache categories, and
`runtime.<area>` for ad-hoc process state.

A `Registry` holds one `Source` per name. `Register` adds or replaces by name, so
a component that hot-reloads can refresh its entry by re-registering. A
`SourceFunc` adapter turns a plain closure into a `Source`, which is how services
register most of their sources inline during wiring.

`Registry.Snapshot` collects every source into a `Response` carrying service
metadata (service name, Thing ID, Thing version, process start time), the
snapshot timestamp, and a per-source result map. Each result is either
`{ok: true, value: …}` or `{ok: false, error: …}`. Collection is fault-isolated:
a source that returns an error or panics yields a failed result for that source
only, and the recover guard keeps every other source serving. One broken source
never blanks the whole snapshot.

## 2. Two classes of source

The `Source` contract is deliberately split by where the authoritative state
lives:

- **Thing-local sources** — `config.*`, `cache.*`, and process-local
  `runtime.*` structures. These read **in-memory state only**, no database or
  network call. That restriction is the whole point: the snapshot must show what
  the running process actually holds and applied, so re-deriving the value from
  the database would hide a parse or apply bug rather than expose it. The AI
  Gateway, Compliance Proxy, and Control Plane sources are all of this class.

- **System-of-record sources** — the Hub sources that describe fleet-wide state
  (`runtime.thing_registry`, `runtime.diag_mode_windows`, `runtime.alerts.rules`,
  `runtime.alerts.channels`). This state lives only in PostgreSQL; the Hub holds
  no in-memory copy of the whole fleet. These sources query their authoritative
  store directly. The queries are bounded admin reads and run under the handler's
  request timeout.

A source keeps its work cheap and bounded either way — the handler caps every
snapshot with a timeout (see [§4](#4-the-debugruntime-handler-and-auth)).

## 3. The `KeyStateRecorder`

`KeyStateRecorder` closes a specific gap: for config keys that have no richer
in-memory cache of their own, an operator otherwise has no way to confirm the
running service received and parsed a pushed template. The recorder captures the
most recent acknowledged bytes per config key — services call `Record` from their
`OnConfigChanged` callback — and exposes a `config.<key>` source per key. The
source emits the parsed JSON of the last bytes seen, `nil` if the key was never
recorded (or was cleared upstream), and falls back to the raw string if the
stored bytes do not parse as JSON, so the operator still sees the payload.
`RegisterAll` registers a source for each key in a known list. A service that
already maintains a deeper parsed cache for a key (for example payload capture or
hooks) keeps exposing that richer source under its own name; the recorder only
fills keys that would otherwise have no view.

## 4. The `/debug/runtime` handler and auth

`Registry.Handler` returns the HTTP handler each service mounts at
`/debug/runtime`. Its rules:

- **GET only.** Any other method returns 405 with an `Allow: GET` header.
- **Token required; empty token disables the endpoint.** The handler is
  configured with a bearer token. An empty token returns 503
  ("introspection disabled") instead of serving — the surface refuses rather than
  exposes state when it is not explicitly enabled.
- **Constant-time comparison.** A present token is compared against the expected
  value with a constant-time compare; a missing or wrong token returns 401.
- **Bounded.** The snapshot runs under a request timeout (5 seconds by default).
- **No caching.** The response is JSON with `Cache-Control: no-store`.

Every server service mounts this handler with the shared internal service token,
so the same operator credential reads any service's snapshot:

| Service | Mount | Token source |
| --- | --- | --- |
| Nexus Hub | `/debug/runtime` (Echo) | internal service token |
| Control Plane | `/debug/runtime` (Echo) | internal service token |
| AI Gateway | `/debug/runtime` (ServeMux) | internal service token |
| Compliance Proxy | `/debug/runtime` (ServeMux) | internal service token |

### Sources registered per service

- **Nexus Hub** (`packages/nexus-hub/cmd/nexus-hub/wiring/introspect.go`) —
  `config.flags`, `runtime.scheduler`, `runtime.db_pool`, `runtime.thing_registry`,
  `runtime.diag_mode_windows`, `runtime.consumer_manager`, `runtime.alerts.rules`,
  `runtime.alerts.channels`, plus the self-shadow config keys it consumes. The
  registry builder guards each optional dependency, so a source appears only when
  its backing subsystem is wired.
- **AI Gateway** (`packages/ai-gateway/cmd/ai-gateway/wiring/runtimeapi.go`) —
  `config.payload_capture`, `config.observability`, `config.hooks`,
  `config.ai_guard`, the cache sources (`cache.cachelayer.stats`,
  `cache.routing_rules`, `cache.models`, `cache.providers`, `cache.credentials`),
  the quota policy cache sources, plus its consumed config keys.
- **Compliance Proxy** (`packages/compliance-proxy/cmd/compliance-proxy/wiring/health.go`) —
  `config.killswitch`, `config.exemptions`, `config.payload_capture`,
  `config.hooks`, `cache.allowlists`, `cache.interception_domains_full`,
  `cache.observability`, `runtime.active_tunnels`, plus its consumed config keys.
- **Control Plane** (`packages/control-plane/cmd/control-plane/wiring/runtime.go`) —
  `config.flags`, `runtime.db_pool`, plus its consumed config keys.

## 5. The Hub bridge and the admin UI path

Operators do not call `/debug/runtime` on each service directly. The admin UI's
Runtime State tab (on a node's detail page) drives a three-hop pass-through:

```
Control Plane UI (RuntimeStateTab)
  → CP admin API   GET /nodes/:id/runtime          (IAM: settings read)
  → Hub bridge     GET /api/hub/things/:id/runtime  (internal service token)
  → Thing          GET /debug/runtime               (internal service token)
```

The Control Plane handler is a pure pass-through — it forwards the Hub response
body to the UI without interpreting it (an upstream 5xx is surfaced as 502). The
Hub bridge (`packages/nexus-hub/internal/observability/handler/diag/runtime_bridge.go`)
does the real work:

1. Reads the Thing's row — type, status, desired/reported version, last-seen
   time, and the desired/reported config blobs — and its registered metrics URL.
2. Resolves the introspection URL from that metrics URL (the same host, with the
   `/metrics` path replaced by `/debug/runtime`); for the Hub's own row it uses
   the configured local URL to avoid a round-trip through the advertised host.
3. Reverse-calls the Thing's `/debug/runtime` with the internal service token and
   returns `{snapshot, meta}`, where `meta` carries Hub's desired-vs-reported view
   so the UI can diff what Hub thinks is desired against what the Thing applied.

Two cases short-circuit before the reverse call:

- **Agent Things return 501.** Agents sit behind NAT and are not reachable from
  Hub; their introspection is exposed through the local agent UI instead.
- **Offline Things return 503.** A Thing whose status is not `online` cannot be
  reached, so the bridge returns the metadata with a service-unavailable status
  rather than hanging on a dead host.

## 6. The `/runtime/*` read API

Separate from the snapshot surface, the AI Gateway and Compliance Proxy expose a
read-only `/runtime/*` API for operators inspecting shadow-managed config without
the admin UI:

- `GET /runtime/config` — every shadow-managed config key with its version and
  raw state, plus the desired/reported versions and last-reported time.
- `GET /runtime/config/{key}` — a single key's version and raw state (404 if the
  key is unknown).
- `GET /runtime/sync-status` — whether desired and reported versions match.
- `GET /runtime/health` — a liveness summary with the current versions.

These handlers read the thingclient shadow snapshot; they are read-only. Auth is a
single bearer token from a per-service environment variable
(`AI_GATEWAY_API_TOKEN`, `COMPLIANCE_PROXY_API_TOKEN`), compared in constant time.
When the token is unset the AI Gateway logs a warning and the surface rejects every
request. This API is not consumed by the admin UI.

The Compliance Proxy serves the same read routes alongside its own probes
(`/healthz`, `/metrics`, `/connections`) and adds a break-glass
`PUT /runtime/config/{key}` for a restricted set of keys. That write path — its
authorization, the writable-key whitelist, and how it reconciles with Hub shadow
sync — is documented in
[compliance-proxy-runtime-api-architecture.md](../../services/compliance-proxy/compliance-proxy-runtime-api-architecture.md).

## 7. Snapshot redaction contract

The package is a carrier, not an enforcer. Each `Source` is responsible for
redacting secret material — API keys, provider credentials, OAuth tokens, mTLS
private keys, session cookies, raw JWT material — before returning its snapshot.
The model is **allowlist projection per source**: a source returns an explicit set
of safe fields rather than dumping a struct that might gain a secret field later.
The AI Gateway credential source, for example, projects identity and metadata
(id, name, provider, enabled flag, encryption-key id, and the encrypted blob's
length) and never the key bytes; the AI Guard source projects custom-header names
without their values. This contract is enforced by code review, not by the
framework; a source that returns secret material is a review defect, not a
runtime error.

## 8. No live profiling surface

There is no live profiling HTTP surface. No service exposes `net/http/pprof`
handlers (`/debug/pprof/*`), and there is no profiling endpoint to gate. The only
use of Go's profiling primitives is reading the thread-creation counter for the
`runtime.threads` process metric (see [§9](#9-runtime-metrics-vs-runtime-introspection)) —
an in-process counter read, not an exposed endpoint. For a gateway whose memory
holds decrypted prompts and credentials in flight, a heap- or goroutine-dump
endpoint would be a data-exposure surface, so the absence is deliberate.
Diagnostics flow through the bounded, token-guarded `/debug/runtime` snapshot
instead.

## 9. Runtime metrics vs runtime introspection

"Runtime" names two distinct surfaces, and they are easy to confuse:

- **Runtime introspection** (this doc) — an on-demand HTTP **snapshot** of a
  service's live config and cache state, read by an operator through the admin UI
  or `/runtime/*`.
- **Runtime metrics** — the continuous L1 process gauges and counters
  (`runtime.goroutines`, `runtime.heap_alloc_bytes`, GC pause, thread count, open
  FDs, CPU, RSS, uptime) sampled by `packages/shared/core/metrics/platform/runtime.go`
  and scraped through the metrics pipeline. See
  [prometheus-naming-architecture.md](prometheus-naming-architecture.md) and
  [metrics-rollup-architecture.md](metrics-rollup-architecture.md).

The introspection snapshot answers "what config does this process hold right now";
the metrics answer "how is this process performing over time."

## References

- `packages/shared/core/diag/runtimeintrospect/` — Source/Registry carrier, handler, KeyStateRecorder
- `packages/nexus-hub/cmd/nexus-hub/wiring/introspect.go` — Hub source registry
- `packages/nexus-hub/internal/observability/handler/diag/runtime_bridge.go` — Hub introspection bridge
- `packages/control-plane/cmd/control-plane/wiring/runtime.go` — Control Plane source registry
- `packages/control-plane/internal/infrastructure/infra/node_runtime.go` — CP pass-through endpoint
- `packages/control-plane/internal/platform/hub/client.go` — CP→Hub bridge client
- `packages/control-plane-ui/src/pages/infrastructure/_shared/tabs/runtime/RuntimeStateTab.tsx` — admin UI tab
- `packages/ai-gateway/cmd/ai-gateway/wiring/runtimeapi.go` — AI Gateway source registry + `/runtime/*` mount
- `packages/ai-gateway/internal/runtimeapi/` — AI Gateway `/runtime/*` read API
- `packages/compliance-proxy/cmd/compliance-proxy/wiring/health.go` — Compliance Proxy source registry
- `packages/compliance-proxy/internal/runtime/server/server.go` — Compliance Proxy `/runtime/*` server
- `packages/shared/core/metrics/platform/runtime.go` — L1 runtime process metrics sampler
