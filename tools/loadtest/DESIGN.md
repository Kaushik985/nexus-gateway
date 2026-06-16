# loadtest — LLM gateway stress tester (design)

Purpose-built load generator for LLM gateways (Nexus AI Gateway and any
OpenAI-/Anthropic-compatible endpoint). Decoupled from the system under test
(zero DB dependency). Closed load model, target 1k+ concurrency.

## Why not a generic HTTP tool
LLM traffic has semantics a generic tool ignores: multi-turn conversations
(growing context), streaming with time-to-first-token, token throughput, cost,
and response/prompt caching that silently distorts results. This tool models
those first-class.

## Layers (each one purpose, testable in isolation)
```
Engine (staged ramp: ramp → steady hold, warmup excluded)
 └ VU pool per stage (total concurrency split across scenarios by weight)
     └ each VU loops: pick scenario by weight → run one Conversation
         └ Conversation: inject conv-UUID (front of first user msg + header)
             └ 1..turns Turns: build normalized msgs (prior assistant fed back)
                 → Protocol.BuildBody → HTTP/SSE → measure total / TTFT / tokens
 ├ Sink: JSONL, large buffer, batched, crash-safe (decoupled from metrics)
 └ Reporter: per-scenario + aggregate → report.txt + summary.json
```
The **metrics aggregator is in-memory and always complete** (feeds the report);
the **JSONL sink is best-effort** under extreme rate (overflow counted, never
blocks a VU — blocking would distort latency). At LLM rates the sink never
drops.

## Protocol adapters (the only place wire-format lives)
The engine is 100% protocol-agnostic; it works on a normalized conversation.
A protocol is ONE self-registering file. Adding/changing a protocol touches
only that file — never the engine, sink, or reporter.

```go
type Msg struct { Role, Content string }
type Conversation struct { Model, System string; Msgs []Msg; MaxTokens int; Stream bool }
type Turn struct { Content string; PromptTokens, CompletionTokens int }

type Protocol interface {
    Name() string
    Path() string                          // default endpoint path
    BuildBody(Conversation) ([]byte, error)
    ParseNonStream([]byte) (Turn, error)
    ParseStream(io.Reader) (Turn, error)   // owns its SSE format
}
// adapters self-register: func init(){ Register("anthropic", func() Protocol {...}) }
```
The **only** stream/non-stream branch in the engine is protocol-agnostic:
`if c.Stream { p.ParseStream(body) } else { p.ParseNonStream(bytes) }`. TTFT is
measured by the transport (httptrace), independent of protocol and streaming.

Ship now: `openai-chat` (/v1/chat/completions), `anthropic` (/v1/messages).
Future (one file each, one register line): `openai-responses`, `gemini`, …
Protocol-specific headers (e.g. `anthropic-version`) go in the scenario's
`headers` config — not baked into code.

## Config (declarative JSON profile)
```json
{
  "defaults": { "protocol":"openai-chat", "target":"https://.../v1/chat/completions",
                "headers": {"Authorization":"Bearer nvk_..."}, "model":"claude-haiku-4-5",
                "max_tokens":64, "stream":false },
  "stages":  [ {"concurrency":1,"duration":"10s"}, {"concurrency":100,"duration":"60s"},
               {"concurrency":1000,"duration":"120s"} ],
  "warmup":  "10s",
  "cache_mode": "bust",            // bust (default) | shared-prefix | natural
  "correlation": { "uuid_in_prompt": true, "header": "x-request-id" },
  "thresholds": { "ttft_p95_ms":0, "p95_ms":0, "error_rate":0 },
  "scenarios": [
    { "name":"quick-qa", "weight":70, "turns":1, "stream":false, "max_tokens":64,
      "content": {"mode":"pool", "prompts":["...","..."]} },
    { "name":"chat", "weight":20, "turns":{"min":3,"max":6}, "stream":true,
      "content": {"mode":"scripted", "script":["Hi","tell me more","and then?"]} },
    { "name":"long-ctx", "weight":10, "turns":2, "stream":true, "max_tokens":256,
      "content": {"mode":"sized", "approx_input_tokens":2000} }
  ]
}
```
No `scenarios` block → a single implicit scenario from `defaults` (simple use).
A scenario may override `protocol`/`target` → one run can mix OpenAI-ingress
and Anthropic-ingress load against the same gateway.

## LLM semantics
- **turns**: fixed int or `{min,max}` (distribution). Multi-turn feeds the
  assistant reply back so context grows like a real session.
- **content**: `pool` (random prompt), `scripted` (fixed dialogue), `sized`
  (generate ~N input tokens — controls input size for throughput tests).
- **cache_mode**: `bust` default — a per-conversation UUID at the FRONT of the
  first user message forces a cache miss, threads all turns of the conversation,
  and is the join key to server-side records. Also sent as a header.
- **metrics**: TTFT (first token), TPOT/inter-token = (total−TTFT)/completion_tokens,
  output tokens/s, prompt/completion tokens, total latency, error taxonomy.

## Load model + 1k+ hardening
- Closed model; `weight` = share of the VU pool (1000 VU → 700/200/100).
- Stages ramp concurrency; `warmup` window excluded from steady-state stats.
- Startup raises `RLIMIT_NOFILE` (soft→hard); warns if still below need.
- HTTP transport: `MaxConnsPerHost = MaxIdleConnsPerHost = maxConcurrency`,
  large r/w buffers; `disable_http2` / `disable_keepalive` knobs.
- Report includes **generator health**: achieved vs target concurrency,
  client-side saturation errors (ephemeral-port exhaustion, FD) listed
  separately so a generator bottleneck is never misread as a server fault.
- Single-host ceiling; distributed generation is future work.

## Outputs
- `results-<ts>.jsonl` — one line per turn (conv-UUID, scenario, turn, stream,
  start, latency, ttft, status, prompt/completion tokens, content_len, err).
- `report-<ts>.txt` — per-scenario + aggregate (latency + TTFT percentiles,
  RPS, tokens/s, error breakdown, threshold pass/fail, generator health).
- `summary-<ts>.json` — machine-readable.
- `join.sh` — Nexus-specific optional post-step: given a DB DSN, join the
  client JSONL ⨝ `traffic_event` by conv-UUID into a client+server report.

## Layout
`tools/loadtest/` — own Go module (outside go.work; not under the packages/**
95% coverage binding). Single static binary; runs on any generator host.
`main.go` (engine), `protocol.go` + `proto_*.go` (adapters), `config.go`,
`sink.go`, `report.go`, `profiles/*.json`, `join.sh`, `README.md`.
