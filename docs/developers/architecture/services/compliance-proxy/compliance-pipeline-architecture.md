# Compliance pipeline architecture

The Compliance Proxy intercepts outbound HTTPS to AI provider and AI
consumer surfaces, turns the intercepted bytes into readable, structured
content, runs that content through the compliance hook engine, and emits an
audit record. This doc covers the **normalize stage** of that flow — where it
sits in the request lifecycle, the per-host `traffic.Adapter` catalog it draws
on, and how to extend it for a new provider, web surface, or IDE.

## What this doc covers (and what it does not)

- The shared normalize layer itself — the three-tier `core.Registry`, the
  `NormalizedPayload` contract, canonical token-usage mapping — is described
  once in [normalization-architecture.md](../ai-gateway/normalization-architecture.md).
  This doc references it rather than repeating it.
- CONNECT/MITM interception and access control are described in
  [compliance-proxy-connect-forward-architecture.md](compliance-proxy-connect-forward-architecture.md),
  certificate issuance in
  [compliance-proxy-tls-cert-architecture.md](compliance-proxy-tls-cert-architecture.md),
  and the runtime admin API in
  [compliance-proxy-runtime-api-architecture.md](compliance-proxy-runtime-api-architecture.md).
- Domain matching that selects which adapter handles a flow is described in
  [domain-device-predicate-architecture.md](domain-device-predicate-architecture.md).

What is unique here: the interception-side adapter model — the per-host
`traffic.Adapter` capability bundle, its relationship to the audit-time
`normalize.Normalizer`, the built-in adapter catalog, and the procedure for
adding a Tier-1 adapter or a Tier-2 detector.

## 1. Where normalize sits in the pipeline

An intercepted flow runs through the shared MITM forward handler
(`packages/shared/transport/tlsbump`), which the Compliance Proxy and the
Agent both use. For each flow the handler resolves an `InterceptionDomain`,
looks up the domain's `adapterId` in the runtime adapter registry, and uses
the resulting `traffic.Adapter` to:

1. **Extract the request.** `ExtractRequest` parses the provider-specific
   request body into a `traffic.NormalizedContent` — the readable text
   segments plus reasoning, tool-call, and unrecognised-field side channels.
2. **Feed the hook engine.** The extracted content is what request-stage
   compliance hooks scan (PII, secrets, keyword, content-safety).
3. **Rewrite if a hook modifies.** When a hook returns a modify decision,
   `RewriteRequestBody` writes the hook-edited text back onto the wire before
   the body is forwarded upstream.
4. **Extract the response.** `ExtractResponse` (non-streaming) or
   `ExtractStreamChunk` (per SSE delta) parses the upstream reply; response
   hooks scan it and `RewriteResponseBody` applies any modify decision.
5. **Emit audit.** At audit time the captured envelope is normalized again by
   the shared three-tier `core.Registry` and written to the audit sink.

The hook-engine mechanics, the streaming modes, and the MITM handshake belong
to [compliance-proxy-connect-forward-architecture.md](compliance-proxy-connect-forward-architecture.md)
and [sse-streaming-compliance-architecture.md](../../cross-cutting/safety/sse-streaming-compliance-architecture.md);
this doc is concerned only with the adapter that produces the content those
stages consume.

## 2. Two interfaces: runtime adapter vs audit normalizer

The interception path and the audit path use two distinct interfaces, and a
single per-host package usually implements both.

**`traffic.Adapter`** (`packages/shared/traffic/adapter.go`) is the runtime
capability bundle. One instance is created per `InterceptionDomain` from an
`AdapterFactory` and shared across every concurrent request routed to that
domain — so adapters must be safe for concurrent use. The interface is wider
than a parser: alongside `ExtractRequest` / `ExtractResponse` /
`ExtractStreamChunk` it carries `DetectRequestMeta` (provider, model, API-key
class and fingerprint), `DetectResponseUsage` (token counts for non-streaming
replies), and `RewriteRequestBody` / `RewriteResponseBody` (push hook-modified
text back onto the wire). It is hot-swapped atomically when configuration
changes via the domain snapshot.

