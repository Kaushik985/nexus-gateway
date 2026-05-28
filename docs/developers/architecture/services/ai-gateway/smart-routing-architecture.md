# Smart routing architecture

Smart routing is one of the routing engine's strategies (see [routing-architecture.md](routing-architecture.md)). What makes it distinct: instead of resolving a fixed target, it asks a **router LLM** to read the user's prompt and pick the best model from the catalog of routable models. It lives in `packages/ai-gateway/internal/routing/strategies/strategy_smart.go`, with the LLM-call half in `packages/ai-gateway/internal/routing/llm` and the catalog access in `packages/ai-gateway/internal/routing/core`.

## 1. When smart routing runs

A `smart` strategy node fires when an operator authors a rule whose strategy resolves to it — typically the rule matching `model: auto`. The strategy is registered only when its dependencies are wired (`cacheLayer` and the provider-target resolver both present); without them the smart strategy is absent and a rule referencing it resolves to no targets.

The node carries a `SmartConfig`: the router provider and model, an optional system-prompt override, and tuning knobs. Unset knobs fall back to built-in defaults — temperature `0`, max tokens `1024`, timeout `10000`ms — plus an optional default provider/model used as the safety net.

## 2. The decision pipeline

`SmartStrategy.Evaluate` runs a sequential pipeline. Every failure step falls open to `smartFallback`, which resolves the configured default provider/model — or returns no targets when no default is set. The router LLM is never the single point of failure: a missing config, an empty catalog, an un-routable request, an unwired or erroring router, or an unresolvable selection all degrade gracefully to the default.

1. **Config check** — a node missing the router provider or model yields no targets.
2. **Candidate enumeration** — `ListEnabledChatModels` lists the routable models. When the virtual key carries an allowed-models list, candidates are filtered to it. An empty candidate set falls back.
3. **Catalog build** — the candidates are rendered into a compact catalog JSON for the prompt.
4. **Prompt assembly** — the system prompt is the operator override or the built-in `DefaultSystemPrompt`, with the `{modelCatalog}` placeholder substituted.
5. **User-content filter** — the canonical request is filtered to `role=user` messages. A request that is nil or not an AI payload, or that carries no user content, falls back — the router LLM is never called with empty or non-AI content.
6. **Decision** — the prepared prompt and user messages go to the `Decider`; any error falls back, with the error text recorded in the trace.
7. **Selection resolution** — the router's returned token is mapped to an internal model UUID. An unknown selection falls back.
8. **Target lookup** — the selected provider/model is resolved into a `RoutingTarget`; a lookup failure falls back. On success the strategy returns that single target.

Each step appends a `TraceEntry` — the selected model and the router's reason on success, or the failure cause otherwise — so the audit `routing_trace` and the simulate surface can replay the decision.

## 3. The catalog shown to the router

`SmartStore.ListEnabledChatModels` returns only enabled chat models joined with their enabled providers; embedding models and disabled providers are excluded, since smart routing is a chat-completion concern. In production the store is backed by the in-memory `cachelayer.Layer`, so the per-request enumeration hits memory rather than PostgreSQL.

`buildModelCatalog` renders the candidates into compact JSON grouped by provider, using short keys to conserve prompt tokens: `p` (provider), `m` (models), and per model `i`, `ip`/`op` (input/output USD per million tokens), `f` (capability tags), `mx`/`mo` (max context and output tokens). The `i` key is the model's **`Model.code`** — not the UUID and not the provider's wire model id. The router is shown the customer-facing code because it is a short, recognizable token; 36-character UUIDs inflate the token budget and LLMs frequently mistype them.

## 4. Mapping the router's answer back to a model

The router returns a code-like token. `resolveSelectedModelID` maps it to an internal `Model.id` UUID suitable for target lookup:

- When the router also returned a provider id, matching is restricted to that provider's rows, so an ambiguous code under the wrong provider does not silently land on a different vendor.
- It then tries an exact `Model.code` match (the canonical happy path), then a UUID match (for prompts that reference the internal id directly), then a unique `providerModelId` match (for outputs that lifted the upstream vendor name verbatim — accepted only when exactly one candidate matches).

An ambiguous or absent match is treated as an unknown selection and falls back.

## 5. The Decider and its production implementation

The LLM-call half is encapsulated behind the `Decider` interface — a pure decision function that takes a prepared system prompt, the filtered user messages, and routing metadata, and returns a `Decision` (`ModelID`, optional `ProviderID`, and a natural-language `Reason`). The smart strategy depends only on this interface; it does not import the provider adapter registry, the provider-target resolver, the canonical wire format, or the HTTP status vocabulary. A future local-classifier or rule-engine implementation plugs into the same seam with no change to the strategy.

The production implementation, `AdapterDecider`, makes the router-LLM call as an ordinary gateway provider call:

1. Resolve the router provider/model into a call target via the provider-target resolver.
2. Validate the target's wire format and select the matching provider adapter.
3. Build the request body in canonical OpenAI shape (`BuildRequestBody`); the adapter translates it to the upstream wire format.
4. Execute non-streaming, under the configured timeout.
5. Treat a `>= 400` status or a transport error as a decision failure; otherwise parse the response.

Because the call flows through the same adapter and target-resolution path as customer traffic, smart routing is provider-agnostic — the router LLM can be hosted on any configured provider. See [provider-adapter-architecture.md](provider-adapter-architecture.md).

## 6. Prompt construction and response parsing

`DefaultSystemPrompt` is the built-in router instruction. It documents the compact catalog legend, requires the router to return a `modelId` that exactly matches a catalog `i` (`Model.code`) value, and constrains output to a single JSON object `{"modelId": "...", "reason": "..."}`.

`BuildRequestBody` assembles the canonical OpenAI body — the system message plus the filtered user messages. User content is projected to flat text (`textOf` concatenates text content blocks and drops image, tool, and reasoning blocks — the router gains nothing from binary refs or tool plumbing). Because routing is a single-turn classification task, input is staged with the last-user strategy under a bounded router context window with output reserved, so the router prompt cost stays predictable; on overflow the strategy logs and proceeds, recovering on the next request cycle.

`ParseResponse` extracts the `Decision` from the chat-completions envelope with three fallbacks: a direct JSON parse of the message content, then a markdown code-block extraction, then a last-resort regex that lifts `modelId` and `reason`. A response with no usable `modelId` is a parse failure and falls back.

## 7. Wiring

`InitRouter` (`packages/ai-gateway/cmd/ai-gateway/wiring/router.go`) assembles the smart dependencies only when both the cache layer and the provider-target resolver are present: the catalog store is backed by the cache layer, the target lookup reuses the resolver's lookup function, and the router LLM is an `AdapterDecider` over the provider-target resolver and the adapter registry. These dependencies are passed to `RegisterAllStrategies`, which registers the smart strategy only when they are non-nil.

## References

- `packages/ai-gateway/internal/routing/strategies/strategy_smart.go` — smart strategy pipeline, catalog build, selection resolution, fallback
- `packages/ai-gateway/internal/routing/llm/client.go` — `Decider` interface, `Request`, `Decision`
- `packages/ai-gateway/internal/routing/llm/adapter_decider.go` — production `AdapterDecider`
- `packages/ai-gateway/internal/routing/llm/prompt.go` — default system prompt, request body builder, response parser
- `packages/ai-gateway/internal/routing/core/smart_types.go` — `SmartStore`, `SmartModelRow`
- `packages/ai-gateway/internal/routing/core/smart_store.go` — catalog store adapter, enabled-chat-model enumeration
- `packages/ai-gateway/cmd/ai-gateway/wiring/router.go` — smart-routing dependency wiring
