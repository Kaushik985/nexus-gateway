# Audit pipeline architecture

The audit pipeline is the asynchronous fan-in path that turns every LLM traffic event observed by a data-plane service into a row on the Hub's `traffic_event` table (plus its two sidecars, `traffic_event_payload` and `traffic_event_normalized`). It is the substrate the Traffic drawer, cost dashboards, alerting engine, and the SIEM bridge all read from — a single canonical timeline of every request that touched the gateway, the compliance proxy, or an enrolled agent.

This doc covers **LLM traffic only**. Admin-mutation audit (CP-UI writes, IAM changes, credential rotation) travels on a separate queue and table — see `admin-audit-log-coverage.md`.

The pipeline has three structural pieces: the **producer** in each data-plane service (`audit.Record` → `TrafficEventMessage`), the **MQ stream** (`NEXUS_EVENTS` JetStream stream with InterestPolicy fan-out), and the **consumer** in Hub (`TrafficEventWriter` consumer group `hub-db-writer`). A second consumer group (`hub-alerting`) reads the same queues independently for real-time rule evaluation — see §10 and `alerting-architecture.md`. The SIEM bridge is **not** an MQ consumer: it polls the persisted `traffic_event` / `AdminAuditLog` tables on a schedule — see `siem-bridge-architecture.md`.

## 1. Anchor packages

- `packages/ai-gateway/internal/platform/audit/` — file layout: `audit.go` (top-level constants + `EndpointType` vocabulary), `enums.go` (cache/hook enums + `DeriveCacheStatus`), `record.go` (`Record` struct + `ApplyVKMeta` + helpers), `writer.go` (`Writer` lifecycle + `Enqueue` + flush + close), `message.go` (`recordToMessage`), `storage_action.go` (`applyStorageAction`), `coerce.go` (authoritative chat-field zeroing for embedding rows).
- `packages/ai-gateway/internal/ingress/proxy/proxy.go` — the `ServeProxy` handler that allocates the `Record`, hands it to a centralized defer that snapshots phase timings and enqueues, and finalizes latency with ceiling-millisecond rounding.
- `packages/ai-gateway/cmd/ai-gateway/wiring/aiguard.go` — second producer site: ai-guard classify calls emit their own audit row through the same `Writer`.
- `packages/compliance-proxy/internal/audit/` and `packages/compliance-proxy/cmd/compliance-proxy/wiring/audit.go` — compliance-proxy producer, writes to `nexus.event.compliance`.
- `packages/nexus-hub/internal/traffic/ingest/audit/agent_audit.go` — Hub-side ingest of the agent's HTTP-uploaded audit batches, re-published to `nexus.event.agent` so the same consumer can pick them up.
- `packages/shared/transport/mq/messages.go` — `TrafficEventMessage` wire envelope (producer view).
- `packages/shared/transport/mq/streams.go` — `EnsureStreams` for the `NEXUS_EVENTS` JetStream stream.
- `packages/nexus-hub/internal/observability/consumer/` — `TrafficEventWriter`, split by responsibility: `traffic.go` (writer struct, per-queue consume goroutines, `BatchAccumulator`, flush orchestration — batched fast path with per-item reprocessing fallback, typed poison-pill ack policy, ack), `traffic_inserts.go` (`traffic_event` + `traffic_event_payload` inserts), `traffic_normalized.go` (savepoint-guarded `traffic_event_normalized` sidecar inserts), `traffic_dlq.go` (redelivery backoff, nak, DB + on-disk dead-letter sinks), `traffic_nul.go` (NUL-byte / `\u0000` stripping + typed poison-error classification).
- `packages/nexus-hub/internal/observability/consumer/message.go` — consumer-side `TrafficEventMessage` with pointer-typed nullable columns.
- `packages/nexus-hub/internal/observability/consumer/batch.go` — generic batch accumulator (size + interval flush).
- `packages/nexus-hub/internal/observability/consumer/manager.go` — orchestrates `TrafficEventWriter` + `AdminAuditWriter` + `ExemptionConsumer`, exposes the `nexus_consumer_healthy` gauge.
- `tools/db-migrate/schema/traffic.prisma` — `traffic_event`, `traffic_event_payload`, and `traffic_event_normalized` models.
- `packages/shared/policy/payloadcapture/` — runtime caps on captured body bytes and the inline-vs-spill threshold.

## 2. End-to-end shape

```
data-plane service          MQ (NATS JetStream)          Hub
─────────────────           ─────────────────────         ─────
audit.Record (in-proc)
    │
    │ Enqueue (non-blocking)
    ▼
in-memory buffer (≤10000)
    │ flushLoop tick (5s default)
    │ batch of ≤100 → recordToMessage → JSON
    ▼
producer.Enqueue  ──────► nexus.event.{ai-traffic|compliance|agent}
                          (NEXUS_EVENTS stream, InterestPolicy)
                                                       │
                                          hub-db-writer consumer group
                                                       │
                                                       ▼
                                          BatchAccumulator (≤100 / 5s)
                                                       │
                                                       ▼
                                          tx.Begin
                                              insertTrafficEvents      → traffic_event
                                              insertPayloads           → traffic_event_payload
                                              insertNormalizedPayloads → traffic_event_normalized
                                          tx.Commit
                                                       │
                                                       ▼
                                          ackAll(items)
```

The agent never publishes to MQ directly. It uploads audit batches over HTTP to a Hub admin endpoint that converts each event into the same envelope shape and re-publishes to `nexus.event.agent`, so the consumer path is identical for all three sources.

