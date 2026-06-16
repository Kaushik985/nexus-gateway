# loadtest — LLM gateway stress tester

A purpose-built, scenario-driven load generator for LLM gateways (the Nexus AI
Gateway and any OpenAI-/Anthropic-compatible endpoint). Decoupled from the
system under test (zero DB dependency). Closed load model, designed to scale to
**1000+ concurrent** virtual users from one host.

The goal is to **simulate real traffic** — a weighted blend of short lookups,
multi-turn chats, and heavy long-context conversations — not to fire N identical
requests. Realistic shape is what makes the numbers mean something.

Full design rationale: [DESIGN.md](DESIGN.md).

## Build & run

It's its own Go module (outside the repo `go.work`, so it never trips the
`packages/**` coverage gate). Build a static binary or `go run`:

```bash
cd tools/loadtest
GOWORK=off go build -o loadtest .
./loadtest -config profiles/realistic.json -vk nvk_xxx -out runs/
# or:
GOWORK=off go run . -config profiles/realistic.json -vk nvk_xxx -out runs/
```

Flags:

| flag | meaning |
|---|---|
| `-config` | profile path (required) — see `profiles/` |
| `-vk` | sets `Authorization: Bearer <vk>` on every scenario |
| `-target` | override the target URL (so one profile hits any gateway) |
| `-model` | override the model string — e.g. a gateway that needs a `provider/model` form |
| `-stages` | override stages, e.g. `1:10s,100:60s,1000:120s` |
| `-out` | output directory |

> Profiles ship with a `localhost` target and a `REPLACE_WITH_VK` placeholder —
> never commit a real domain or key. Point `-target`/`-vk` at your own gateway.

## Realistic workloads (simple / medium / complex, multi-turn)

`profiles/realistic.json` is the flagship profile. It blends three conversation
tiers by weight, most of them **multi-turn** (a multi-turn VU feeds the assistant
reply back into the next turn, so context — and cost, and latency — grows like a
real session):

| tier | weight | turns | stream | shape |
|---|---|---|---|---|
| **simple** | 55% | 1 | no | short single-shot lookups (the bulk of real traffic) |
| **medium** | 30% | 4 | yes | a real multi-turn technical chat that builds context |
| **complex** | 15% | 3 | yes | large system prompt + multi-turn architecture/reasoning dialogue, long output |

The prompts are drawn from the ai-gateway smoke corpus
(`tests/scripts/smoke-gateway.py`). Why tiers matter: a single prompt size hides
real behaviour — small bodies make extraction/scanning/cost look free, while
large bodies and long outputs exercise the long-context path, token throughput,
and per-byte costs. `think_time` adds a pause between turns to model a real user.

`content.mode` per scenario:
- `pool` — random prompt from a list (varied single-shots).
- `scripted` — a fixed, coherent dialogue (turn *i* uses `script[i]`).
- `sized` — generate ~`approx_input_tokens` of input (controls input size).

## Why test multiple services simultaneously

When comparing gateways (e.g. Nexus vs LiteLLM vs Bifrost), **run them in the
same wall-clock window, not one after another.**

The upstream provider (OpenAI, etc.) is the dominant latency term and it **drifts
minute to minute**. If you benchmark gateway A, then B, then C sequentially, each
samples a *different* upstream window — so a slow upstream draw during A's turn
looks like "A is slow" when it isn't. That sampling unfairness can manufacture a
2–3× "difference" that is pure provider noise.

Run all gateways **co-located, simultaneously**: they then sample *identical*
upstream conditions concurrently, the shared upstream latency is common-mode, and
it **cancels out** when you take the per-gateway delta. What's left — the TTFT
delta between gateways — is ≈ the gateway's own overhead.

`multi-service.sh` does exactly this: it launches the same profile against every
gateway in the same window each round and prints a per-round delta table.

```bash
# edit the SERVICES array in the script, then:
NEXUS_VK=nvk_... ./multi-service.sh profiles/realistic.json 50:60s 3
```

```
gateway   ttft_p50  ttft_p95  lat_p95  rps   err
-------   --------  --------  -------  ----  -----
bifrost   1107      1702      2084     38.0  0.00%
nexus     1204      1919      2231     38.0  0.00%

ttft_p50 delta vs fastest (= gateway overhead; upstream is shared this window):
  bifrost    +    0 ms
  nexus      +   97 ms
```

Gateways under test are defined in the `SERVICES` array (`name|target|model|bearer`);
keys come from env vars, never hardcoded. Even simultaneous numbers are only fair
when the execution substrate matches — e.g. comparing a native process against a
gateway running inside a Docker VM is not apples-to-apples.

## Benchmark hygiene — disable hooks and cache

A *gateway-overhead* benchmark must isolate the raw forwarding path. Two features
distort it, so turn them **off on every gateway under test**:

- **Response cache.** A cache *hit* returns without calling the provider, which
  collapses latency and inflates throughput; even on a miss the cache *lookup*
  adds work. `cache_mode: bust` (default) prefixes every conversation with a
  unique UUID so the provider/gateway cache always *misses* — but for a clean
  baseline also **disable the response cache** so the lookup cost and any
  accidental hits are out of the picture.
- **Compliance / PII hooks.** Request and response hooks add per-request work
  (content extraction, scanning, rewrite) whose cost scales with body size.
  Enable them only when you are *specifically* measuring hook cost.

Competitors typically have neither feature, so leaving them on penalizes the
gateway that has them — an unfair comparison. Measure the raw path first; then
measure each feature as a *delta* on top of that baseline.

## Config

See `profiles/realistic.json` (the flagship mixed workload),
`profiles/ai-gateway.json` (a minimal example), and `profiles/cross-ingress.json`
(two ingress protocols of one gateway at once). Schema is documented in
DESIGN.md §Config. With no `scenarios` block, the top-level `defaults` form a
single implicit scenario.

## Outputs (in `-out`)

- `results-<ts>.jsonl` — one line per turn, written as it completes (crash-safe):
  `conv_uuid, scenario, turn, stream, latency_ms, ttft_ms, status, prompt_tokens,
  completion_tokens, warmup, err`.
- `report-<ts>.txt` — per-stage × per-scenario table (RPS, ok%, latency p50/p95/
  p99, TTFT p50/p95, output tokens/s), aggregate, **generator-health** section,
  and threshold pass/fail.
- `summary-<ts>.json` — machine-readable (consumed by `multi-service.sh`).

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
tokens, and `cache_status`). This is the way to tell whether a client-observed
delta is real gateway overhead or something outside the handler (accept/TLS/
scheduling, upstream variance). Nexus-specific and optional — the load tester
itself has no DB dependency.
