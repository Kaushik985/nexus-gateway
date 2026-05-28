# Forward header allowlist architecture

The forward-header allowlist decides which inbound request headers the gateway forwards to the upstream provider, and which upstream response headers it returns to the client. Both directions are governed by a closed allowlist over a hard denylist, configured per adapter type. It lives in `packages/ai-gateway/internal/execution/forwardheader`; the provider adapter applies it at request and response time.

## 1. Configuration shape

The `forwardHeaders` block is YAML-only. Its parent field is a pointer, so an absent block is distinguishable from an empty one — when absent, the gateway falls back to an embedded `defaults.yaml`. Each direction is configured independently:

- **Request** — a flat `base` list applied to every adapter type, plus per-adapter-type `headers` extensions. The effective request set for an adapter is `base ∪ perAdapterType[format].headers`.
- **Response** — a `base` with two sub-lists, `static` and `perRequest`, plus per-adapter-type `static` / `perRequest` extensions. **Static** response headers always pass through and are safe to cache; **perRequest** headers are stripped when the response is served from a cache hit (they describe that one live upstream call). A header listed in both `static` and `perRequest` for the same adapter type is a configuration error.

A custom `UnmarshalYAML` lets one `Direction` type serve both shapes: the request `base` is a sequence of names, the response `base` is a `{static, perRequest}` mapping.

## 2. The hard denylist

Before any allowlist is honored, every configured header name is validated against a hard denylist — the denylist always wins, so an operator cannot allowlist a credential or framing header by mistake. It has two parts:

- **Exact names** — credential headers (`authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-goog-api-key`, `api-key`, `proxy-authorization`), proxy/opacity headers (`server`, `via`, `x-served-by`, `cf-ray`, `x-real-ip`), response-security headers (`www-authenticate`, `strict-transport-security`, `content-security-policy`, `x-frame-options`), and hop-by-hop headers (`content-length`, `transfer-encoding`, `connection`).
- **Prefixes** — `x-amz-`, `x-forwarded-`, `x-nexus-`, and `access-control-` (cloud-signing, proxy-attribution, Nexus-internal, and CORS headers).

`accept-encoding` is permanently denied for a concrete reason: forwarding it disables Go's transparent gzip decompression on the upstream transport, which caused an Anthropic SSE production incident (the load-bearing comment is in the provider adapter; see [provider-adapter-architecture.md](provider-adapter-architecture.md)). A header on the denylist is a fatal validation error at `Resolve` time, so a bad allowlist aborts startup rather than shipping.

## 3. Resolve and the immutable result

`Resolve(cfg, validFormats)` validates the config against the denylist and the closed set of registered adapter-type slugs — any `perAdapterType` key outside that set is a fatal error — checks the no-`static`/`perRequest`-overlap rule, then precomputes the effective lower-cased header sets for every known format into an immutable `Resolved`. Callers query it lock-free: `Request(format)` returns the request set, `Response(format)` returns the `{Static, PerRequest}` response sets, and an unknown format returns an empty set so iteration is always safe.

The live allowlist is held in an atomic pointer. `SetActive` installs it once at startup from the YAML-resolved config, and `Active()` reads it lock-free on the hot path; a previous snapshot stays alive until the last in-flight reader releases it, so a response never observes a half-swapped allowlist. `Default()` resolves the embedded defaults once as a fallback for tests and any adapter that was not wired with an explicit allowlist.

## 4. The allowlist version hash

`Hash()` is the first eight hex characters of a SHA-256 over a canonical, sorted encoding of the resolved sets — deterministic across restarts whenever the underlying YAML is byte-identical. It is folded into the response cache key (`Cache.BuildKey`'s `allowlistVersion` argument), so changing the allowlist invalidates cached entries whose stored upstream headers were captured under a different effective filter — a cache hit can never replay a header set the current allowlist would reject. See [cache-multi-tier-architecture.md](../../cross-cutting/storage/cache-multi-tier-architecture.md).

## 5. Where the allowlist is applied

The provider adapter is the consumer. On the request path it filters the outbound header set through `effectiveAllowlist().Request(format)` (its wired allowlist, or `Default()`). On the response path `FilterResponseHeaders` applies `Response(format)`, keeping the static set and dropping the perRequest set when the response is a cache hit. The handler's response writer prefers the live `Active()` snapshot so a config change takes effect on the next response.

Headers dropped by the filter are counted in the `nexus_forward_header_dropped_total` counter, labelled by `BucketDroppedHeader`, which keeps the metric cardinality bounded: an exact denylist name is reported verbatim, a prefix match collapses to `<prefix>*` (for example `x-amz-*`), and everything else buckets to `other`.

## References

- `packages/ai-gateway/internal/execution/forwardheader/forwardheader.go` — config parsing, denylist, `Resolve`, `Resolved`, `Hash`, active snapshot, dropped-header bucketing
- `packages/ai-gateway/internal/execution/forwardheader/defaults.yaml` — embedded default allowlist
- `packages/ai-gateway/internal/providers/dispatch/spec_adapter.go` — request/response header filtering at the adapter
- `packages/ai-gateway/internal/cache/core/cache.go` — allowlist hash folded into the cache key
- `packages/ai-gateway/internal/ingress/proxy/proxy.go` — response writer using the active allowlist
