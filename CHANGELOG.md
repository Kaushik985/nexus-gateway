# Changelog

All notable changes to this project will be documented in this file. Format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
repo uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once a
1.0 line is cut.

## [Unreleased]

## [1.0.0] — 2026-06-14

First general-availability release. All three intercept planes (AI Gateway,
Compliance Proxy, Desktop Agent) and the full architecture — Hub Thing/shadow
model, control plane + UI, compliance/audit pipeline, provider-adapter
framework — are production-complete. macOS + Linux desktop agents are **GA**
(Windows experimental). Post-1.0 work is predominantly additive: new provider
adapters and broader spec coverage.

### Added
- **Desktop Agent AI-chat capture (macOS + Linux GA).** End-to-end interception
  + structured normalization of AI-chat traffic — codex (OpenAI Responses on
  chatgpt.com), Cursor (app + cursor-agent CLI via `/agent.v1.AgentService/Run`),
  and browser web-chat — captured into the audit / `traffic_event` pipeline
  without breaking the tools. macOS uses the `NETransparentProxyProvider`
  system extension (sole intercept path).
- Cursor connect-RPC decoder: per-frame gzip-decompressed agent-service frames
  decode embedded OpenAI-compat / Lexical JSON into structured conversation +
  model + readable tool calls.
- AI vibe-coding documentation surface: `docs/developers/workflow/ai-workflow.md` describing
  the SDD pipeline, binding-rule structure, self-audit gates, and parallel-
  session safety protocol; `docs/developers/workflow/ai-skill-catalog.md` describing the
  `.claude/skills/` library and how forks can adapt prod-coupled skills.
- Two new binding lints with HARD pre-commit + strict CI gates:
  `check-no-prod-todos.mjs` (forbids TODO / FIXME / XXX / HACK / panic-
  placeholders in production Go), `check-no-yaml-secrets.mjs` (forbids
  inline secret values in committed yaml).
- Reverse-grep detection in `check-no-redis-pubsub.mjs` for re-import of
  the deleted pre-Hub packages (`shared/heartbeat`, `internal/pubsub`,
  `internal_registry`).
- `.github/ISSUE_TEMPLATE/` (bug / feature / docs / ai-workflow) and
  `.github/CODEOWNERS` for reviewer routing.

### Changed
- `useapi-querykey` and `no-redis-pubsub` lints ratcheted from warn-only
  to HARD pre-commit + strict CI now that all prior violations are clean.
- `MQBatchWriter.Flush()` (`packages/compliance-proxy/internal/audit/`) now
  coordinates with the writer's loop goroutine so the Writer-interface
  promise ("writes all pending events immediately") holds end-to-end. The
  prior implementation only drained the channel, missing events the loop
  had moved into its private buffer — flake reproducer fixed.
