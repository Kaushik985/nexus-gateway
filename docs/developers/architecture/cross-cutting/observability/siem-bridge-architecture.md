# SIEM bridge architecture

The SIEM bridge forwards a copy of every security- and audit-relevant event to a
customer-owned external SIEM (Splunk, Datadog, Elastic, or any HTTP webhook). It
lets a customer retain and correlate Nexus Gateway activity inside their own
security tooling without granting access to the Nexus database.

The bridge is a **Hub-side polling forwarder**. It does not sit in the request
path and is not driven by the message queue. It polls two PostgreSQL tables on a
schedule, classifies the new rows, and POSTs them to the configured endpoint.

## What this doc covers (and what it does not)

This doc covers the bridge itself: the poll loop, checkpointing, classification,
the sink and wire formats, the scheduler job, and the Control Plane admin surface
that configures it.

It does **not** cover how `traffic_event` and `AdminAuditLog` rows are produced —
that is the audit pipeline, described in
[audit-pipeline-architecture.md](audit-pipeline-architecture.md). The bridge is a
pure consumer of those two tables. For where the SIEM surface sits among the other
observability surfaces, see
[observability-architecture.md](observability-architecture.md).

## 1. Inputs: two tables, one forwarder

The bridge reads from exactly two tables:

- `traffic_event` — the unified traffic audit table. Every traffic source lands
  here, including compliance-proxy traffic (rows with `source = 'compliance-proxy'`).
  There is no per-service split; the bridge forwards them all through one path.
- `AdminAuditLog` — administrative mutations (who changed what, with before/after
  state).

Because the bridge consumes the already-persisted tables, an event reaches the
SIEM regardless of which service produced it, and the bridge needs no awareness of
the producers.

## 2. The poll loop

`packages/nexus-hub/internal/observability/siem/bridge.go` holds the `Bridge`. Its
active sink and active config are stored in atomic pointers so configuration can be
swapped without stopping the poll loop.

Each `Poll` cycle:

1. **Reload config.** `Reload` re-reads the `siem.config` row from `system_metadata`
   at the head of every cycle. A missing row, `enabled = false`, or an empty URL
   collapses the active sink to nil, and the cycle becomes a no-op. This is what
   lets an admin enable or reconfigure SIEM and have it take effect within one poll
   interval, with no restart and no shadow plumbing.
2. **Load checkpoints.** Two independent checkpoints live in `system_metadata`:
   one for traffic events, one for admin events. A missing checkpoint defaults to
   24 hours ago. The two cursors advance independently so a burst in one table does
   not stall the other.
3. **Query new rows.** Each table is queried for rows with `timestamp` after its
   checkpoint, ordered ascending, limited to the batch size.
