# Agent UI — Policies (applied compliance configuration)

Policies is a read-only view of the compliance configuration the platform has pushed to this agent — and that the agent enforces locally. The configuration is authored in the Control Plane; this page shows what the agent has applied. Every `/policies/*` page shares one applied-config snapshot, refreshed about every ten seconds, with a Refresh button to re-pull on demand. The pages live under `packages/agent/ui/frontend/src/pages/policies/`.

## Overview

The `/policies` landing page is a scannable summary:

- A **hero status banner** showing the dominant condition — in sync, drifted (how many versions behind), kill switch engaged, or diagnostic mode active — alongside the desired config version.
- A **five-tile KPI strip**: interception domains, hooks, exemptions, and rule packs (each a count that links to its list), plus the kill switch's on/off state.
- A **sync card** with the desired version, an in-sync / drifted badge, and the last-reported time.
- **Preview cards** for domains, hooks, exemptions, and rule packs, each showing the top five with a "view all" link.
- A **QUIC-fallback card** listing the application bundle IDs whose UDP the macOS network extension closes; the list is read-only here and owned by an admin in the Control Plane.

## Interception domains

The domains list (`/policies/domains`) shows each domain's name, host pattern, match type, priority, default action, and enabled status, with a detail page per domain. These are the host rules that decide what the agent intercepts.

## Hooks

The hooks list (`/policies/hooks`) leads with a pipeline visualization that groups the hooks by stage — `preInbound`, `preOutbound`, `postInbound`, `postOutbound` — and orders them by priority within each stage, so you can see exactly what runs and in what order. The table below shows each hook's priority, name, stage, implementation, fail behavior, and enabled status, with a detail page per hook. Hooks run locally on the agent at the request and response stages.

## Exemptions

The exemptions list (`/policies/exemptions`) shows the exempt host (or user) and the reason. An exempt host bypasses interception entirely — its traffic passes through uninspected rather than skipping individual hooks.

## Rule packs

The rule-packs list (`/policies/rule-packs`) shows each pack's name, version, maintainer, the hook it is bound to, its rule count, and enabled status. A rule pack is a versioned set of rules bound to a single hook; when that hook runs, it applies the pack's rules. The detail page shows the pack's attributes — version, maintainer, bound hook (linking to that hook), rule count, pack id, installed-at, and install id — and a table of the individual rules (rule id, category, severity, pattern, description).

## Where the data comes from

`useAppliedConfig` reads the daemon's applied-config snapshot over the local bridge (`agentApi.getAppliedConfig`), shared by every Policies page; the Refresh action calls `agentApi.refreshPolicies` to re-pull from the Hub and re-render. This is the agent's own applied configuration, not the Control Plane admin API — the page is a transparency surface for what the platform has pushed and the agent is enforcing.

## References

- `packages/agent/ui/frontend/src/pages/policies/Overview.tsx` — the Policies landing page
- `packages/agent/ui/frontend/src/pages/policies/useAppliedConfig.ts` — the shared applied-config snapshot and refresh
- `packages/agent/ui/frontend/src/pages/policies/DomainsList.tsx` and `DomainDetail.tsx` — interception domains
- `packages/agent/ui/frontend/src/pages/policies/HooksList.tsx`, `HookDetail.tsx`, and `HookPipeline.tsx` — hooks and the stage pipeline
- `packages/agent/ui/frontend/src/pages/policies/ExemptionsList.tsx` — exemptions
- `packages/agent/ui/frontend/src/pages/policies/RulePacksList.tsx` and `RulePackDetail.tsx` — rule packs
- `packages/agent/ui/frontend/src/api/agent.ts` — `agentApi.getAppliedConfig` / `refreshPolicies` and the `AppliedConfig` shape
- `packages/agent/internal/policy/core/engine.go` — the exemption check (an exempt host returns `passthrough`)
- `packages/agent/internal/compliance/pipeline.go` — rule-pack injection into the bound hook (`_rulePackInstalls`)