**`normalize.Normalizer`** (`packages/shared/transport/normalize/core`) is the
audit-time wire parser consulted by the shared `core.Registry` when a captured
envelope carries a matching `adapter_type`. It is described in
[normalization-architecture.md](../ai-gateway/normalization-architecture.md).

A per-host package that implements **both** interfaces is registered as a
Tier-1 normalizer (a per-host confirmed parse with higher confidence). A
package that implements only `traffic.Adapter` still works at runtime; at audit
time it falls through to the Tier-2 pattern probe wired by `extract.WireTier2`.
Promoting an adapter from Tier 2 to Tier 1 is a one-method change — add
`Normalize` — and `RegisterTier1AdapterNormalizers` picks it up automatically by
type assertion.

### What an adapter extracts

`traffic.NormalizedContent` (`packages/shared/traffic/types.go`) separates
content by how the rest of the pipeline must treat it:

- **`Segments`** — user-visible text, positionally aligned with the schema
  slots that `RewriteRequestBody` / `RewriteResponseBody` walk back over, so a
  hook-modified segment can be written in place.
- **`ReasoningSegments`** — extended-thinking / reasoning text. Scannable by
  hooks but never rewritten (streaming reasoning deltas have no stable rewrite
  slot).
- **`ToolCallSegments`** — serialized tool / function-call JSON, kept separate
  so hooks can inspect tool arguments for PII or detect MCP-formatted tool
  requests. Not rewritten.
- **`Extra`** — raw JSON of any top-level field the adapter did not consume.
  This is the safety net against silent data loss when a provider ships a new
  spec field before the adapter learns it; defence-in-depth hooks still see it.
- **`Metadata`** — adapter-specific hints such as model name.

## 3. The built-in adapter catalog

`builtinEntries` in `packages/shared/traffic/adapters/builtins.go` is the single
source of truth for built-in adapters — a table of `adapterId → AdapterFactory`.
`RegisterBuiltins` loads every entry into the runtime `traffic.AdapterRegistry`
that the Compliance Proxy and Agent consult; `BuiltinTrafficAdapterIDs` exposes
the same list (sorted) to the admin traffic-adapter catalog, so the UI catalog
cannot drift from runtime registration. The registry is frozen after startup
and read-only thereafter.

The adapter packages are grouped by surface under
`packages/shared/traffic/adapters/`:

- **`api/`** — provider API wire formats (OpenAI-compatible, Anthropic,
  Gemini, Vertex, Bedrock, Cohere, Voyage, and the OpenAI-compat re-users like
  DeepSeek, Mistral, Groq, …). These overlap with the dedicated AI normalizers.
- **`web/`** — consumer web surfaces (`chatgpt-web`, `claude-web`,
  `gemini-web`, `grok-web`, `perplexity-web`, and more). Browser products, not
  metered APIs.
- **`ide/`** — IDE assistants (`cursor`, `github-copilot`, `codeium`,
  `tabnine`, `continue-dev`, `replit-ai`).
- **`generic/`** — `generic-jsonpath`, the consumer-surface fallback used when
  no dedicated adapter matches a domain.

## 4. Text-first for consumer surfaces

For consumer web and IDE surfaces the required output is **readable text**.
These products do not expose token usage the way a metered API does, so an
adapter reports that honestly rather than inferring fake counts. The
`chatgpt-web` adapter (`packages/shared/traffic/adapters/web/chatgptweb/`) is
representative: `DetectResponseUsage` returns `UsageMeta{Status:
UsageStatusNonLLM}`, which tells the audit pipeline to skip cost calculation;
`DetectRequestMeta` sets `Provider: "chatgpt-web"` (so `traffic_event` records
distinguish the web surface from the public `openai` API) and deliberately
leaves the API-key fields empty rather than mislead audit consumers expecting
an API-key path.

Rewrite is also surface-dependent. The same `chatgpt-web` adapter returns
`ErrRewriteUnsupported` from both rewrite methods: its request body carries
client integrity state (action types, parent-message linkage, telemetry IDs)
and its responses are SSE JSON-Patch streams whose path indices depend on prior
delta history — neither is safely reconstructable from a `NormalizedContent`
snapshot. When a hook returns a modify decision against a rewrite-unsupported
adapter, the pipeline forwards the original body unchanged and logs a warning
rather than failing the request.

