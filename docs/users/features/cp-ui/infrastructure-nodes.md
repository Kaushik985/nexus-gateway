# Control Plane UI — Infrastructure: nodes and configuration

The INFRASTRUCTURE sidebar section gives an operator a single place to see every running service instance and Agent, audit how their configuration has been pushed and applied, govern per-node configuration overrides, and watch the platform's background jobs. This document covers the first group of leaves — **Nodes**, **Config Sync**, **Overrides**, and **Scheduled Jobs**. Sidebar labels and routes are defined in `packages/control-plane-ui/src/routes/shellRouteConfig.tsx` and `packages/control-plane-ui/src/i18n/locales/en/nav.json`.

A node is any Thing registered with the platform: an AI Gateway, a Compliance Proxy, a Control Plane, the Nexus Hub itself, or an Agent. Each node carries a target configuration (what the platform wants it to run) and an applied configuration (what it last reported running); when the two converge the node is in sync, and when the applied configuration trails the target the node is out of sync.

## Nodes

**Purpose.** The fleet roster — every service instance and Agent registered with the platform, with a click-through to each node's detail view.

**List page.** Columns: name (with the hostname on top and a short physical-id or id digest below), type, IP, status, version, a sync indicator, and last-seen. The status badge shows one of `online`, `enrolled`, `offline`, `revoked`, or `drift`. The sync indicator compares the node's target and applied configuration versions and reads **In Sync** or **Out of Sync**; layered on top, a red apply-error count appears when any configuration key's last apply attempt failed, so a node can read "In Sync" by version yet still flag an apply error. A row carrying an override that deliberately disables the global kill switch is marked as a kill-switch bypass. Filters cover a search box, a status filter (`online`, `offline`, `enrolled`, `revoked`, `drift`), a has-overrides toggle, and a set of type tabs (`all`, `ai-gateway`, `compliance-proxy`, `control-plane`, `nexus-hub`, `agent`); on the "all" tab an additional type dropdown narrows the same set.

**Detail.** The detail page leads with an identity card (hostname, Thing id, physical id, bound user, IP, OS, type, status, version, role, listen address, metrics URL, auth type, connection protocol, registration and last-seen timestamps, process start, and a derived uptime) plus a metadata panel. It organizes the rest into tabs: Overview, Configuration, Runtime, Metrics, and Diagnostics are present for service nodes; Runtime is hidden for Agents (the Hub does not serve a runtime reverse-call for an Agent). A Login History tab appears for Agents, a Traffic tab for Agents, AI Gateways, and Compliance Proxies, and a Stats tab for the node types that report Thing statistics. Tabs are shown by node type, not by the viewer's permissions: some tabs read endpoints gated on a different permission than the page itself, and when the viewer lacks that permission the tab opens to a clear "You don't have permission to view this" notice naming the required permission — with no retry button, since retrying a denial cannot succeed.

**The Configuration tab.** This tab renders one row per templated configuration key in a four-column merged view: key, template default, the active override, and the applied value, with a per-row action column. The toolbar shows the target and applied versions, the override count, and the stale count, alongside a **Force resync all** action and an **Add override** dropdown that lists the keys that do not yet have an active override and are eligible for one. An override row is striped and badged as an override (and as stale when the template has since moved past the version the override was set at); its actions are edit, clear, and force-resync. A plain row offers add-override and force-resync, and the per-key resync action reads "Sync now" when that key is out of sync and "Force resync" when it is already in sync. The keys `credentials` and `virtual_keys` are non-overridable — their rows are greyed and the add-override action is disabled with an explanatory tooltip, while force-resync stays available. When an override on the `killswitch` key turns the kill switch off, a red bypass banner names who set it and when. Editing or adding an override opens a drawer; saving it pushes the override and refreshes the view.

**Proxy rollout (per node).** From a Compliance Proxy node's detail view, a node-scoped rollout helper walks four steps: download the CA certificate (with manual-install instructions for macOS, Windows, and Linux), download an MDM configuration profile (optionally stamped with an organization name), download a Proxy Auto-Configuration (PAC) file built from a proxy host, a proxy port that defaults to 3128, and a fail-open choice, and toggle onboarding mode. With onboarding mode on, the proxy answers with a setup-guide link before completing CONNECT tunnels; the toggle shows its on/off state and when it was last pushed. The same helper is reachable as the standalone Proxy Rollout leaf described in the operations document.

**Key concepts.** A node's status is `online`, `enrolled`, `offline`, `revoked`, or `drift` (the last set by the drift-reconciliation job when a node's applied configuration trails its target). Status badges display user-facing translated labels (e.g., "Online", "Offline") rather than raw internal values; the underlying API value is still one of the five above. "In sync" versus "out of sync" is a comparison of the target and applied configuration versions, independent of the status field. An override is a per-node deviation from the template default for one configuration key; a break-glass override is one flagged as an emergency or set on the `killswitch` key.

**Where the data comes from.** `hubApi` — `listNodes`, `getNode`, `getAppliedConfig`, `resyncNodeAll`, `clearOverride`, `setOverride`; the proxy rollout helpers `downloadCACert`, `downloadMDMProfile`, `downloadPACFile`, and `patchOnboarding`. The list reads `GET /api/admin/nodes`, gated on `node.read`; the override actions are gated on `node.force-resync` and `node.write-override`. The UI write affordances — Force resync, Add override, edit/clear/force-resync per row — are conditionally rendered based on these IAM permissions (`admin:node.force-resync` / `admin:node.write-override`), so a read-only operator sees the merged view but not the mutation buttons.

## Config Sync

**Purpose.** A fleet-wide audit of how configuration has changed and which nodes have not caught up. Two tabs: a change history and an out-of-sync monitor.