4. **Classify** each row into an `eventType` (see [§4](#4-classification)).
5. **Filter** the merged batch by the configured `eventTypes` whitelist (an empty
   whitelist forwards everything).
6. **Send** the batch through the active sink.
7. **Advance checkpoints** — but only after a successful send, and only for the
   tables that produced rows. This ordering makes delivery at-least-once: a send
   failure leaves the checkpoints unmoved, so the next cycle retries the same rows.
   The external SIEM is expected to dedupe on the event `id`.

`Poll` is serialized by a mutex, so cycles never overlap. Defaults are a 30-second
poll interval and a batch size of 200.

### Traffic rows are security-relevant only

The traffic query returns only security-relevant rows: those where either pipeline
stage (request or response hook) blocked the request, or flagged it `rate_limited`
or `budget_exceeded`. Ordinary allowed traffic is not forwarded — an external SIEM
wants policy and security signal, not a copy of every request. Admin audit rows are
forwarded in full, since each one is a privileged mutation worth retaining.

Each forwarded traffic row carries both pipeline stages — `requestHook*` and
`responseHook*` fields — plus flat `hookDecision` / `hookReason` / `hookReasonCode`
aliases (preferring the response stage when both are present) so existing SIEM
dashboards that key on a single decision field keep matching.

## 3. Sink and wire formats

The transport is a pluggable `Sink` interface
(`packages/nexus-hub/internal/observability/siem/sink.go`), with one
implementation: `HTTPSink`. It POSTs each batch to the configured URL with the
configured headers (typically an auth token such as `Authorization: Splunk <token>`).
A non-2xx response is an error, which leaves the checkpoint unmoved so the batch is
retried on the next cycle. The single HTTP sink is vendor-agnostic — Splunk HEC,
Datadog, Elastic, and generic webhooks are all HTTP endpoints distinguished only by
URL and headers.

The payload shape is chosen by a `Formatter`
(`packages/nexus-hub/internal/observability/siem/formatter.go`). Three formats are
available, selected by the `format` config field:

- `json` (default) — the batch as a JSON array.
- `cef` — one ArcSight Common Event Format line per event, with a severity derived
  from the event type.
- `syslog` — one RFC 5424 syslog line per event, facility `local0`, with a severity
  derived from the event type.

## 4. Classification

Each row is mapped to an `eventType` string before filtering and forwarding
(`packages/nexus-hub/internal/observability/siem/classify.go`):

- **Traffic events** map from the hook decision and reason code: a block flagged
  `rate_limited` becomes `traffic.rate_limited`, a block flagged `budget_exceeded`
  becomes `traffic.budget_exceeded`, any other block becomes `traffic.request_blocked`.
- **Admin events** map to `{entityType}.{action}` (for example `virtualKey.create`).

The `eventTypes` whitelist on the config filters which of these the bridge forwards.

## 5. Scheduler integration

The bridge runs as a Hub scheduler job
(`packages/nexus-hub/internal/jobs/defs/audit/siem_bridge.go`, id `siem-bridge`)
whose `Run` simply calls `Bridge.Poll`. `Poll` handles its own errors by logging
and never panics, so the job always reports success to the scheduler. The job is
always registered; because `Reload` runs at the head of every cycle, it stays a
cheap no-op until an admin enables `siem.config`, at which point the next cycle
begins forwarding — no restart required.

## 6. Admin configuration surface

The Control Plane owns the admin API
(`packages/control-plane/internal/observability/siem/handler/`). It is reached
under the admin API group and gated by IAM on the audit-log resource:

| Route | Verb | IAM | Purpose |
| --- | --- | --- | --- |
| `/settings/siem` | GET | audit-log read | Read the current config (auth headers masked) |
| `/settings/siem` | PUT | audit-log write | Save the config (validates format and URL; audit-logged) |
| `/settings/siem/test` | POST | audit-log write | Send a one-off probe event to the configured endpoint |
| `/settings/siem/event-types` | GET | audit-log read | List selectable event types for the filter picker |

The config — `enabled`, `url`, `format`, `headers`, and the `eventTypes` whitelist —
is persisted as the `siem.config` row in `system_metadata`. The PUT validates that
`format` is one of `json` / `cef` / `syslog` and that `url` is an HTTP(S) URL. The
GET masks the `Authorization` and `x-api-key` header values so secrets are never
echoed back to the UI. Saving the config is itself recorded in the admin audit log.

The event-type picker is sourced from `/settings/siem/event-types`, which returns
the security-relevant `traffic.*` types plus one entry per `(resource, verb)` pair
in the canonical IAM catalog, so the admin UI can offer a service → resource →
event-type drill-down that mirrors the IAM policy editor.

Because the bridge re-reads `siem.config` every poll cycle, a saved change
propagates within one poll interval without any restart or shadow push.

## 7. Correlation

Every forwarded row carries the `trace_id` (the `X-Nexus-Request-Id` value stamped
on the originating request). A SIEM operator can pivot on that id to correlate a
forwarded event back to the full set of `traffic_event` rows for the same request
across services. The correlation-key model is described in
[observability-architecture.md](observability-architecture.md).

## References

- `packages/nexus-hub/internal/observability/siem/bridge.go` — poll loop, checkpoints, queries
- `packages/nexus-hub/internal/observability/siem/sink.go` — Sink interface + HTTPSink
- `packages/nexus-hub/internal/observability/siem/formatter.go` — JSON / CEF / syslog formatters
- `packages/nexus-hub/internal/observability/siem/classify.go` — event-type classification + whitelist filter
- `packages/nexus-hub/internal/jobs/defs/audit/siem_bridge.go` — scheduler job wrapper
- `packages/control-plane/internal/observability/siem/handler/` — admin config API
- `packages/control-plane-ui/src/pages/infrastructure/siem/SettingsSiemTab.tsx` — admin UI
