# Agent observability

The agent is observability-first but local-first: every intercepted flow is
recorded into an encrypted on-device queue, then drained to Nexus Hub
asynchronously. Nothing on the capture hot path waits on the network or on disk
fsync. This document covers the audit-upload pipeline, the backpressure valve
that protects the hot path, the classification vocabulary that gates upload, the
local metric rollups, and OTel tracing. Diagnostic events (agent self-health) are
a separate pipeline — see
[diag-event-triage-architecture.md](../../cross-cutting/observability/diag-event-triage-architecture.md).

## The audit pipeline

A captured flow travels capture → buffer → SQLite → drain → Hub:

1. **Capture.** The bump path (and the per-flow auditor for non-bumped flows)
   produces a canonical `audit.AuditEvent`.
2. **Async buffer.** `QueueWriter` maps it to a row and pushes it onto a bounded
   channel; a background loop batches rows (by count or a short interval,
   whichever trips first) into one SQLite transaction so N events share one
   fsync. The push is O(ns) and never blocks the inspect goroutine — when the
   channel is full the event is dropped with a WARN and a drops counter, so a
   slow upstream degrades audit completeness rather than user traffic.
3. **Storage.** The queue is a SQLCipher-encrypted SQLite database
   (`audit_events`). Bodies follow a two-tier model: at or below the inline cap
   they ride inline in the row; larger bodies spill to the local encrypted spill
   store and the row keeps only a `SpillRef`. The list query is metadata-only;
   the detail view fetches body + normalized on demand via `EventByID`. (See
   [agent-forwarder-architecture.md](agent-forwarder-architecture.md) for the
   capture side and the spill store.)
4. **Drain.** `DrainLoop` periodically pulls a batch of unsynced rows and, for
   each, applies two gates and a conversion before upload: the **upload-level
   gate** (classification × `trafficUploadLevel`, below) drops flows the admin
   doesn't want shipped; the **body-upload gate** (the Hub `payload_capture`
   config) strips bodies the admin doesn't want uploaded while keeping them
   local; and oversize localfs bodies are read back and uploaded to S3 via the
   Hub presign flow, the wire ref swapped to the S3 ref. The batch then uploads
   over the WebSocket primary (or the HTTP fallback) and the rows are marked
   synced. A failed upload leaves the batch unsynced to retry.
5. **Retention.** Synced rows and the local-only audit mirror are pruned on a
   retention horizon; the spill directory is swept on its own retention + size
   cap.

## Backpressure

If the queue backs up — Hub unreachable, disk slow — the drain falls behind and
`UnsyncedCount` climbs. `backpressure.Store` exposes a single `atomic.Bool` the
NE bridge's `handleNewFlow` checks on the hot path (no SQL, no mutex,
sub-microsecond): when set, new flows short-circuit to passthrough instead of
being bumped, so a stalled audit pipeline never blocks the user's network. A
background goroutine polls `UnsyncedCount` off the hot path and flips the flag
with hysteresis — on above the high-water mark, off only after depth falls below
the low-water mark — so it cannot flap. This is the audit-side expression of the
agent's fail-open rule: degrade inspection before degrading connectivity.

## Classification and upload level

`classify` derives a user-facing `Classification` from a flow's orthogonal audit
fields (domain-rule match, path action, hook decision, bump status, error code).
The same value drives two consumers: the agent UI's status column and the drain's
upload filter. `trafficUploadLevel` (a fleet setting — `all` / `processed` /
`blocked`) maps onto classifications so the operator controls how much reaches
Hub; the default keeps purely-local flows (untracked / inspect-only) off the
`traffic_event` table and ships the flows where interception config actively did
something. Every flow is still persisted locally regardless of the level — the
gate is upload-only.

## Local rollups

`localrollup` aggregates the agent's own metrics into per-bucket rollup tables in
the same SQLite database, so the Dashboard's stats view renders from local data
without a Hub round-trip. It is the agent-local mirror of the fleet rollup the
Hub maintains.

## Tracing

`telemetry` is a thin wrapper over the shared `SwappableTracerProvider`: `Init`
constructs the provider so the agent's outbound calls carry W3C trace context
and can be correlated with the compliance proxy and AI gateway spans. The tracer
is swappable so an OTel endpoint can be wired (or rewired) from config without a
restart.

## References

- `packages/agent/internal/observability/audit/queue/queue.go` — the SQLite queue, batch insert, drain loop, retention, `EventByID`
- `packages/agent/internal/observability/audit/queue/writer_adapter.go` — the async `QueueWriter` (bounded channel + batch flush + drop counter)
- `packages/agent/internal/observability/audit/classify/` — the `Classification` vocabulary + upload-level mapping
- `packages/agent/internal/observability/audit/hub/hub_client.go` — the HTTP-fallback audit upload client
- `packages/agent/internal/observability/backpressure/` — the hot-path throttle flag + hysteresis poller
- `packages/agent/internal/observability/localrollup/` — the agent-local metric rollup aggregator
- `packages/agent/internal/observability/telemetry/telemetry.go` — the OTel tracer-provider wrapper
- `packages/agent/internal/observability/spilluploader/uploader.go` — the Hub-presign S3 uploader used at drain