A second consumer group, `hub-alerting`, attaches to the same traffic queues plus `nexus.event.admin-audit` for real-time rule evaluation (`alerting-architecture.md`). The two groups are independent — JetStream's `InterestPolicy` retains messages until **every** registered consumer group acks, so a stalled evaluator cannot mask a stalled db-writer (or vice-versa). The SIEM bridge is not on this MQ path; it polls the persisted tables directly (`siem-bridge-architecture.md`).

## 3. Producer side — `audit.Record` and the central defer

`audit.Record` is the in-process struct each data-plane service mutates throughout request handling. It is allocated in the ingress handler immediately after the request is parsed enough to know its `RequestID`, `TraceID`, `Method`, `Path`, `IngressFormat`, and `EndpointType`, and a `defer` is registered on the same line:

- The defer reads the upstream `PhaseSink` populated by the singleton tracing transport (`UpstreamTtfbMs`, `UpstreamTotalMs`), snapshots the per-request `PhaseTimer` (`auth_ms`, `quota_ms`, `routing_ms`, `cache_lookup_ms`, `req_adapter_ms`, `resp_adapter_ms`, plus the request-hooks sub-phases `hook_extract_ms`, `hook_build_ms`, `hook_pipeline_ms`, `hook_rewrite_ms`), computes `upstream_body_ms` from the TTFB / total gap, computes `audit_emit_ms` for the time spent in the defer up to the hand-off, finalizes `LatencyMs` with **ceiling-millisecond rounding** (so a sub-millisecond cache hit reports as `1` instead of `0`, which the wire format would have treated as "field absent"), and only then calls `h.deps.AuditWriter.Enqueue(rec)`.
- **`RequestHooksMs` vs the `hook_*_ms` sub-phases.** `RequestHooksMs` aggregates only each hook's own self-timed `Execute` duration. The hooks *stage* also does framing work — content extraction (`hook_extract_ms`), pipeline build (`hook_build_ms`), the whole-`Execute` wall-clock (`hook_pipeline_ms`, ≥ the per-hook sum; the gap is in-pipeline framework overhead), and Modify body rewrite (`hook_rewrite_ms`) — that `RequestHooksMs` never counted — and that, before these keys, was unattributed in `latency_breakdown` entirely (the hooks stage was the only stage with no phase key). Because `RequestHooksMs` covers only per-hook `Execute`, a hook whose cost scales with body size (e.g. a full-body PII scan over a large prompt) *would* register near-zero in `request_hooks_ms` while its real cost lands in the framing segments; these four keys make each segment attributable so that case is diagnosable. (Measured cost is workload-dependent — for small request bodies these segments are sub-millisecond.) `RequestHooksMs` semantics are unchanged (additive observability, no contract break).
- **`cache_lookup_ms` is a superset that spans the hooks stage.** The per-stage cursor advances via the next stage's `Mark()`, and the request-hooks stage records its sub-phases with `MarkBetween` (which does not advance the cursor). Consequently the cache stage's `Mark(cache_lookup_ms)` measures from the end of quota through the hooks stage *and* the cache lookup — i.e. `cache_lookup_ms` already contains the hooks-stage wall-clock (`hook_extract_ms + hook_build_ms + hook_pipeline_ms + hook_rewrite_ms`). This is pre-existing behaviour; the hook sub-phase keys are additive and do not change it. Analytics must therefore **not** sum all `*_ms` keys as if disjoint — the hook sub-phases are a drill-down *within* `cache_lookup_ms`, not siblings of it.
- Latency rounding lives in `proxy.go`'s defer **and** in `finalize()` because a handful of failure paths return before the defer can finish snapshot computation; both sites round identically.
- A `LatencyDetail` operator flag widens the snapshot to surface sub-ms phases as `1`, used during perf investigations. The default keeps prod rows compact.

The same `Writer` is shared by the ai-gateway proxy handler and by ai-guard's classify call — each classify emits a self-audit row tagged `InternalPurpose = "ai-guard"` so the admin UI can hide ai-guard rows from customer billing views by default.

`Record` carries every field that lands on `traffic_event` plus a handful of in-proc-only conveniences (per-hook `HooksPipeline` slice, `RequestTransformSpans` / `ResponseTransformSpans` for the storage-action pass, `RequestRedactRuleIDs` / `ResponseRedactRuleIDs` for the drop-content placeholder). The conversion to the wire envelope happens later, in `recordToMessage`, so the producer is free to keep richer in-proc types.

## 4. Writer — buffering, batching, retry, shutdown

The `Writer` (`audit.NewWriter`) owns the in-memory buffer and the background flush goroutine:

