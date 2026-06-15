# AI Gateway architecture

The AI Gateway is the enterprise traffic plane for synchronous AI API calls. It accepts requests on several wire protocols, authenticates the virtual key, normalizes the body to a canonical shape, routes it to a provider and model, consults the cache, runs the compliance hook pipeline, dispatches upstream with retry and fallback, and emits a `traffic_event` for every call. It registers with Nexus Hub as a Thing and reads its configuration from Hub shadow keys. The code is `packages/ai-gateway`. This page is the service overview and the index into the per-subsystem docs; each subsystem's mechanism lives in its own doc, linked below.

## 1. Ingress surface

The gateway serves three families of routes:

- **Canonical AI APIs** — `POST /v1/chat/completions`, `/v1/messages` (Anthropic shape), `/v1/responses` (OpenAI Responses), and `/v1/embeddings`.
- **Provider-native shims** — endpoints that mirror a provider's own path so existing SDKs work unchanged: `/api/paas/v4/{chat/completions,embeddings}` (GLM), `/openai/deployments/` (Azure OpenAI), and `/v1beta/models/` (Gemini).
- **Utility and internal** — `/v1/estimate` (cost preview), `/v1/ai-guard/{classify,compliance-webhook}`, and the `/internal/*` operator surfaces (`routing-simulate`, `hooks-test`, `provider-test`, `embedding-probe`, `semantic-prewarm`, and credential probe at `/internal/v1/credentials/{id}/probe`). The `/internal/*` routes are service-to-service admin surfaces called by the Control Plane BFF — they are gated on the shared internal-service token (`Authorization: Bearer <INTERNAL_SERVICE_TOKEN>`, constant-time compared; missing/wrong ⇒ 401, unconfigured token ⇒ 503 fail-closed), NOT virtual-key auth. The `/v1/*` data-plane routes stay on virtual-key auth.

The ingress format selects the codec that reads the body; from that point the request is handled in canonical form.

## 2. Request lifecycle

The proxy handler processes a request as an instrumented, ordered pipeline. A per-request phase timer and an upstream phase sink record per-phase durations and upstream TTFB/total onto the audit row, so a slow request is attributable to a specific phase.

1. **Read body** — decode the inbound body using the ingress format's codec.
2. **Virtual-key auth** — resolve and authorize the virtual key (`auth/vkauth`).
3. **Rate limit** — apply the virtual key's request-rate limit.
4. **Build request context** — normalize the body once into a canonical `NormalizedPayload` shared by every downstream stage (see [normalization-architecture.md](normalization-architecture.md)).
5. **Routing** — resolve the requested model to an ordered set of provider+model targets (see [routing-architecture.md](routing-architecture.md)), followed by the cross-format routing filter and the Responses-API cross-format guard.
6. **Passthrough + quota** — resolve the effective emergency-passthrough config for the primary target and check the quota counter.
7. **Request hooks** — run the request-stage compliance pipeline (see [hook-architecture.md](hook-architecture.md)).
8. **Cache** — look up the response cache, L1 exact then L2 semantic on a miss (see [response-cache-architecture.md](response-cache-architecture.md)).
9. **Execute, response hooks, finalize** — on a cache miss, inject Gemini cached content where applicable (see [prompt-cache-architecture.md](prompt-cache-architecture.md)), dispatch upstream through the executor with retry and fallback over the health-ranked targets, run the response-stage hooks, normalize and re-encode the response to the ingress shape, filter response headers through the forward-header allowlist (see [forward-header-allowlist-architecture.md](forward-header-allowlist-architecture.md)), and emit the `traffic_event`.

## 3. Package layout

| Area | Packages | Concern |
|---|---|---|
| Ingress | `internal/ingress/{proxy,models,debug,envelope}` | HTTP entry, `/v1/models`, internal debug routes, response envelope |
| Auth | `internal/auth/vkauth` | virtual-key authentication |
| Routing | `internal/routing` | route resolution and strategies |
| Providers | `internal/providers` | provider adapters and dispatch |
| Execution | `internal/execution/{executor,canonicalbridge,estimator,forwardheader,passthrough,wireformat}` | upstream dispatch with retry/fallback, cross-format reshape, cost estimation, header allowlist, emergency passthrough |
| Policy | `internal/policy/{hooks,aiguard,quota,requestcontext}` | compliance hooks, AI-Guard, quota, the L3/L4 request context |
| Cache | `internal/cache/{core,semantic,gemini,freshness,stream,layer}` | response cache, Gemini prompt cache, and the in-memory config snapshot layer |
| Credentials / embeddings | `internal/credentials`, `internal/embeddings` | provider credential decryption, embedding client |
| Platform | `internal/platform/{store,audit,metrics,middleware,streaming}` | pgx store, audit record + writer, Prometheus instruments, HTTP middleware, SSE |
| Runtime / config | `internal/runtimeapi`, `internal/config` | runtime admin API, configuration loading |

## 4. Hub registration and configuration

The gateway connects to Nexus Hub through the thing-client as a Thing of type `ai-gateway`. An `OnConfigChanged` callback applies each pushed shadow key to the live runtime — provider/model catalog, cache config, semantic-cache config, freshness patterns, AI-Guard config, hooks, and reliability settings — so an admin change takes effect without a restart.

Hot-path reads stay in memory: the `cache/layer` holds eager Provider, Model, and Credential snapshots (loaded full and DB-free thereafter) plus a TTL-bounded virtual-key cache that populates lazily on first read and is invalidated by Hub push. Routing, caching, and the provider adapters read these snapshots rather than the database. The executor (`execution/executor`) dispatches to upstream with a retry policy (backoff) and falls back across the route result's health-ranked targets when a target fails. Configuration mechanics are described in [configuration-architecture.md](../../cross-cutting/foundation/configuration-architecture.md); the Hub coordination model is in [thing-model.md](../../cross-cutting/foundation/thing-model.md) and [service-call-framework.md](../../cross-cutting/foundation/service-call-framework.md).

## 5. Subsystem index

- **Calling the API** — [ingress-api.md](ingress-api.md)
- **Request resolution** — [routing-architecture.md](routing-architecture.md), [smart-routing-architecture.md](smart-routing-architecture.md)
- **Provider dispatch and wire translation** — [provider-adapter-architecture.md](provider-adapter-architecture.md), [provider-coverage.md](provider-coverage.md), [normalization-architecture.md](normalization-architecture.md)
- **Caching** — [response-cache-architecture.md](response-cache-architecture.md), [prompt-cache-architecture.md](prompt-cache-architecture.md)
- **Compliance policy** — [hook-architecture.md](hook-architecture.md), [aiguard-architecture.md](aiguard-architecture.md), [forward-header-allowlist-architecture.md](forward-header-allowlist-architecture.md)
- **Cost** — [cost-estimation-architecture.md](cost-estimation-architecture.md)

## References

- `packages/ai-gateway/internal/ingress/proxy/proxy.go` — request lifecycle and phase pipeline
- `packages/ai-gateway/internal/auth/vkauth/` — virtual-key authentication
- `packages/ai-gateway/internal/execution/executor/` — upstream dispatch, retry, fallback
- `packages/ai-gateway/internal/cache/layer/` — in-memory Provider/Model/Credential/VK snapshot
- `packages/ai-gateway/cmd/ai-gateway/wiring/thingclient.go` — Hub registration as Thing type `ai-gateway`
- `packages/ai-gateway/cmd/ai-gateway/configdispatch/configdispatch.go` — shadow-key dispatch into the live runtime
- `packages/ai-gateway/cmd/ai-gateway/wiring/` — service assembly
