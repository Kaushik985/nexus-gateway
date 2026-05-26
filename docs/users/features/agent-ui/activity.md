# Agent UI — Activity (lifecycle timeline)

Activity is a timeline of what the agent daemon itself did — started, stopped, paused, resumed, signed in, signed out. It is distinct from the **Traffic** page, which shows per-connection network audit rows: Activity is about the agent's own lifecycle, not the traffic it inspected. The page is `packages/agent/ui/frontend/src/pages/activity/Activity.tsx`.

## Event table

A table with three columns — time, action (as a badge), and details. The actions are `agent.startup`, `agent.shutdown`, `agent.paused`, `agent.resumed`, `agent.sso_login`, and `agent.sso_logout`. The details column is formatted per action: a shutdown shows its reason, a pause shows its duration (in minutes or hours, or "until I resume" when indefinite), an SSO login shows the email, and anything else falls back to a `key: value` list so no attribute is lost.

## Pagination

The table pages 50 events at a time, newest first, with Previous and Next controls and an "x–y of total" count.

## Where the data comes from

`agentApi.queryLifecycle({ offset, limit })` calls the daemon's lifecycle-events query over the local bridge, reading the agent's own `lifecycle_event` table — not the Control Plane admin API, and not the network traffic store that backs the Traffic page.

## References

- `packages/agent/ui/frontend/src/pages/activity/Activity.tsx` — the lifecycle timeline
- `packages/agent/ui/frontend/src/api/agent.ts` — `agentApi.queryLifecycle` and the `LifecycleEvent` shape