- **Streaming policy follow-up — admin-observable refinements (PR #24 review).**
  - New Prometheus counter
    `nexus_prehook_normalize_drop_total{adapter}` fires when the
    response pre-hook's `Registry.Normalize` returns a non-panic error
    (tier hard-fail, ErrUnsupported). Disjoint from the existing
    `nexus_normalize_panic_total{location="registry"}` (the drop counter
    explicitly skips the bump when the err is the panic-recovery
    sentinel) — admins can sum the two for total prehook normalize
    failures without double-counting. Without this counter the silent-
    drop path was invisible; admin Modify hooks were silently
    operating on the flat-text fallback.
  - ai-gateway now propagates the admin-configured
    `streaming_compliance.config.max_buffer_bytes` (default 64MB) into
    both buffer and live pipelines. Previously the value was honored
    by tlsbump callers but silently capped at the pipeline's built-in
    8MB default in ai-gateway. Operators running large-context models
    will see fewer "stream buffer exceeded" rejections after this
    fix.
  - Streaming wedge prevention: when a writer error, MaxBufferSize
    overflow, or compliance `RejectHard` decision fires while the
    upstream reader is blocked inside a slow / silent `Read`,
    `LivePipeline.Process` now closes the upstream connection
    synchronously so the reader goroutine unblocks and `Process`
    returns promptly. Without this the goroutine could wedge for
    the full upstream response duration (or the caller's outer
    `defer Close()` lifetime). Pinned by `TestLivePipeline_
    WriterError_ClosesUpstream` + `TestLivePipeline_RejectHard_
    ClosesUpstream` in both shared and ai-gateway packages.
  - Unknown / future streaming-mode enum values now fall back to
    `passthrough` on all three data planes. Previously ai-gateway's
    default arm engaged `chunked_async` (running hooks); the change
    aligns with tlsbump's existing `resolveStreamingMode` default and
    prevents admin typos from silently engaging compliance hooks
    against opted-out traffic. Pinned by
    `TestDispatchStreamMode_UnknownEnumFallsBackToPassthrough`.

- **Streaming policy three-service alignment (#115).** Removed the YAML
  `streamingMode` fallback path from `shared/transport/tlsbump`. All three
  data planes (ai-gateway, compliance-proxy, agent) now load their
  streaming-policy snapshot from the Hub-pushed `streaming_compliance.config`
  shadow via `shared/transport/streaming/policy.BootStore` + the
  configdispatch shadow handler. The legacy `WithStreamingPolicyGlobal`
  constructor was deleted; callers must wire `WithStreamingPolicyStore`.
  - **Behavior change worth flagging during upgrade:** if the
    `streaming_compliance.config` system_metadata row is missing or
    unreadable at boot (rare — only seen during DB-race windows on the
    first boot after a fresh CP deploy), the data plane now resolves to
    `DefaultPolicy()` = `passthrough` rather than reading whatever was
    previously hard-coded in YAML (`live`). Operationally identical for
    99% of installs (the row lands within a few seconds of CP boot), but
    operators running a tight readiness-probe window may observe
    passthrough briefly before the shadow snapshot lands. Once the
    snapshot arrives the configured mode (passthrough / buffer_full_block
    / chunked_async) takes over without restart.
  - ai-gateway now honors `passthrough` mode (`runPassthroughStream` in
    `proxy_cache.go`) — previously it collapsed into the live path,
    silently running hooks on traffic the admin had opted out of.
  - `buffer_full_block` mode in any data plane now emits
    `nexus_streaming_modify_degraded_total{reason="buffer_mode"}` and
    surfaces a `warnings[]` field on
    `/api/admin/settings/streaming-compliance` when a hook returns
    Modify under that mode (the original body is replayed unchanged —
    Modify is not supported in buffer mode). Admins switching to
    `buffer_full_block` see the constraint in the Control Plane UI
    callout before saving.

### Fixed
- **traffic_event requested-vs-routed model/provider semantics.** The
  REQUESTED columns now mean what the client asked for: `model_id` /
  `provider_id` / `provider_name` are populated only when the client requested
  a specific model that resolved unambiguously to one catalog model, and are
  NULL for `model="auto"` / multi-provider codes / OpenAI-style requests that
  don't pin a provider (previously `provider_id` wrongly carried the routed
  primary and `model_id` was never written). The ROUTED columns
  (`routed_provider_id` / `routed_model_id` / …) carry the actually-served
  target, and all usage / cost / analytics / rollups / list filters attribute
  by the routed side. **Semantic note for direct `traffic_event` consumers:**
  if you read `provider_id` / `model_id` as "what served", switch to the
  `routed_*` columns.
- **Connect-RPC envelope flags** (`shared/transport/streaming`): bit `0x01` is
  per-message gzip-compression and `0x02` is end-of-stream — the reader had
  conflated them, stopping after the first compressed frame and feeding
  still-compressed bytes to the protobuf parser. Now decodes per-frame gzip
  correctly (fixes Cursor `/agent.v1.AgentService/Run` capture).
- **Interception precision**: cursor host interception is now chat-only —
  `*.cursor.sh` passes through by default and captures only the chat-bearing
  paths (`/agent.v1.AgentService/Run`, `/aiserver.v1.AiService/Stream`),
  eliminating tens of thousands of analytics/dashboard/metrics/telemetry
  events previously captured by a `PROCESS`-by-default rule.
- `docker-compose.yml` Postgres credentials now honor `${POSTGRES_*}` env
  overrides with sensible local-dev defaults, removing inlined values.

---

## How releases work

This CHANGELOG tracks shipped work in the `Unreleased` section; at each
release cut the section is renamed to `[X.Y.Z] — YYYY-MM-DD` and a fresh
`Unreleased` opens above it. Each release entry mirrors the structure
above (`Added` / `Changed` / `Fixed` / `Removed` / `Deprecated` / `Security`).

Versioning policy:
- Major bumps follow breaking changes to the public admin API, the
  routing-rule schema, or `traffic_event_*` tables.
- Minor bumps follow new features or non-breaking schema additions.
- Patch bumps follow bug fixes / docs / lint changes.
