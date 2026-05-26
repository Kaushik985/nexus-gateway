# Agent UI — Stats (local rollup dashboard)

Stats is a summary dashboard built from metrics the agent rolls up locally, rather than from individual events. It reads pre-aggregated rows from the agent's own metric-rollup tables and renders KPI cards, an inline trend chart, and two top-N breakdown tables. The page is `packages/agent/ui/frontend/src/pages/activity/Stats.tsx`.

## Controls

- **Time range** — 1h, 6h, 24h, 7d, or 30d (default 24h).
- **Cohort** — All flows (default) or AI only; the AI cohort narrows the KPI cards and the host breakdown to known AI hosts, and the choice is remembered across restarts.
- **Trend metric** — a selector that picks which metric the trend chart plots (defaults to request count).

## KPI cards

Ten cards summarizing the selected range:

- **Requests** — total request count.
- **Success rate** — 2xx responses as a share of 2xx + 4xx + 5xx.
- **Avg latency** — average total latency.
- **Avg agent overhead** — the agent's own added time per request.
- **Avg upstream** — the upstream round-trip time.
- **Bytes in** and **Bytes out** — total bytes transferred.
- **Inspect rate** — inspected flows as a share of inspect + passthrough + deny.
- **Hook allow rate** — hook allows as a share of allow + deny + error.
- **Bump success rate** — successful TLS bumps as a share of success + failed + exempt.

## Trend chart

A single inline chart plots the selected trend metric over the chosen range. It is hand-drawn SVG rather than a charting library, to keep the agent UI bundle small.

## Breakdowns

Two top-N tables side by side:

- **Top hosts** — by destination host, with average agent-overhead and average upstream columns alongside the request count. The AI cohort filter applies here.
- **Top processes** — by originating process, by request count.

There is no provider or model breakdown: the agent is a transparent proxy, so provider and model names are populated only for the adapters that decode the wire, and would be mostly empty for ordinary consumer traffic.

## Where the data comes from

`agentApi.queryStats` calls the daemon's stats query over the local bridge, reading the agent's own pre-aggregated metric-rollup tables — not the Control Plane admin API and not the raw event store. The metric catalog is agent-specific (request, status, latency, bytes, action, hook, and bump counters).

## References

- `packages/agent/ui/frontend/src/pages/activity/Stats.tsx` — the dashboard, KPIs, and breakdowns
- `packages/agent/ui/frontend/src/pages/activity/MiniLineChart.tsx` — the inline trend chart
- `packages/agent/ui/frontend/src/lib/aiHosts.ts` — the AI-host registry behind the AI cohort
- `packages/agent/ui/frontend/src/api/agent.ts` — `agentApi.queryStats` and the `StatsResponse` shape
