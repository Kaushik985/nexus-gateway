# Control Plane — governance & compliance admin

This doc covers the Control Plane's admin surface for the governance and
compliance controls that the data planes enforce — hooks, rule packs,
interception policy, AI-Guard, exemptions, DSAR, the kill-switch, and emergency
passthrough. `internal/governance/` owns the source-of-truth tables; the AI
Gateway, Compliance Proxy, and Agent enforce them. As on the AI-admin surface,
every mutation propagates through the Hub shadow — but here the fan-out is
often multi-plane (a single hook, rule-pack, or exemption change must reach
every plane that enforces it) and two surfaces are emergency-grade.

## Propagation & multi-plane fan-out

The same two Hub primitives carry every change: `NotifyConfigChange` pushes an
assembled payload into a Thing's shadow and returns the Hub response;
`InvalidateConfig` is a fire-and-forget reload signal the owning Things act on
by re-reading their own store. What differs from the AI-admin surface is the
fan-out — a change is invalidated on every plane that enforces the control:

| Control | Planes notified | Hub primitive |
|---|---|---|
| Hooks, rule packs | AI Gateway + Compliance Proxy + Agent | `InvalidateConfig` (`hooks` key) |
| Exemptions | Compliance Proxy + Agent | `InvalidateConfig` (`exemptions` key) |
| Kill-switch | Compliance Proxy + Agent | `NotifyConfigChange` (`killswitch` key) |
| AI-Guard | AI Gateway | `InvalidateConfig` (`ai_guard` key) |
| Emergency passthrough | AI Gateway | `NotifyConfigChange` (`gateway_passthrough` key) |

Each domain talks to Hub through a narrow interface exposing only the primitive
it needs. The shadow model and the config-reconcile loop that heals dropped
pushes are in
[control-plane-architecture.md](control-plane-architecture.md),
[configuration-architecture.md](../../cross-cutting/foundation/configuration-architecture.md),
and
[thing-config-sync-architecture.md](../../cross-cutting/foundation/thing-config-sync-architecture.md).

## Kill-switch

`internal/governance/killswitch/` serves a single write endpoint,
`POST /api/admin/compliance/killswitch`, gated on the kill-switch toggle IAM
action. The handler is write-only — the current per-node state and history are
read through the generic config-sync surface.

The Control Plane writes no config state directly: it calls
`NotifyConfigChange`, and Hub owns the `thing_config_template` upsert, the
per-leg `config_change_event` rows, and the WebSocket broadcast. The Control
Plane emits its own admin-audit-log row recording the toggle. The call fans out across the two Thing types that perform
interception — Compliance Proxy first as the primary leg, then Agent. A failure
on the primary leg returns 502 so the operator retries; a failure on the Agent
leg is logged and the call continues, because engaging the switch is a "stop the
bleed" intent and a partial fan-out is safer than rolling back the
Compliance-Proxy update — the config-reconcile loop re-pushes the Agent leg on
its next tick. The AI Gateway has no kill-switch because it does not intercept.
The data-plane semantics are in
[kill-switch-architecture.md](../../cross-cutting/safety/kill-switch-architecture.md).

## Emergency passthrough

`internal/governance/passthrough/` configures the AI Gateway's emergency bypass
in three tiers — global, per-adapter, and per-provider — with `/effective` and
`/snapshot` read views (`/api/admin/passthrough/*`). Reads are open to any
admin; deletes require the passthrough write action; enabling a tier requires
the most restricted emergency-enable action. Each write is validated: when
enabled it must set at least one bypass flag (`bypassHooks`, `bypassCache`,
`bypassNormalize`), `bypassNormalize` requires `bypassCache` because the cache
key derives from the normalized payload, the expiry is mandatory and capped at
eight hours in the future, and the reason must be at least twenty characters.

