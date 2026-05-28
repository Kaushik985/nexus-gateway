# Normalization architecture

The normalize layer turns raw provider/wire bytes into a canonical `NormalizedPayload` — readable text, token usage, and request/response structure — independent of which provider or wire format produced them. It lives in `packages/shared/transport/normalize` and is shared by the AI Gateway, Compliance Proxy, Agent, and Hub audit pipeline, so the same bytes yield the same normalized result everywhere.

## 1. The NormalizedPayload contract

A `Normalizer` (`packages/shared/transport/normalize/core`) implements:

```go
type Normalizer interface {
    ID() string
    Normalize(ctx context.Context, raw []byte, meta Meta) (NormalizedPayload, error)
}
```

`Meta` carries the call context: `AdapterType` (the wire key), `Model`, `ContentType`, `Direction` (`DirectionRequest` / `DirectionResponse`), `EndpointPath`, and `Stream`. `NormalizedPayload` is the canonical output — `Kind` (`ai-chat` / `ai-embedding` / `http-json` / …), `Protocol`, `Model`, `Stream`, `Messages[]`, `Tools[]`, `Params`, `Usage`, `FinishReason`, `Inputs[]` (embeddings), `Confidence`, and `DetectedSpec`. A normalizer that does not recognize the bytes returns `ErrUnsupported`, which the coordinator uses to fall through to the next candidate.

## 2. The three-tier dispatch model

`core.Registry` is the coordinator. `BuildRegistry` (`packages/shared/transport/normalize/buildregistry.go`) assembles it once per service and freezes it. `Registry.Normalize` dispatches in three tiers:

- **Tier 1 — keyed per-wire normalizers** (`normalize/codecs`, registered by `RegisterDefaultAIBuiltins`, plus per-host traffic adapters via `RegisterTier1AdapterNormalizers`). Selected by `AdapterType` and `AdapterType::EndpointPath` keys — JSON wires with a known shape.
- **Tier 2 — the NonJSONDetector framework** (`normalize/extract`, wired by `WireTier2`). For wires that are not plain JSON: a protobuf Connect-RPC envelope (`ConnectRPCProtobufDetector`) or a Google `batchexecute` form post (`BatchExecuteDetector`). Each detector implements `ID()` / `LooksLike(raw)` / `Decode(raw, direction)`.
- **Tier 3 — generic HTTP** (`GenericHTTPNormalizer`). The catch-all that records non-AI HTTP structure when no AI wire matches.

A tier's result is accepted only when its `Confidence` clears the registry threshold (default 0.70); otherwise the coordinator continues to the next candidate. Tier-1 confidence comes from `ScoreTier1Confidence` (the proportion of required and known fields matched); Tier-2 detectors score from a baseline against their required and bonus signals.

## 3. Canonical usage normalization

Every normalizer maps the upstream's native token counts onto one canonical `Usage` (`normalize/core`):

```
PromptTokens · CompletionTokens · TotalTokens · CacheReadTokens · CacheCreationTokens · ReasoningTokens   (all *int)
```

The convention is OpenAI's, so cost and analytics never branch on provider:

- **Anthropic** — wire `input_tokens` counts uncached input only, so the normalizer sets `PromptTokens = input_tokens + cache_read_input_tokens + cache_creation_input_tokens` and `CompletionTokens = output_tokens` (`codecs/anthropic_messages.go`).
- **Gemini** — `PromptTokens = promptTokenCount`, `CompletionTokens = candidatesTokenCount + thoughtsTokenCount`, `CacheReadTokens = cachedContentTokenCount`, `ReasoningTokens = thoughtsTokenCount` (`codecs/gemini_generate.go`).
- **OpenAI-compatible family** — `codecs/openai_chat.go` resolves the cached-token alias chain across vendors (DeepSeek `prompt_cache_hit_tokens`, Moonshot `prompt_cache_tokens`); the Responses-API top-level `input_tokens` / `output_tokens` mapping lives in `codecs/openai_responses.go`.

This is the contract `core.ExtractUsage` in the AI Gateway depends on — see [provider-adapter-architecture.md](provider-adapter-architecture.md) §5.