**Change History.** A table of configuration change events: timestamp, node type, configuration key, action, actor, and the resulting version. Two dropdowns filter by node type and configuration key; both are populated from the template catalog, so they only offer the node-type-and-key pairs that actually exist as templates, and the key options narrow once a type is chosen. The table is paginated.

**Out-of-Sync Monitor.** One card per node whose applied configuration trails its target, listing the node, its type, when it was last seen, and the specific keys that are behind. Each card has a re-sync action that redelivers every listed key to that node. Re-sync replays the configuration the node is already targeted at — it does not bump the template version or write a change-history row. When every node has caught up, the tab shows an all-in-sync message.

**Where the data comes from.** `hubApi` — `listConfigHistory`, `listConfigCatalog`, `listOutOfSync`, and the per-key `resyncNode`. The reads are gated on `settings.read`; the per-node resync is gated on `node.force-resync`.

## Overrides

**Purpose.** A fleet-wide, read-only registry of every active per-node configuration override, with per-row force-resync, clear, and view.

**List page.** Four summary counters lead the page: the number of nodes carrying overrides, the total override count, the stale count, and the count expiring within the hour. The table columns are node, type, the overridden key, who set it, when it was set and when it expires (or "permanent"), a status, and an action column. The status is `break-glass` when the override is an emergency override or sits on the `killswitch` key, `stale` when the template has moved past the version the override was set at, `expires {when}` when it falls due within the hour, and `ok` otherwise. Filters cover a type chip set, a has-TTL toggle, a stale toggle, a set-in-last-24h toggle, and a search box.

**Actions.** A row's view action opens the owning node's Configuration tab. Force-resync redelivers the key to that node; clear removes the override so the key reverts to its template default; and when a row is expiring soon an extend action routes to the node's Configuration tab, where the override editor handles the TTL change. The registry page itself sets no overrides — overrides are created and edited from a node's Configuration tab.

**Key concepts.** A stale override is one whose template has changed underneath it since it was set. A break-glass override is an emergency deviation, including any override on the `killswitch` key; these are the rows that correspond to the kill-switch bypass marker on the Nodes list. A TTL gives an override an expiry; without one it is permanent.

**Where the data comes from.** `hubApi` — `listGlobalOverrides`, `resyncNodeAll`, `clearOverride`. The registry read is gated on `settings.read`; clear is gated on `node.write-override` and force-resync on `node.force-resync`.

## Scheduled Jobs

**Purpose.** The status and manual control of the Hub's background scheduled jobs. The list auto-refreshes.

**List page.** Columns: job name (with its description in a tooltip), interval, last run, next run, status, last duration, run count, error count (shown in red when non-zero), an enabled state, and an action column. The status is rendered from the job's last reported state — `ok` or `success`, `running`, `failed` or `error`, or `interrupted`. Filters cover a search box and an enabled dropdown (all, enabled, disabled). The table is paginated.

**Detail.** A job's detail page shows its full metadata — id, name, description, interval, status, last and next run, last duration, run and error counts, and the last error when present — above a paginated run-history table. Each run records when it started, its duration, its status (`running`, `success`, `error`, or `skipped`), the replica that ran it, and any error.

**Actions.** From either the list or the detail page, an operator can trigger a job to run immediately or toggle it enabled or disabled.

**Where the data comes from.** `hubApi` — `listJobs`, `getJob`, `listJobRuns`, `triggerJob`, `updateJob`. The reads are gated on `settings.read`; trigger and toggle are gated on `settings.update`.

## References

- `packages/control-plane-ui/src/routes/shellRouteConfig.tsx` — route registry and `nav: { sectionKey: 'infrastructure', ... }` blocks
- `packages/control-plane-ui/src/i18n/locales/en/nav.json` — sidebar labels
- `packages/control-plane-ui/src/pages/infrastructure/nodes/InfraNodesPage.tsx` — Nodes list, filters, sync indicator
- `packages/control-plane-ui/src/pages/infrastructure/nodes/InfraNodeDetailPage.tsx` — node detail tabs
- `packages/control-plane-ui/src/pages/infrastructure/_shared/tabs/config/ConfigurationTab.tsx` — the four-column merged configuration view and override actions
- `packages/control-plane-ui/src/pages/infrastructure/overrides/OverrideEditorDrawer.tsx` — the override editor drawer
- `packages/control-plane-ui/src/pages/infrastructure/proxy-rollout/InfraProxySetupPage.tsx` — node-scoped proxy rollout
- `packages/control-plane-ui/src/pages/infrastructure/config-sync/InfraConfigSyncPage.tsx` — Config Sync change history and out-of-sync monitor
- `packages/control-plane-ui/src/pages/infrastructure/overrides/InfraOverridesPage.tsx` — the active-overrides registry
- `packages/control-plane-ui/src/pages/infrastructure/jobs/InfraJobsPage.tsx` — Scheduled Jobs list
- `packages/control-plane-ui/src/pages/infrastructure/jobs/InfraJobDetailPage.tsx` — job detail and run history
- `packages/control-plane-ui/src/pages/infrastructure/jobs/jobStatus.ts` — scheduled-job status-to-color mapping
- `packages/control-plane-ui/src/lib/thingStatus.ts` — node and device status-to-color mapping
- `packages/control-plane-ui/src/api/services/infrastructure/nodes/hub.ts` — `hubApi` service layer
- `packages/control-plane/internal/infrastructure/infra/hub_proxy.go` — the node, config-sync, and override admin routes and their IAM gates
- `packages/nexus-hub/internal/jobs/` — the scheduled-job definitions and runner
