# Data retention & purge architecture

Nexus Gateway keeps audit, traffic, and metric data only as long as it is useful,
then deletes it. Retention is enforced by a set of daily Hub scheduler jobs, each
owning a distinct set of tables, plus a subject-driven right-to-erasure path that
anonymizes a person's data on request. This doc covers what gets purged, the
configuration that governs it, and the erasure flow.

The scheduler framework itself — registration, the advisory lock that guarantees
at-most-one replica runs a job per tick, intervals, and run history — is described
in [jobs-architecture.md](../foundation/jobs-architecture.md). This doc focuses on
the retention semantics layered on top.

## 1. Retention configuration

Retention windows come from two places:

- **Hub config (`RetentionConfig`)** — per-table day counts in
  `packages/nexus-hub/internal/config/config.go`, overridable per field by
  `NEXUS_HUB_RETENTION_*` environment variables. A value of zero or less disables
  purge for that table, so an operator can keep a table indefinitely.
- **`metric_ops_retention_config` table** — one row per ops-metric/diag layer
  (`layer` primary key, `retention_days`), managed through the Control Plane admin
  API and read live by the ops-retention job each run. This lets operators tune
  ops/diag retention without a redeploy.

## 2. The purge jobs

Four daily jobs divide the tables between them. Each purges its tables
independently — a failure on one table does not stop the others (the job joins the
errors and returns them together) — and each honors the "zero disables" rule.

### data-retention

`packages/nexus-hub/internal/jobs/defs/retention/data_retention.go` purges the
audit and traffic tables:

- `traffic_event_payload` (by `created_at`) — purged first, since request/response
  body blobs are the bulky part and usually have the shortest window.
- `traffic_event` (by `timestamp`) — its `ON DELETE CASCADE` to
  `traffic_event_payload` cleans up any payload rows that outlived the payload
  window.
- `AdminAuditLog` (by `timestamp`).

### rollup-retention

`packages/nexus-hub/internal/jobs/defs/rollup/rollup_retention.go` owns the entire
business-metrics rollup tier chain — `metric_rollup_5m`, `metric_rollup_1h`,
`metric_rollup_1d`, `metric_rollup_1mo` — purging each by its own per-tier day
count (finer tiers expire sooner). This is the single owner of `metric_rollup_*`
purging.

### ops-retention

`packages/nexus-hub/internal/jobs/defs/retention/ops_retention.go` reads every row
of `metric_ops_retention_config` and applies each layer's window to its matching
table. The layers cover the ops-metric raw and rollup tiers
(`metric_ops_raw`, `metric_ops_rollup_1h` / `_1d` / `_1mo`, split into runtime vs
business classes) and the diagnostic-event levels (`thing_diag_event` rows by
`info` / `warn` / `error` / `fatal`). Deletes run in chunks (looping until a chunk
comes back short) so each transaction stays small and never blocks the live
writers for long.

### job-retention

`packages/nexus-hub/internal/jobs/defs/retention/job_retention.go` keeps the
`job_run` history table bounded by count, not age: it keeps the most recent N runs
per job (matching the admin UI's paginated run-history view). It also runs once on
startup so a fresh replica prunes immediately.

## 3. Right to erasure (DSAR)

The Control Plane exposes a data-subject-request workflow under
`packages/control-plane/internal/governance/dsar/` for access and erasure
requests. Requests live in the `dsar_request` table and move through a status
machine: `PENDING` → `IN_PROGRESS` → `COMPLETED` or `REJECTED`. Every route is IAM
gated on the `dsar` resource, and create / update / fulfill are recorded in the
admin audit log.

A request is one of two types:

- **ACCESS** — fulfillment exports the subject's data and stores the export in the
  request's outcome.
- **ERASURE** — fulfillment **anonymizes rather than deletes**. It nulls the
  identifying columns on the subject's `traffic_event` rows — `entity_id` and
  `source_ip` for virtual-key traffic, and `source_ip` and `source_process` for
  the subject's agent traffic within its assignment windows — and returns counts
  of the rows anonymized. The rows themselves remain, which preserves the audit
  trail and the aggregate rollups while severing the link to the person.

Erasure is keyed by the subject's user id, and the resulting counts are written
into the request outcome and the audit entry.

## 4. Design notes

- **Zero means keep forever.** Every per-table window treats a non-positive value
  as "disabled", so retention is opt-in per table and an operator never loses data
  by leaving a window unset.
- **One owner per table.** `metric_rollup_*` purging lives only in
  rollup-retention; data-retention covers `traffic_event*` and `AdminAuditLog`;
  ops-retention covers the `metric_ops_*` and diag tables. No table is purged by
  two jobs.
- **Chunked deletes for hot tables.** The ops tables are the highest-volume, so
  ops-retention deletes in bounded chunks to keep transactions short; the
  lower-volume audit tables purge in a single statement per table.
- **Erasure preserves rows.** Right-to-erasure is column-level anonymization, not
  row deletion, so audit integrity and aggregate metrics survive a subject's
  erasure.

## References

- `packages/nexus-hub/internal/config/config.go` — `RetentionConfig` + env overrides
- `packages/nexus-hub/internal/jobs/defs/retention/data_retention.go` — traffic + admin-audit purge
- `packages/nexus-hub/internal/jobs/defs/retention/ops_retention.go` — ops-metric + diag purge
- `packages/nexus-hub/internal/jobs/defs/retention/job_retention.go` — job-run history prune
- `packages/nexus-hub/internal/jobs/defs/rollup/rollup_retention.go` — metric_rollup tier purge
- `packages/nexus-hub/internal/quota/rollup/rollupstore.go` — `PurgeRollupBefore`
- `packages/control-plane/internal/governance/dsar/` — DSAR access + erasure flow
- `tools/db-migrate/schema.prisma` — `dsar_request`, `metric_ops_retention_config` models
