# loadtest — LLM gateway stress tester

A purpose-built, scenario-driven load generator for LLM gateways (the Nexus AI
Gateway and any OpenAI-/Anthropic-compatible endpoint). Decoupled from the
system under test (zero DB dependency). Closed load model, designed to scale to
**1000+ concurrent** virtual users from one host.

Full design rationale: [DESIGN.md](DESIGN.md).

## Build & run

It's its own Go module (outside the repo `go.work`, so it never trips the
`packages/**` coverage gate). Build a static binary or `go run`:

```bash
cd tools/loadtest
GOWORK=off go build -o loadtest .
./loadtest -config profiles/ai-gateway.json -vk nvk_xxx -out runs/
# or:
GOWORK=off go run . -config profiles/ai-gateway.json -vk nvk_xxx -out runs/
```

Flags: `-config` (required), `-out` (dir), `-vk` (sets the Bearer token on every
scenario), `-target` (override), `-stages "1:10s,100:60s,1000:120s"` (override).

## What it models (and why it's not "fire N identical requests")

- **Staged ramp** — each stage holds a fixed concurrency for a fixed duration
  (closed model). A `warmup` window is excluded from steady-state stats.
- **Weighted scenario mix** — one run blends realistic traffic shapes
  concurrently (e.g. 70% quick-qa, 20% multi-turn chat, 10% long-context).
  `weight` is the scenario's share of the VU pool (1000 VU → 700/200/100).
- **Single & multi-turn conversations** — a multi-turn VU feeds the assistant
  reply back into the next turn, so context (and cost, and latency) grows like a
  real session. `turns` is a fixed int or `{min,max}`.
- **Streaming & non-streaming**, with **TTFT** (time-to-first-token) measured
  separately from total latency.
- **Cache-busting + traceability** — `cache_mode: bust` (default) puts a
  per-conversation UUID at the front of the first message: it forces a cache
  miss, threads every turn of the conversation, AND is the join key to
  server-side records (also sent as the `x-request-id` header).
- **Pluggable protocols** — `openai-chat` and `anthropic` ship today; a scenario
  can override `protocol`+`target`, so one run can stress both ingresses of the
  same gateway. Adding a provider (Gemini, OpenAI Responses, …) is one new file
  implementing the `Protocol` interface (see `protocol.go`) — the engine never
  changes.

## Config

See `profiles/ai-gateway.json` (mixed workload) and `profiles/cross-ingress.json`
(two ingress protocols at once). Schema is documented in DESIGN.md §Config. With
no `scenarios` block, the top-level `defaults` form a single implicit scenario.

`content.mode`:
- `pool` — random prompt from a list (varied).
- `scripted` — a fixed dialogue (coherent multi-turn).
- `sized` — generate ~`approx_input_tokens` of input (controls input size for
  token-throughput tests).

## Outputs (in `-out`)

- `results-<ts>.jsonl` — one line per turn, written as it completes (crash-safe):
  `conv_uuid, scenario, turn, stream, latency_ms, ttft_ms, status, prompt_tokens,
  completion_tokens, warmup, err`.
- `report-<ts>.txt` — per-stage × per-scenario table (RPS, ok%, latency p50/p95/
  p99, TTFT p50/p95, output tokens/s), aggregate, **generator-health** section,
  and threshold pass/fail.
- `summary-<ts>.json` — machine-readable.

## Reading the report

- **Per-stage percentiles are the meaningful view** for a step test (each stage
  is one concurrency level). A flat p50 across rising concurrency means the
  gateway adds no concurrency penalty.
- **TTFT** is the chat-UX metric (time to first token); **output tokens/s** is
  the throughput metric.
- **Generator health** tells you whether the *load tester itself* was the
  bottleneck: it lists the host FD limit, any JSONL sink overflow, and
  generator-side errors (`gen_port_exhaustion`, `gen_fd_exhaustion`). If those
  appear, the numbers reflect the harness, not the server — scale out / raise
  limits and re-run.

## Scaling to 1000+ concurrency

- The tool raises its own `RLIMIT_NOFILE` (soft→hard) at startup. If it warns
  that the limit is still too low, raise `ulimit -n` on the generator host.
- 1000 concurrent connections need ~1000+ FDs and ephemeral ports. Watch the
  generator-health section for `gen_port_exhaustion`.
- For a single very large run, one host may not be enough — run multiple
  generator hosts against the same target and merge the `summary-*.json` files.

## Server-side correlation (Nexus)

Each turn carries its conversation UUID (in the prompt and the `x-request-id`
header). `join.sh` joins the client `results.jsonl` against the gateway's
`traffic_event` rows by that UUID, producing a combined client+server view
(client-observed latency next to server-measured `latency_ms`, `upstream_total_ms`,
tokens, and `cache_status`). This is Nexus-specific and optional — the load
tester itself has no DB dependency.