A write upserts the tier row, assembles the full `{global, adapters, providers}`
blob, and pushes it under the `gateway_passthrough` shadow key via
`NotifyConfigChange`; a Hub failure after the database write returns the 502
`propagation_error`. Each write captures a before/after state diff into the
admin audit log, emitted only after both the database upsert and the Hub push
commit. The data-plane bypass behaviour is in
[emergency-passthrough-architecture.md](../../cross-cutting/safety/emergency-passthrough-architecture.md).

## Hooks and rule packs

`internal/governance/hooks/` owns hook-config CRUD plus reorder and refresh
(`/api/admin/hooks`), and a set of extras — the implementations registry, the
execution chain, and a hook test / dry-run that proxies to the AI Gateway. Every
create/update/delete invalidates the `hooks` config on all three enforcing
planes (AI Gateway, Compliance Proxy, Agent).

`internal/governance/rulepacks/` owns the rule-pack catalog (list, get, create,
preview, import, update, delete, dry-run) gated on the rule-pack IAM resource,
and the binding of a rule pack to a hook (`/api/admin/hooks/:hookId/rule-packs`
install plus per-install patch, overrides, and effective-rules) gated on the
hook IAM resource. A rule pack is delivered through the hook it is bound to, so
rule-pack changes propagate via the same three-plane `hooks` invalidation. The
hook execution model is in
[hook-architecture.md](../ai-gateway/hook-architecture.md).

## Interception domains and paths

`internal/governance/interception/` owns interception-domain CRUD
(`/api/admin/interception-domains`) and the per-domain path rules nested under
it. These rows define which hosts and paths the intercepting planes bump. Domain
and path matching is in
[domain-device-predicate-architecture.md](../compliance-proxy/domain-device-predicate-architecture.md).

## AI-Guard

`internal/governance/aiguard/` serves the AI-Guard config (`/api/admin/ai-guard/config`
GET and PUT) and a dry-run endpoint, gated on the AI-Guard config IAM resource. A
PUT invalidates the `ai_guard` config so the AI Gateway hot-swaps its in-process
snapshot; the dry-run dispatches a classification request to the AI Gateway. The
judge-model pipeline is in
[aiguard-architecture.md](../ai-gateway/aiguard-architecture.md).

## Exemptions

`internal/governance/exemptions/` owns the compliance exemption surface:
exemption-grant CRUD, the unified exemption view, request approve/reject, and an
employee-facing request submission (`/api/admin/compliance/exemption-grants`,
`/api/admin/compliance/exemptions/:id`, `/api/admin/exemption-requests`), gated
on the compliance-exemption IAM resource. Changes invalidate the `exemptions`
config on the Compliance Proxy and the Agent — both planes re-read the exemption
grants on the signal and let an exempt host pass through before interception.

## DSAR

`internal/governance/dsar/` owns the data-subject-access-request workflow —
list, create, get, update, and fulfill (`/api/admin/dsar`), gated on the DSAR
IAM resource. This is a Control-Plane-local workflow record; the actual data
erasure and export run as Hub purge jobs described in
[data-retention-purge-architecture.md](../../cross-cutting/storage/data-retention-purge-architecture.md).

## References

- `packages/control-plane/internal/governance/killswitch/` — kill-switch toggle (write-only via Hub)
- `packages/control-plane/internal/governance/passthrough/` — emergency-passthrough 3-tier config
- `packages/control-plane/internal/governance/hooks/` — hook-config CRUD + extras
- `packages/control-plane/internal/governance/rulepacks/` — rule-pack catalog + hook binding
- `packages/control-plane/internal/governance/interception/` — interception domains + paths
- `packages/control-plane/internal/governance/aiguard/` — AI-Guard config + dry-run
- `packages/control-plane/internal/governance/exemptions/` — compliance exemptions admin
- `packages/control-plane/internal/governance/dsar/` — DSAR workflow
- `packages/control-plane/internal/platform/hub/` — `NotifyConfigChange` / `InvalidateConfig`
- `packages/shared/schemas/configkey/` — shadow config key constants