- `defaultBatchSize = 100`, `defaultFlushInterval = 5s`, `maxQueueSize = 10000`. Tunables are package constants, not yaml — there is one audit pipeline per process and operators do not configure it.
- `Enqueue` is **non-blocking**. When `len(buf) >= maxQueueSize` the record is dropped, a warning is logged with the `requestId`, and `nexus_audit_mq_dropped_total` is incremented. Dropping under sustained back-pressure is preferred over blocking the request path.
- Embedding rows are coerced inside `audit.Writer.Enqueue`. When `EndpointType == EndpointTypeEmbeddings`, `coerceEmbeddingRow` (`packages/ai-gateway/internal/platform/audit/coerce.go`) zeroes chat-only fields (`completion_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `reasoning_tokens`, `reasoning_cost_usd`) and emits a per-field warning naming the field, value, and request id. Every producer that publishes audit rows — proxy live response, proxy cache hits, and the ai-guard `WriterBackedTrafficSink` — emits through this single Enqueue path, so the coerce runs uniformly without each producer site re-implementing the rule.
- `flushLoop` ticks on `defaultFlushInterval`, snapshots the buffer under a mutex, marshals each record via `recordToMessage`, and calls `producer.Enqueue(ctx, queue, data)` with a per-record 5-second timeout.
- On a producer.Enqueue failure the record is **re-buffered** as long as space remains (`nexus_audit_mq_enqueue_errors_total` increments); if the buffer is at the cap the record is counted on `nexus_audit_mq_dropped_total` instead. There is no per-record back-off — the next flush tick is the retry.
- `Close()` drains the buffer through `drainBuffer` with a 15-second wall-time deadline and 200ms backoff between flush attempts. Records still in the buffer at the deadline are counted on `nexus_audit_mq_dropped_total` and logged so a sustained MQ outage at shutdown surfaces in monitoring instead of disappearing silently.
- `WithThingIdentity(id, name)` stamps `ThingID` / `ThingName` onto every envelope so the consumer can attribute the row to the emitting Thing instance (gateway pod, proxy pod, agent host). Identity is set once at startup before any flush runs.
- `WithSpillStore(store)` wires the out-of-band body backend; `WithPayloadCaptureStore(s)` wires the runtime cap snapshot so admin shadow updates take effect on the next flush without a restart; `WithNormalizer(fn)` wires the normalize closure that produces the `traffic_event_normalized` sidecar bytes.

`recordToMessage` is where the in-proc `Record` is reshaped into the wire envelope. It dispatches identity by VK type (personal → user, application → project, anything else → empty entity), derives the unified `CacheStatus` from the four detail fields via `DeriveCacheStatus` (unless the producer already set it), aggregates per-hook latency into `RequestHooksMs` / `ResponseHooksMs` if the proxy handler did not stamp them explicitly, and stamps `NormalizeVersion` to keep the persisted normalized blob versionable per row.

## 5. Storage actions — `applyStorageAction`

After `recordToMessage` produces the marshalled `NormalizedPayload` bytes for each direction, `applyStorageAction` rewrites them per the operator's `onMatch.storageAction` (the storage half of the two-axis PII policy — see `pii-redaction-policy-architecture.md`):

- `keep` / `""` / nil → no change. The raw normalized JSON lands on `traffic_event_normalized.request_normalized` or `.response_normalized` verbatim.
- `redact` → `normcore.ApplySpans(payload, spans)` is invoked with the same `TransformSpan` set the hook pipeline emitted, then the result is re-marshalled. Empty spans short-circuit and the raw bytes are kept.
- `drop-content` → the persisted blob is replaced with a minimal placeholder `{redacted: true, kind, normalizeVersion, protocol, ruleIds}`. The original normalized bytes never reach the wire.

Failures (unmarshal error, marshal error) fall back to the original bytes — the storage policy is observability, not a runtime gate. The runtime body forwarded upstream is governed independently by the hook pipeline's **inflight** axis; the two axes can diverge (e.g., redact upstream, drop-content in audit storage) and the resulting divergence is recorded via a standard `ReasonCode` on the audit row itself.

`applyStorageAction` runs only on the **normalized** sidecar bytes. The raw captured bytes on `traffic_event_payload.inline_request_body` / `inline_response_body` are NOT rewritten by this function — they are bounded only by the payload-capture cap (§7) and are subject to the same null-byte stripping the consumer applies to every text field before insert.

A skip exists for the response direction when the effective passthrough config has `bypassNormalize=true`: the request-side normalize still runs (it happens before passthrough is resolved, and the result helps incident triage), but the response-side normalize emission is suppressed so the audit row faithfully reflects "we did not normalize the response on this row".

## 6. MQ wire envelope — `TrafficEventMessage`

`TrafficEventMessage` is the canonical wire shape for traffic events on MQ. All three producers (ai-gateway, compliance-proxy, agent-via-Hub) serialize into the same struct; the consumer-side struct in `packages/nexus-hub/internal/observability/consumer/message.go` mirrors it field-for-field but uses pointer types for every nullable DB column so absent JSON fields land as SQL `NULL` instead of zero values.

Notable wire decisions:

- `LatencyMs` is intentionally emitted **without** `omitempty` because the consumer stores it as `*int` and the wire-side `omitempty` had silently masked sub-millisecond cache hits (the producer truncated `time.Since().Milliseconds()` to 0 and the marshaller dropped the field). The producer now clamps real measurements to `≥1`; a `0` on the wire unambiguously means "not measured".
- `Identity` is a free-form JSONB object with a closed schema: `{vk, user, project, apiCredential, status}`. `status="matched"` when at least one of `user` / `project` resolved at request time; `status="pending"` when no owner could be attached, so the Hub `IdentityEnricher` background job picks the row up later via `DeviceAssignment.ip_address`.
- `EntityType` / `EntityID` / `EntityName` are top-level **denormalized** copies of the matched owner, dispatched by VK type so the indexed `entity_id` column carries a real foreign key (`NexusUser.id` for personal VKs, `Project.id` for application VKs, empty for unclassified callers). These power the per-user / per-project breakdown filters without a JSONB extract.
- `CacheStatus` carries the **unified rollup** (`HIT` | `MISS`) that filter UIs bind to. The four detail fields `GatewayCacheStatus`, `GatewayCacheSkipReason`, `GatewayCacheKind`, `ProviderCacheStatus` are drill-down only and feed the three audit-drawer layouts in `cost-estimation-architecture.md` §6.4. Derivation is centralized in `DeriveCacheStatus` so all stamping sites agree.
- `RequestBody` and `ResponseBody` are discriminated `audit.Body` containers (`{kind: absent|inline|spill, ...}`). The consumer demuxes onto `traffic_event_payload.inline_*_body` (JSONB) **or** `*_spill_ref` (JSONB pointer `{backend, key, size, sha256, contentType}`); exactly one is populated per direction, both `absent` means capture was off for that scope.
- `RequestNormalized` / `ResponseNormalized` ride as `json.RawMessage` so the wire stays schema-stable across normalize schema bumps. `NormalizeVersion` is stamped on the envelope when at least one direction was normalized.
- `PassthroughFlags` and `PassthroughReason` are populated only when an emergency-passthrough tier matched; absent fields keep the wire compact for the >99% of traffic where no bypass fired.
- `ThingID` / `ThingName` identify the emitting instance per source: originating agent device, gateway pod, or proxy pod.
- **Each hook stage records its own reason / reason_code / blocking_rule.** The dual hook pipeline maps to two disjoint column sets: the request stage stamps `RequestHookDecision` / `RequestHookReason` / `RequestHookReasonCode` / `RequestBlockingRule`; the response stage stamps `ResponseHookDecision` / `ResponseHookReason` / `ResponseHookReasonCode` / `ResponseBlockingRule`. All six reason/reason_code fields and both blocking-rule columns are the **authoritative typed columns** the Hub consumer reads — they are not recovered from the `Details` JSONB (the JSONB copy of the response reason/code is additive drill-down only). `recordToMessage` carries a single in-proc `rec.BlockingRule` (the proxy overloads it across stages — the request hook sets it pre-upstream, every response hook path sets it post-upstream), so the writer disambiguates by stage: a blocking response decision (`REJECT_HARD` or `BLOCK_SOFT`, via `isBlockingDecision`) attributes the rule to `ResponseBlockingRule`; otherwise it is a request-stage block routed to `RequestBlockingRule`. The response stage runs only after the request stage approved, so the two are mutually exclusive and a response-stage block never pollutes the request column.

`AdminAuditMessage` (admin-mutation envelope) lives in the same file but on a different queue (`nexus.event.admin-audit`); it is detailed in `admin-audit-log-coverage.md`.

## 7. Stream + queue topology

`EnsureStreams` creates two JetStream streams idempotently at Hub startup, both with `FileStorage` and `DiscardOld`:

- **`NEXUS_EVENTS`** — subject pattern `nexus.event.>`, `MaxAge = 6h`, `MaxBytes = 8 GiB`, `Retention = InterestPolicy`. Holds every audit envelope from every producer. InterestPolicy means messages stay on disk until **every** registered consumer group has acked, which is what enables the `hub-db-writer` + `hub-alerting` fan-out: each group's progress is tracked independently and neither can mask the other's lag. The 6h `MaxAge` is the hard escape valve — with healthy drainage, events older than 6h are already persisted to `traffic_event`, so capping the stream at 6h means a wedged consumer auto-recovers faster once the wedge is fixed instead of pinning the stream past the rollover threshold.
- **`NEXUS_AUTH`** — subject pattern `nexus.auth.>`, `MaxAge = 24h`, `MaxBytes = 256 MiB`. Carries auth-plane coordination events (token revocation today). Not part of the audit pipeline.

Three subjects ride `NEXUS_EVENTS` for traffic events:

| Subject | Producer | `source` field on row |
|--|--|--|
| `nexus.event.ai-traffic` | ai-gateway (`audit.NewWriter`) | `ai-gateway` |
| `nexus.event.compliance` | compliance-proxy | `compliance-proxy` |
| `nexus.event.agent` | Hub (after HTTP upload from agent) | `agent` |

A fourth subject `nexus.event.admin-audit` rides the same stream for admin-mutation events; it is consumed by a different writer (see `admin-audit-log-coverage.md`).

## 8. Consumer side — `TrafficEventWriter`

`TrafficEventWriter` spawns one goroutine per queue under the consumer group `hub-db-writer`. Each goroutine wraps an MQ consume loop around a `BatchAccumulator[pendingTrafficMessage]` configured for `BatchSize = 100` and `FlushInterval = 5s` by default.

The per-message handler `handleMessage`:

1. Increments `nexus_mq_processed_total{queue}`.
2. JSON-unmarshals into the consumer-side `TrafficEventMessage`. **Deserialize failure → `Ack()` immediately and drop**, on the principle that a malformed message will fail forever and would otherwise block the consumer. The error is logged and `nexus_mq_traffic_errors_total{error_type="deserialize"}` increments — the log is the audit trail.
3. On successful unmarshal, calls `batch.Add(...)` and returns `mq.ErrDeferAck`, handing ack/nak responsibility to the batch-flush path. The batch flushes on size (100) **or** interval (5s), whichever comes first.

The `flush` path first attempts the whole batch in a single Postgres transaction (`flushBatch`):

1. `pool.Begin(ctx)`. Failure → wrapped error returned to `flush`, `nexus_mq_batch_flush_total{result="error"}`, `nexus_mq_traffic_errors_total{error_type="db_begin"}`.
2. `insertTrafficEvents` — one `pgx.Batch` of parameterized INSERTs against `traffic_event` with `ON CONFLICT (id) DO NOTHING`. The wide INSERT covers the full column list; **every** text and JSON field is passed through `stripNul` / `stripNulPtr` / `stripNulJSON` first because providers like ChatGPT can include null bytes in SSE responses, and PostgreSQL rejects them (`SQLSTATE 22021` for a raw `\x00` byte in a text column, `22P05` for a `\u0000` escape in a jsonb column). `internal_ops_breakdown` was once the lone JSON column bound without `stripNulJSON` — a poisoned breakdown then aborted the whole batch and the poison-pill path acked + dropped up to 100 events permanently (audit defect F-0179); it is now stripped like every sibling. `compliance_tags` (a `NOT NULL` `text[]` column) is coerced to an empty slice when absent.
3. `insertPayloads` — same batch shape against `traffic_event_payload`. Demuxes the discriminated `Body` container onto either `inline_*_body` (the full marshalled `Body` envelope as JSONB, so non-JSON streaming SSE bytes can ride base64-encoded inside `inlineBytes`) **or** `*_spill_ref`. Skips events where both directions are `absent`.
4. `insertNormalizedPayloads` — writes the `traffic_event_normalized` rows inside a **savepoint** (a pgx nested transaction). This is what makes "**failure here does NOT roll the batch**" actually true: a sidecar failure aborts only the savepoint, and `ROLLBACK TO SAVEPOINT` restores the outer transaction to a committable state, so the raw `traffic_event` + `traffic_event_payload` rows survive. (A single `pgx.Batch` on the *outer* tx — the previous implementation — instead aborted the whole tx, so `tx.Commit` failed and `nakOrDLQ` rolled the entire batch of raw billing/audit rows; this was audit defect F-0178.) The fast path pipelines all sidecar rows in one batch under one savepoint; on any batch error the savepoint is rolled back and the sidecar is retried **row-by-row**, each in its own savepoint, so a single poison row — a jsonb `SQLSTATE 22P05` (untranslatable_character) from a `\u0000` escape, or `22021` from a raw NUL byte — is **skipped** (`nexus_mq_traffic_errors_total{error_type="db_insert_normalized_poison"}`) without stranding the rest of the batch. A non-poison sidecar error is logged + counted (`nexus_mq_traffic_errors_total{error_type="db_insert_normalized"}`) but still does not roll the raw rows.
5. `tx.Commit`. Failure → wrapped error returned, error counters.
6. `ackAll`. Success counters fire.

When the batched fast path fails as a unit (any of steps 1–5 returns an error), `flush` falls back to **per-item reprocessing**: each message is re-run in its own transaction via `flushItem`. A single poison/oversize row therefore no longer drops up to 99 healthy siblings — the healthy rows commit and ack individually, and only the offending row is isolated (audit defect F-0180). Per-item failure handling has one special case: a permanent NUL/encoding error — `SQLSTATE 22021` (`invalid_character_value_for_cast`, raw NUL byte) or `22P05` (`untranslatable_character`, jsonb NUL escape) — can never succeed on retry, so that **one row** is acked to skip (`nexus_mq_traffic_errors_total{error_type="db_insert_poison"}`) with a warn-level log; every other error triggers `nakOrDLQ` for redelivery (see §10.1). The poison SQLSTATE is read from the **typed** `*pgconn.PgError.Code` via `errors.As`, not by substring-matching the error text, so a payload that merely contains `"22021"` cannot false-trigger a skip and a differently-wrapped real 22021 is still caught. `flush` itself returns `nil` because every item is fully resolved by one of the two paths.

## 9. Payload-capture cap

What lands on `traffic_event_payload` is bounded by `payloadcapture.Config`:

- `MaxRequestBytes` / `MaxResponseBytes` — network read caps. The gateway's `readBody` reads up to `MaxRequestBytes + 1` and returns `errRequestTooLarge` (→ HTTP 413) when the inbound body exceeds the cap. Defaults are 10 MiB each.
- `MaxInlineBodyBytes` — the **inline-vs-spill cutoff** the audit writer applies at flush time. Bodies whose captured size is `≤ MaxInlineBodyBytes` ride inline on `inline_*_body`; larger bodies are written to the spill backend via `spillstore.EmitBody` and the row keeps a `*_spill_ref`. Default 256 KiB.
- `StoreRequestBody` / `StoreResponseBody` — master capture flags, default `false`. When `false`, the producer never populates `Record.RequestBody` / `Record.ResponseBody` at all, so `traffic_event_payload` is not written for that row (both bodies are `absent`).

The config is a runtime snapshot store (`payloadcapture.Store`), wired into the audit Writer via `WithPayloadCaptureStore`. `recordToMessage` pulls the current threshold on **every** record, so admin-driven shadow updates take effect on the next flush without a service restart.

Bodies that hit the inline cap can still be truncated below the network cap when the producer captures a streaming response chunk-by-chunk; the `Truncated` flag on the `Body` envelope rides through onto `traffic_event_payload.request_truncated` / `response_truncated` so consumers know the persisted copy is not byte-complete.

## 10. Back-pressure, retry, and the consumer manager

Two consumer groups attach to the `NEXUS_EVENTS` stream:

- `hub-db-writer` (this doc) — `TrafficEventWriter` (three goroutines, one per traffic queue, batched insert), `AdminAuditWriter` (`nexus.event.admin-audit`), and `ExemptionConsumer` (`nexus.event.exemption`), all in the one group.
- `hub-alerting` (`alerting-architecture.md`) — subscribes to the traffic + admin-audit queues, maintains in-memory ring buffers, and evaluates threshold rules; runs as a scheduler engine, not under `consumer.Manager`.

The `consumer.Manager` orchestrates the `hub-db-writer` group's consumers under a single lifecycle. It runs each consumer in its own goroutine, sets `nexus_consumer_healthy{consumer=<name>} = 1` on start and `0` on exit, captures per-consumer errors in a map, and exposes `HealthCheck()` for readiness probes. The SIEM bridge is **not** an MQ consumer group — it polls the persisted `traffic_event` and `AdminAuditLog` tables on a schedule (`siem-bridge-architecture.md`).

Producer-side back-pressure:

- The in-memory buffer absorbs short bursts (10000 records).
- A sustained MQ outage drains the buffer to `maxQueueSize`, after which records are dropped and counted on `nexus_audit_mq_dropped_total`. The request itself is **never** blocked on audit.
- `Close()` retries draining for 15 seconds before counting the remainder as dropped, so a graceful rollout window cleanly flushes pending audit; a kill-9 path drops whatever is still in memory.

Consumer-side back-pressure:

- JetStream's `InterestPolicy` retains messages until every consumer group acks; a **stalled** `hub-db-writer` (one not pulling, or pulling and never acking) does not lose data — messages accumulate on disk up to `MaxBytes = 8 GiB` or `MaxAge = 6h`, whichever comes first. This `MaxAge` window protects an *undelivered* backlog; it does **not** grant a grace period to a message that has exhausted its `MaxDeliver` (5) redelivery budget — JetStream removes such a message for the consumer the instant the cap is hit, regardless of `MaxAge`. That is why the writer dead-letters *before* the final delivery (see §10.1).
- `DiscardOld` ensures a wedged consumer cannot push the stream into "insufficient_resources" publish errors — once the cap is hit, the oldest unacked messages are evicted so producers keep writing.
- DB-side errors split two ways: poison-pill (`22021`) is acked-and-skipped so the queue keeps flowing; every other error routes through `nakOrDLQ` (see §10.1 for the per-message redelivery backoff + dead-letter queue).

### 10.1 Dead-letter queue

`nakOrDLQ` inspects each `mq.Message.NumDelivered` (populated from the NATS metadata at `packages/shared/transport/mq/consumer.go`) and routes each item independently:

- `NumDelivered < redeliveryThresholdAttempts` (default **3**) → `NakWithDelay` with a graduated backoff (`redeliveryDelay`: 15s × attempt, capped at 2m). A *bare* Nak re-delivers as fast as the broker can, which burns the entire `MaxDeliver = 5` budget in ~25-30s (it bypasses the 30s `AckWait`); the backoff makes the budget span a multi-minute outage so a DB failover recovers normally instead of exhausting deliveries.
- `NumDelivered ≥ redeliveryThresholdAttempts` → **dead-letter**, then Ack. The threshold is deliberately set **strictly below** `MaxDeliver` so this fires on a *non-final* delivery while budget remains — if the dead-letter path itself fails, there are still deliveries left to retry on. (Audit defect F-0177: the previous value, 5, equalled `MaxDeliver`, so the DLQ was only ever attempted on the final delivery; a DB-outage DLQ failure then had no budget left and the row was Nak'd into immediate purge.)

Dead-lettering uses two sinks, in order:

1. **DB-backed** `traffic_event_dlq` (`tools/db-migrate/schema/traffic.prisma` model `traffic_event_dlq`: `msg_id`, `subject`, `payload`, `delivery_count`, `last_error`, `first_seen_at`, `dlq_inserted_at`). Preferred — surfaces in the admin DLQ UI for inspect/retry.
2. **On-disk** JSON-Lines DLQ — used **only** when (1) fails, i.e. the DB is unreachable. This is the durability guarantee for a full DB outage: the raw billing/audit bytes are appended to `<TMPDIR>/nexus-hub-dlq/traffic-event-dlq.jsonl` (one JSON object per line: `msgId`, `subject`, `payload` (base64), `deliveryCount`, `lastError`, `writtenAt`) so they are never silently dropped at the redelivery cap. **Replay**: once the DB recovers, an operator imports each line into `traffic_event_dlq` (the record shape maps 1:1 to the table columns) and uses the existing `POST /api/hub/dlq/:id/retry` to republish; the file is then rotated/truncated. Counter: `nexus_mq_disk_dlq_inserted_total{subject}`.

If **both** sinks fail (DB down *and* the disk write errors), the message falls back to `NakWithDelay` so the broker re-attempts — the on-disk write gets another chance on redelivery rather than dropping a message we have no record of. Because the threshold sits below `MaxDeliver`, there is still delivery budget left for that retry.

Admin surface for inspection + retry:

- Hub: `GET /api/hub/dlq` (offset-paginated list, newest first, optional `subject` filter + `limit` / `offset`; returns `{rows,total}`) + `POST /api/hub/dlq/:id/retry` (republish + delete on success). Handler: `packages/nexus-hub/internal/fleet/handler/hubapi/hub_api_dlq.go`.
- Control Plane: `GET /api/admin/observability/dlq` + `POST /api/admin/observability/dlq/:id/retry`, proxying to Hub with JWT + IAM check + AdminAuditLog stamp. Handler: `packages/control-plane/internal/observability/dlq/handler/dlq.go`. IAM: `admin:observability-dlq.read` (list) / `admin:observability-dlq.manage` (retry).
- UI: `/infrastructure/dlq` page at `packages/control-plane-ui/src/pages/infrastructure/dlq/InfraDlqPage.tsx`.

Counter: `nexus_mq_dlq_inserted_total{subject}` records the DLQ insertion rate per MQ subject.

### 10.2 Normalize backfill

`insertNormalizedPayloads` partial failure (step 4 above) is logged but does NOT roll the transaction — the per-row savepoint isolates the sidecar failure, so the raw rows still commit on `traffic_event` + `traffic_event_payload`, but the `traffic_event_normalized` sidecar is left missing or NULL. A periodic job heals these gaps:

- `packages/nexus-hub/internal/jobs/defs/audit/normalize_backfill.go` (default 5-minute interval) — LEFT-JOIN scan of `traffic_event` against `traffic_event_normalized`; for each candidate row with inline bodies in `traffic_event_payload`, calls the injected `NormalizeRegistry.Normalize(...)` and upserts the sidecar. Wire-up at `packages/nexus-hub/cmd/nexus-hub/wiring/jobs.go` constructs the registry once via `shared/transport/normalize.BuildRegistry()` and passes it in.
- **Version-aware re-normalization**: a row is a candidate when its sidecar is missing, all-NULL, **or stamped with a `normalize_version` other than the current `normcore.SchemaVersion`**. Bumping `SchemaVersion` therefore heals every historical row through this one mechanism — no data migration. Healing throughput is `normalizeBackfillBatchSize` (200) rows per tick (default 5 min) ≈ 57,600 rows/day, newest-first; the four `nexus_normalize_backfill_*` counters below are the progress signal. The remaining backlog is the count of `traffic_event` rows whose sidecar is missing or whose `normalize_version` differs from the current schema version; divide by the daily rate for the heal ETA. A direction whose re-normalize fails keeps its older payload AND its older status (the upsert overwrites status only together with a new payload); each payload's inner `normalizeVersion` field stays the authoritative per-direction stamp.
- **Audit posture**: the raw captured bytes (`traffic_event_payload` columns + spill objects) are the immutable audit record and are never touched by re-normalization; `traffic_event_normalized` is a recomputable derived projection, and rewriting it is how the projection stays honest as decoders improve.
- **Spill-path coverage**: the compliance-proxy normalizes spill-destined bodies live — the emitter retains the in-memory bytes on the spilled Body container (wire form keeps only the ref), so the flush-time normalize pass sees the content without a fetch. Retention is opt-in (`WithPreSpillNormalize`, set only by a writer that runs a flush-time normalizer — the proxy, not the agent) and bounded per body (2 MiB); a larger spilled body or the agent path stays ref-only and is healed by the backfill spill-fetch off the hot path. Together the opt-in + per-body cap bound queued memory so MQ backpressure cannot pin gigabytes of audit bodies. For rows that still arrive ref-only (agent uploads), the backfill fetches the spill object via the hub's SpillStore (bounded at 64 MiB); a failed fetch skip-marks `spill_fetch_failed`, no spill store wired skip-marks `spill_ref_only`. Skip marks are version-stamped: a skip recorded at schema version N re-admits exactly once at version N+1, which keeps the "version bump heals every historical row" invariant true for previously unfillable rows too.
- Counters: `nexus_normalize_backfill_scanned_total`, `nexus_normalize_backfill_filled_total`, `nexus_normalize_backfill_skipped_total{reason}`, `nexus_normalize_backfill_errors_total{phase}`.

## 11. Agent path is HTTP-then-MQ, not direct MQ

The agent is the only data-plane service that does not publish to MQ directly. Each enrolled host POSTs a batch of `AgentAuditEvent` records to `POST /api/internal/things/agent-audit` over its mTLS Thing channel. The Hub handler `UploadAgentAudit` parses the batch, stamps the **only authoritative identity it can prove — the mTLS-authenticated `ThingID`** — envelopes each event into the same `TrafficEventMessage` shape, and publishes to `nexus.event.agent`. From that point the consumer path is identical to the other two sources.

**Attribution on the agent path is server-controlled, never node-asserted (SEC-C5-01).** The per-VK / per-org / per-user attribution columns (`entityType` / `entityId` / `entityName` / `orgId` / `orgName` / `identity` / `apiKeyFingerprint`) are stamped **empty** by `UploadAgentAudit` and are deliberately not decoded from the agent payload — any enrolled agent is the lowest-trust credential, so trusting its self-asserted attribution would let a rogue node attribute its traffic to (and frame in analytics / SIEM) a victim VK or org. Only `thing_id` is authoritative here; the real owning user / org for agent traffic is resolved **downstream** by joining `thing_id → DeviceAssignment → user → org` (the server-side mapping the node cannot forge), not from anything the node sends. This contrasts with the ai-gateway path, where `entity_id` is server-derived from the matched VK owner at record time (see `recordToMessage`, above) and is therefore authoritative inline.

The agent-specific shape differences (the agent measures upstream TTFB and total because it is a transparent forwarder; it does not have a routing rule; its `source` field is `agent`) are flattened into the same envelope columns. Cross-source stitching uses `TraceID` — the agent stamps the `X-Nexus-Request-Id` it sees on the upstream connection, the compliance proxy and gateway propagate it on their forward leg, and all three rows share the trace value at query time. See `otel-tracing-architecture.md` for the full chain.

## 12. Observability of the audit pipeline itself

Producer side (each data-plane service exposes these on its own `/metrics`):

| Metric | Labels | Meaning |
|--|--|--|
| `nexus_audit_mq_enqueue_total` | — | Records successfully handed to MQ producer |
| `nexus_audit_mq_enqueue_errors_total` | — | Producer.Enqueue failures (re-buffered or dropped) |
| `nexus_audit_mq_dropped_total` | — | Records dropped (queue full at enqueue time, or buffer full on re-buffer after a producer failure, or drained-past-deadline at shutdown) |

Consumer side (Hub `/metrics`):

| Metric | Labels | Meaning |
|--|--|--|
| `nexus_mq_processed_total` | `queue` | Messages received from each queue |
| `nexus_mq_batch_flush_total` | `result` (`success` \| `error`) | Per-batch DB commit outcome |
| `nexus_mq_batch_size` | — | Histogram of batch sizes at flush |
| `nexus_mq_traffic_errors_total` | `error_type` (`deserialize` \| `db_begin` \| `db_insert` \| `db_insert_payload` \| `db_insert_normalized` \| `db_insert_normalized_poison` \| `db_commit` \| `dlq_insert` \| `disk_dlq`) | Per-failure-class breakdown. `db_insert_normalized_poison` = a sidecar row skipped on a `22P05`/`22021` null-character error; `dlq_insert` / `disk_dlq` = a DB-backed / on-disk dead-letter write failed |
| `nexus_mq_dlq_inserted_total` | `subject` | Messages moved to the DB-backed `traffic_event_dlq` at the redelivery cap |
| `nexus_mq_disk_dlq_inserted_total` | `subject` | Messages written to the on-disk DLQ because the DB-backed insert failed (DB outage) |
| `nexus_consumer_healthy` | `consumer` | 1 while the named consumer goroutine is running, 0 on exit |

Counter names carry the `nexus_` namespace because the Hub-side opsmetrics registry pins it at construction (`packages/shared/core/metrics/registry/registry.go`). Promoting one of these series requires only the namespaced name; the registered short form (`mq.processed_total`, etc.) is an implementation detail of the Go API.

The cardinality on `nexus_mq_processed_total{queue}` is exactly three (the traffic queues); pair it with `nexus_mq_traffic_errors_total{error_type="deserialize"}` to detect a producer-side schema bug, and with `nexus_consumer_healthy{consumer="traffic-event-writer"}` to detect a writer outage.

## 13. Known limitations

**Per-attempt credential detail (F-0360).** `traffic_event.credential_id` records the credential used for the **final/successful** upstream attempt. When the AI Gateway's execution retry loop exhausts one credential and falls over to another, the earlier attempts — including which credential was tried, on which attempt number, and what error code caused the fall-through — are not persisted on the row. This detail is visible only in the credential-stats buffer (`credstats`) during the request window, not in the audit row that survives long-term. Consequence: post-hoc forensics for multi-credential retry sequences cannot reconstruct the full attempt chain from `traffic_event` alone. The fix (adding a `credentialAttempts JSONB` column to `TrafficEvent` and populating it from the retry loop) requires a schema migration and smoke-run validation; it is deferred pending explicit priority from the roadmap.

## 14. Failure modes and where they surface

| Symptom | Where it shows up | Recovery |
|--|--|--|
| Producer-side burst overload | `nexus_audit_mq_dropped_total` climbs on the source service | None — drops are accepted to preserve the request path; investigate the back-pressure source (MQ outage? consumer wedge?) |
| Sustained MQ outage | `nexus_audit_mq_enqueue_errors_total` climbs; eventually `nexus_audit_mq_dropped_total` rises | Restart NATS; flush will retry on next tick. `Close()` deadline drops whatever is in-memory at shutdown |
| Consumer wedge | `nexus_mq_processed_total{queue}` flat while producer counters rise; eventually JetStream `MaxAge` / `MaxBytes` discards messages | Investigate `nexus_consumer_healthy{consumer="traffic-event-writer"}`; restart Hub; backfilled rows are lost past the discard window |
| DB write failure (transient) | `nexus_mq_batch_flush_total{result="error"}` + `nexus_mq_traffic_errors_total{error_type=db_*}`; messages naked with backoff → redelivered (DB-backed DLQ at `redeliveryThresholdAttempts`, or on-disk DLQ if the DB is still down) | Self-heals once the DB recovers; investigate `nexus_mq_dlq_inserted_total{subject}` for repeat offenders, and `nexus_mq_disk_dlq_inserted_total{subject}` for rows that fell through to disk during a full DB outage (replay per §10.1) |
| DB write failure (poison-pill, null bytes) | `nexus_mq_batch_flush_total{result="error"}` once per affected batch; warn-level "permanent encoding error, acking to skip poison batch" log | None needed — the batch is dropped and the next batch proceeds. The producer-side `stripNul` plumbing prevents this almost everywhere; a leak is a producer-side bug |
| Normalize sidecar regression | `nexus_mq_traffic_errors_total{error_type="db_insert_normalized"}` climbs; raw rows still land on `traffic_event` and `traffic_event_payload`; the normalize-backfill job heals them on its next tick | Investigate `traffic_event_normalized` schema drift; `nexus_normalize_backfill_filled_total` confirms recovery |

## References

- `packages/ai-gateway/internal/platform/audit/audit.go`
- `packages/ai-gateway/internal/ingress/proxy/proxy.go`
- `packages/ai-gateway/cmd/ai-gateway/wiring/aiguard.go`
- `packages/ai-gateway/cmd/ai-gateway/wiring/observability.go`
- `packages/compliance-proxy/cmd/compliance-proxy/wiring/audit.go`
- `packages/compliance-proxy/internal/audit/`
- `packages/nexus-hub/cmd/nexus-hub/wiring/jobs.go`
- `packages/nexus-hub/internal/observability/consumer/traffic.go` (+ `traffic_inserts.go`, `traffic_normalized.go`, `traffic_dlq.go`, `traffic_nul.go`)
- `packages/nexus-hub/internal/observability/consumer/message.go`
- `packages/nexus-hub/internal/observability/consumer/batch.go`
- `packages/nexus-hub/internal/observability/consumer/manager.go`
- `packages/nexus-hub/internal/observability/consumer/siem.go`
- `packages/nexus-hub/internal/traffic/ingest/audit/agent_audit.go`
- `packages/shared/transport/mq/messages.go`
- `packages/shared/transport/mq/streams.go`
- `packages/shared/policy/payloadcapture/config.go`
- `packages/shared/policy/payloadcapture/store.go`
- `packages/shared/storage/spillstore/`
- `packages/shared/transport/normalize/core/`
- `tools/db-migrate/schema/traffic.prisma` — `traffic_event`, `traffic_event_payload`, `traffic_event_normalized`
- `docs/developers/architecture/cross-cutting/safety/pii-redaction-policy-architecture.md`
- `docs/developers/architecture/cross-cutting/observability/admin-audit-log-coverage.md`
- `docs/developers/architecture/cross-cutting/observability/siem-bridge-architecture.md`
- `docs/developers/architecture/cross-cutting/observability/otel-tracing-architecture.md`
- `docs/developers/architecture/cross-cutting/observability/prometheus-naming-architecture.md`
- `docs/developers/architecture/services/ai-gateway/cost-estimation-architecture.md`
- `docs/developers/architecture/cross-cutting/storage/spillstore-architecture.md`
