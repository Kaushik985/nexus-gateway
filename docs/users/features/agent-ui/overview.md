# Agent UI — Overview (dashboard)

Overview is the Agent UI's default landing page once the device is enrolled. It reads only the status snapshot the app already polls every two seconds — no extra queries — and lays the answer out in priority order: is the agent doing its job right now, is the plumbing healthy, what did it do today, and what did it just see. The page is `packages/agent/ui/frontend/src/pages/overview/Overview.tsx`.

## Hero status

A single banner shows the one dominant condition the operator must know about, chosen in priority order: paused, then error, then degraded, then update-available, then active. Its tone is green, amber, or red to match. Alongside it the banner shows the signed-in SSO email (or a no-SSO note) and the agent version.

## System tiles

A strip of six tiles, each green, amber, or red:

- **Hub** — connected or disconnected.
- **Heartbeat** — how long ago the last heartbeat was; considered fresh while it is under three times the heartbeat interval.
- **Queue** — the count of unsynced audit events, flagged amber above 1000.
- **Cert** — days until the device certificate expires, flagged amber under 14 days.
- **Update** — whether an agent update is available.
- **Today's latency** — the agent's own added overhead and the upstream round-trip, in milliseconds, shown once at least one inspected flow has happened today.

## Today's protection

Three counters for the current day: **Inspected** (flows run through the compliance pipeline), **Passthrough** (tunneled through uninspected), and **Denied** (blocked). These mirror the agent's process / passthrough / block decision model.

## Recent activity

The five most recent events, each with its time, the originating process, the destination host, and an action badge. The full stream lives on the Activity page.

## Where the data comes from

The whole page renders from the `StatusSnapshot` the app polls every two seconds (`agentApi.getStatus`) — `todayStats` for the counters and latency, `recentEvents` for the activity table, and the `agent` block for identity, version, heartbeat, certificate, and update fields. No additional calls are made from this page.

## References

- `packages/agent/ui/frontend/src/pages/overview/Overview.tsx` — the dashboard
- `packages/agent/ui/frontend/src/app/App.tsx` — the two-second status poll that feeds it
- `packages/agent/ui/frontend/src/api/agent.ts` — `agentApi.getStatus` and the `StatusSnapshot` shape