## 5. Adding a Tier-1 traffic adapter

A new provider, web surface, or IDE is one adapter package. The `chatgpt-web`
package is a single-file template implementing the full interface.

1. **Create the package** under `api/`, `web/`, or `ide/` per surface kind.
2. **Implement `traffic.Adapter`.** `ID()` returns the canonical adapter ID;
   `Configure(map)` applies any `InterceptionDomain.adapterConfig` (a no-op for
   most surfaces); the `Extract*` methods parse the wire into
   `NormalizedContent`; `DetectRequestMeta` and `DetectResponseUsage` report
   provider/model/usage; the `Rewrite*` methods reverse `Extract` or return
   `ErrRewriteUnsupported`.
3. **Honor the rewrite contract.** `RewriteRequestBody` /
   `RewriteResponseBody` must walk the schema in the same order
   `ExtractRequest` / `ExtractResponse` emitted segments, so `Segments[i]`
   maps to the i-th extractable slot. Return `ErrRewriteUnsupported` when the
   wire cannot be reverse-encoded; do not fail the request.
4. **Register it.** Add one `{id, factory}` row to `builtinEntries`.
5. **(Optional) Promote to Tier 1 for audit.** Implement `Normalize` —
   typically delegating to `extract.NormalizeForAdapter` with the adapter's
   request/response spec hints — and `RegisterTier1AdapterNormalizers` wires it
   into the audit registry automatically. Without it the adapter still
   normalizes at audit time via the Tier-2 probe.

## 6. Adding a Tier-2 detector

Surfaces whose wire is not plain JSON — a protobuf Connect-RPC envelope, a
Google `batchexecute` form post — are handled by the `NonJSONDetector`
framework in `packages/shared/transport/normalize/extract/detector.go` rather
than a per-host adapter. Implement the three-method interface (`ID`,
`LooksLike(raw)`, `Decode(raw, direction)`) and append the detector to
`NonJSONDetectors`; `WireTier2` picks it up. `ConnectRPCProtobufDetector` and
`BatchExecuteDetector` are the worked examples. Detector authoring detail lives
in [normalization-architecture.md](../ai-gateway/normalization-architecture.md) §6.

## 7. Sharp edge: keep the Tier-1 registration lock-step

The per-host adapters and the dedicated AI normalizers
(`RegisterDefaultAIBuiltins` in `normalize/codecs/register.go`) register
overlapping wire keys. `RegisterTier1AdapterNormalizers` skips every ID listed
in `alreadyCoveredByAIBuiltins` (`builtins.go`) precisely because the dedicated
normalizer parses that wire more precisely. Any alias added to the
OpenAI-compatible / Anthropic / Gemini blocks in `codecs/register.go` must also
be added to `alreadyCoveredByAIBuiltins`, or the frozen registry rejects a
duplicate registration at startup. A registration test guards the invariant.

## References

- `packages/shared/traffic/adapter.go` — `traffic.Adapter` interface, `AdapterFactory`, `AdapterRegistry`
- `packages/shared/traffic/types.go` — `NormalizedContent`, `ErrRewriteUnsupported`
- `packages/shared/traffic/detect.go` — `RequestMeta`, `UsageMeta`, `UsageStatus`
- `packages/shared/traffic/adapters/builtins.go` — built-in catalog, `RegisterBuiltins`, `RegisterTier1AdapterNormalizers`, `alreadyCoveredByAIBuiltins`
- `packages/shared/traffic/adapters/api/`, `web/`, `ide/`, `generic/` — per-surface adapter packages
- `packages/shared/traffic/adapters/web/chatgptweb/` — single-file consumer-surface adapter template
- `packages/shared/transport/normalize/extract/detector.go` — Tier-2 `NonJSONDetector` framework
- `packages/shared/transport/normalize/extract/normalizer.go` — `NormalizeForAdapter`, `AdapterSpecHint`
- `packages/shared/transport/tlsbump/bump.go` — MITM forward handler, `WithNormalizeRegistry`
- `packages/compliance-proxy/cmd/compliance-proxy/wiring/normalize.go` — compliance-proxy registry wiring
