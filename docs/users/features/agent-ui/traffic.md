# Agent UI — Traffic (intercepted connections)

Traffic is a timeline of the outbound network connections this agent intercepted, written for the device's own user rather than a fleet admin — it stays at the level of "what app, where, and was it allowed?". The engineering signals (ports, bytes, IP, the hook pipeline) live in a click-to-open detail drawer. It is distinct from the **Activity** page, which lists the agent's own lifecycle events. The page is `packages/agent/ui/frontend/src/pages/traffic/Traffic.tsx`.

## The list

Each row shows the time (relative, with the absolute time on hover), the originating app (process name), the site (hostname), the HTTP method, the path, the latency (human-readable), a status, and tags.

The **status** reflects what the agent did with the connection: `Inspected` (green), `Processed` (amber), `Blocked` (red), `Bump failed` (red), or `Untracked` (muted). The **tags** column adds an `AI` chip when the destination matched an interception domain, a `hook · <decision>` chip when a hook actually ran (red for a deny / reject / soft-block decision, amber for approve), and a `policy` chip when a policy rule applied.

## Filters and controls

- **Action filter** — All, AI, Blocked, or Processed.
- **Time window** — 1 hour, 24 hours, 7 days, 30 days, or all; defaults to 24 hours. The window is pushed down into the daemon's query rather than filtered in the browser.
- **Search** — a server-side search over the events, debounced as you type.
- **Page size** — 10, 25, 50, or 100 rows (default 10).
- **Auto-refresh** — off, 5s, 15s, 30s, 1m, or 5m (default 5s); the choice is remembered across restarts.

## Detail drawer

Clicking a row opens a drawer with the engineering detail for that connection:

- A **latency waterfall** breaking the time into request hooks, the agent's own overhead, upstream time-to-first-byte, upstream body, and response hooks.
- The **event fields**: time, event id, process, target, action, hook decision, latency, status, method, path or URL, destination IP and port, and bytes in and out.
- The **hook pipeline** — the hooks that executed for this event (with empty and unparseable states handled).

## Where the data comes from

`agentApi.queryEvents` calls the daemon's events query over the local bridge, reading the agent's own audit-event store — not the Control Plane admin API. The status, AI tag, and filters are all derived from the same client-side classification of each event.

## References

- `packages/agent/ui/frontend/src/pages/traffic/Traffic.tsx` — the traffic list, filters, and controls
- `packages/agent/ui/frontend/src/pages/traffic/TrafficEventDetail.tsx` — the detail drawer and latency waterfall
- `packages/agent/ui/frontend/src/lib/classify.ts` — `classify`, `statusDescriptor`, and `isAITraffic`
- `packages/agent/ui/frontend/src/api/agent.ts` — `agentApi.queryEvents` and the `AgentEvent` shape
