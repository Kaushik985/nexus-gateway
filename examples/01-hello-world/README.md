# Example 01 — Hello world through the gateway

Walks an OpenAI-format chat-completion request through the AI Gateway, then shows the audit trail Postgres stores. ~3 minutes.

## What you'll see

1. The gateway accepts the request on `/v1/chat/completions` and authenticates it via a virtual key.
2. The gateway looks up the routing rule that matches `model: gpt-4o-mini`, picks a provider + credential, and forwards.
3. The upstream's response streams back to your terminal.
4. The Hub's MQ consumer writes a `traffic_event` row to Postgres with the external_request_id, latency, model, token counts, and the routing trace.
5. You query that row to confirm.

## Prerequisites

- Local stack up (`./scripts/dev-start.sh` finished cleanly).
- A virtual key for at least one OpenAI-format model. The fastest path: the demo seed ships a ready-to-use demo VK — **`nvk_demo_0c101489`** (printed in the seed's "DEMO CREDENTIALS" banner). Use it directly in the `VK` env var below. (To make your own instead: create one in the Control Plane console — Virtual Keys / Personal Virtual Keys — and copy the `nvk_`-prefixed secret shown once at creation.)
- A real OpenAI API key in the seeded `openai` Provider's Credential row. The seed ships a placeholder, so set your key through the Control Plane UI first (`Settings → Providers → OpenAI → Add credential`). Until you do, the request returns `no available provider` (the provider has no usable credential).

## Run it

```bash
export VK="nvk_demo_0c101489"          # the seeded demo VK (or paste your own)
export PROMPT="What's the capital of Japan?"

curl -sS http://localhost:3050/v1/chat/completions \
  -H "Authorization: Bearer $VK" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"gpt-4o-mini\",
    \"messages\": [{\"role\": \"user\", \"content\": \"$PROMPT\"}]
  }" | jq .
```

You should see an OpenAI-shaped response with a non-empty `choices[0].message.content`. Note the `x-nexus-request-id` response header — that's your handle for the audit lookup.

Prefer the gateway to pick the model for you? Send `"model": "auto"` — the seeded
`smart-auto-routing` rule (the only rule enabled by default) uses an LLM to select the
best model for the prompt and routes there.

## See the audit trail

```bash
docker exec $(docker ps --filter "name=postgres" -q | head -1) \
  psql -U postgres -d nexus_gateway -c "
    SELECT
      external_request_id,
      model_name,
      routed_provider_name,
      routed_model_name,
      total_tokens,
      estimated_cost_usd,
      latency_ms,
      timestamp
    FROM traffic_event
    ORDER BY timestamp DESC
    LIMIT 1;"
```

If the row hasn't appeared yet, the Hub's `traffic-event-sink` MQ consumer is still draining — give it 1-2 seconds.

## Now try things

- Add a second message to the request body and re-run. Notice how the audit row's `total_tokens` grows.
- In the Control Plane UI, navigate to `Traffic` and find your request. Click into it to see the routing trace inline.
- In the UI, go to `Hooks` and enable the `keyword-filter` built-in with the keyword `Japan`. Re-run the request. Watch it get blocked at the request stage, and check the audit row — `request_hook_decision` will record the block.

## What's happening under the hood

The end-to-end flow is documented in [`docs/developers/architecture/services/ai-gateway/routing-architecture.md`](../../docs/developers/architecture/services/ai-gateway/routing-architecture.md) and [`docs/developers/architecture/cross-cutting/foundation/multi-endpoint-coordination-architecture.md`](../../docs/developers/architecture/cross-cutting/foundation/multi-endpoint-coordination-architecture.md) (Flow 7 — traffic event lifecycle).

The seven gateway-internal subpackages in play, roughly in order:

1. `vkauth/` validates the VK and resolves the org / project.
2. `requestcontext/` builds a `RequestContext` with `external_request_id` + `trace_id`.
3. `hooks/` runs request-stage hooks (deterministic + aiguard-judged).
4. `routing/` + `canonicalbridge/` evaluate the routing-rule tree against the canonical payload and emit a `ResolvedRequest`.
5. `executor/` dispatches via the chosen provider adapter under `providers/specs/<name>/`.
6. The upstream's response streams back through `streaming/` if SSE, or buffered if not.
7. `audit/` constructs the `traffic_event` and emits it to the `nexus.traffic` MQ stream; Hub's `consumer/` writes it to Postgres.
