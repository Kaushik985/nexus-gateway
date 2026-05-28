# Roadmap

Single living tracker of major in-flight features + queued epics + reserved epic-number ranges. Read this first when asked "what's the status of E\<n\>?" or "what big features haven't been done yet?".

Per CLAUDE.md mandatory rule "Current state": every entry here links into requirements / SDD / OpenAPI / memory for the work.

## In flight

### E87 — Endpoint Typology Unification

**Status:** Phase 1 starting 2026-05-25. 3 phases. Plan locked in [docs/developers/specs/e87-endpoint-typology-unification.md](./specs/e87-endpoint-typology-unification.md).

**Goal:** Replace 3 overlapping endpoint-type enum families (provcore.Endpoint + audit.EndpointType + hookcore.EndpointType + Model.Type + classify.AdapterID + …) with a single canonical 3-axis taxonomy:
- **Axis 1 — `EndpointKind`** (what the user is doing: chat, embedding, tts, image_generation, …)
- **Axis 2 — `WireShape`** (request body format: openai-chat, anthropic-messages, gemini-generate, bedrock-converse, …)
- **Axis 3 — `IngressPath`** (HTTP path, AIGW-internal only)

Lives in new `packages/shared/transport/typology/` with one `ClassifyPath(method, path)` function consumed by AIGW dispatch + CP/Agent classifier + hook filter + audit persistence.

**Phases:**
1. **E87-S1** (Phase 1) — add canonical types + `ClassifyPath`; old enums untouched; zero callsite changes. Pure-add, no breaking change.
2. **E87-S2** (Phase 2) — migrate every internal callsite; wire-format compat shim preserves `traffic_event.endpoint_type` byte-identical. Internal Go API breaks (intentional); wire + DB unchanged.
3. **E87-S3** (Phase 3) — DB schema migration (rename `Provider.adapter_type`→`wire_shape`, drop `Model.Type`, change `traffic_event.endpoint_type` vocabulary `chat/completions`→`chat`, add `wire_shape` column); remove legacy enums; remove compat shim; A11 doc lands on final state.

Each phase: 2-round self-audit + Chinese review summary + user approval before commit (per `feedback_docs_backfill_code_anchored_protocol` Step 9).

**Why:** Today 11 partially-overlapping type definitions describe the same concept with 4 distinct vocabularies for "chat" alone (`chat_completions` / `chat` / `chat/completions` / `chat` again as Model.Type). Adding a new endpoint kind (Realtime API, video generation) requires editing ≥4 files in 3 packages with non-obvious dependency order. Two dead constants (`audit.EndpointTypeResponses`, `audit.EndpointTypeCompletions`) survive because removing them feels risky despite never being produced. The unification gives one canonical home, one `ClassifyPath` function, clean Axis 1+2+3 separation.

**Memory anchors:** none yet (writing as E87-S1 lands).

### E88 — Nexus Operator Toolkit (`nexus` TUI / CLI / MCP)

**Status:** Phase 0 graduation 2026-05-28. Requirements + 4 stories locked in [docs/developers/specs/e88-nexus-operator-toolkit.md](./specs/e88-nexus-operator-toolkit.md). Design source: [docs/superpowers/specs/2026-05-28-nexus-tui-design.md](../superpowers/specs/2026-05-28-nexus-tui-design.md).

**Goal:** One Go binary `nexus` (new module `packages/nexus-cli/`), three faces over one `core`:
- **TUI** (Bubble Tea) — health overview, live radar, traffic drill-down + trace/waterfall, SLO, cost, chat playground, simulator, kill-switch toggle.
- **CLI** (Cobra) — every capability as `nexus <noun> <verb> --output json`.
- **MCP** (`nexus mcp serve`) — observe/analyze/simulate tools; mitigate off by default.

One IAM, no carve-outs: all three faces reach the gateway only through the existing admin API + `/v1/*`. **v1 adds zero new backend endpoints** (every capability maps to an existing route) → no OpenAPI, no IAM drift.

**Stories:** E88-S1 core (auth PKCE + admin-key, profiles, keychain, typed client) · E88-S2 CLI · E88-S3 TUI · E88-S4 MCP.

**Why:** No terminal-native, scriptable, agent-embeddable surface exists today for the operate/observe/verify loop; operators fall back to the web UI or raw `cp_curl`. The toolkit gives SRE a ≤2-keystroke path from health → failing request → mitigate → verify, gives developers a request-experiment lab, and gives partner platforms an MCP integration governed by the same IAM as every other caller.

**Program docs:** [docs/handoffs/nexus-operator-toolkit/](../handoffs/nexus-operator-toolkit/) (PLAN.md + HANDOFF.md).

**Memory anchors:** none yet (writing as E88-S1 lands).

## Queued

(none — A-Q docs-backfill program is the active focus; new epics added here as they get filed)

## Reserved epic-number ranges

- E80-E89: cross-cutting refactors (E85 ✅ unit-test coverage 95%, E86 ✅ E2E coverage, E87 endpoint typology, E88 operator toolkit)
- E90-E99: open for next program