## 4. Text and structure extraction

Beyond usage, a normalizer reconstructs the conversation into `Messages[]`, each a `core.Message` with a role and a `[]ContentBlock`. Content blocks carry typed payloads — `text`, `tool_use`, `tool_result`, and `reasoning` — so the audit pipeline stores readable normalized text and preserves tool and chain-of-thought content rather than dropping it. Embedding wires populate `Inputs[]` and `Usage` instead of messages. Streamed responses are folded frame by frame (`normalize/extract/accumulator.go`) into a single final payload.

A Tier-1 codec whose surface is captured as a self-contained SSE stream folds that stream itself before decoding. `codecs/openai_responses.go` is the case in point: a streamed `/v1/responses` egress is stored as the raw Responses-API event stream the client received (`event: response.output_text.delta` … terminated by `response.completed`, which carries the complete response object). The codec collapses that stream to the terminal response object — falling back to the accumulated `output_text` deltas when the capture is truncated before the terminal event — so a streamed row normalizes to the same `Messages[]` + `Usage` as a non-streamed one instead of failing the JSON decode on the leading `event:` framing and emitting an empty payload.

## 5. Reuse across services

`BuildRegistry` wires all three tiers — `codecs.RegisterDefaultAIBuiltins`, `adapters.RegisterTier1AdapterNormalizers`, `extract.WireTier2` — and freezes the registry. Each service builds it once at startup and calls `Registry.Normalize`:

- **AI Gateway** — `core.ExtractUsage` (`packages/ai-gateway/internal/providers/core/usage_extractor.go`) is the entry point; each codec's `DecodeResponse` delegates there.
- **Compliance Proxy** — wires the registry to normalize intercepted request/response bodies (`packages/compliance-proxy/cmd/compliance-proxy/wiring/normalize.go`).
- **Agent** — normalizes a client's outbound traffic on the forward path.
- **Hub** — normalizes at audit time when ingesting agent audit uploads.

Because all four build from the same assembly, the same upstream bytes produce byte-identical canonical output regardless of where they were captured. A new provider's usage or text mapping is added once, in the shared layer, and every service inherits it. The interception-side detail (per-host adapters, Tier-2 detectors for consumer surfaces) is in [compliance-pipeline-architecture.md](../compliance-proxy/compliance-pipeline-architecture.md).

## 6. Adding a normalizer or detector

- **Tier-1 normalizer** — implement `Normalizer` in `normalize/codecs`, register it in `codecs/register.go` under its `AdapterType` (and `AdapterType::EndpointPath`) keys, and stamp `Confidence` via `ScoreTier1Confidence` so a low-confidence parse can fall through to Tier 2.
- **Tier-2 detector** — implement `NonJSONDetector` and append it to `NonJSONDetectors` in `normalize/extract/detector.go`; `WireTier2` picks it up automatically.

**Sharp edge:** the per-host traffic adapters and the `codecs` builtins register overlapping wire keys, so `alreadyCoveredByAIBuiltins` (`packages/shared/traffic/adapters/builtins.go`) must stay in lock-step with the OpenAI-compatible / Anthropic / Gemini key blocks in `codecs/register.go`. A key added on one side but not excluded on the other makes the frozen registry reject a duplicate registration at startup. A registration test guards the invariant.

## References

- `packages/shared/transport/normalize/core/` — Normalizer interface, NormalizedPayload, Usage, Registry coordinator
- `packages/shared/transport/normalize/codecs/` — Tier-1 per-wire normalizers + registration
- `packages/shared/transport/normalize/extract/` — Tier-2 NonJSONDetector framework + spec probe + SSE accumulation
- `packages/shared/transport/normalize/buildregistry.go` — three-tier registry assembly
- `packages/shared/traffic/adapters/builtins.go` — per-host Tier-1 adapter registration
- `packages/ai-gateway/internal/providers/core/usage_extractor.go` — AI Gateway entry into the shared layer
- `packages/compliance-proxy/cmd/compliance-proxy/wiring/normalize.go` — compliance-proxy registry wiring
