# Control Plane UI — System: tools, status, and setup

The SYSTEM sidebar section gathers generic operations tools: a request **AI Gateway Simulator**, a **Status & Health** view of the Control Plane, and a first-run **Setup Wizard**. Sidebar labels and routes are defined in `packages/control-plane-ui/src/routes/shellRouteConfig.tsx` and `packages/control-plane-ui/src/i18n/locales/en/nav.json`.

## AI Gateway Simulator

**Purpose.** Build and send a request to the AI Gateway from the browser, to test a virtual key, a model, or a routing rule end to end.

**What you see.** A request builder: a virtual-key field, a request-format select, a model picker grouped by provider, a set of standard parameter rows each with an enable toggle, a message editor, a stream-mode switch, and a usage summary for the key.

**Controls.** Enter a virtual key (`nvk_…`) and load the models that key can reach. Pick a request format — OpenAI chat (`/v1/chat/completions`), Anthropic messages (`/v1/messages`), Gemini, or OpenAI Responses (`/v1/responses`). Enable and set any of the standard parameters — temperature, max_tokens, top_p, presence_penalty, frequency_penalty, seed, stop, and system — then toggle stream mode and send. The usage summary shows the key's prompt, completion, and total tokens, its request count, and an estimated cost, with a refresh.

**Key concepts.** The simulator sends directly to the AI Gateway, authenticated by the virtual key — it exercises the same ingress endpoints a real client would, so a request here flows through routing, caching, and compliance exactly as production traffic does. The four request formats map to the four ingress shapes the gateway accepts. Each standard parameter has an enable checkbox so you only send the parameters you set, rather than forcing defaults a model might reject.

**Where the data comes from.** `aiGatewayClientSimulatorApi` — `listModels`, `createChatCompletion`, `createChatCompletionStream`, and `getUsage` — calling the AI Gateway with the supplied key. The sidebar entry is gated on `virtual-key.read`.

## Status & Health

**Purpose.** The Control Plane's own health and the surfaces it manages directly. Fleet-wide health for every service lives at Infrastructure → Nodes; this page links there rather than duplicating it.

**What you see.** Three tabs. **Overview** shows a compact stat row (uptime, version, instance count, Go version, log level, maintenance mode), an infrastructure bar with database and Hub status plus the config version, a service-metrics card per service that auto-refreshes every 15 seconds, and a recent-errors widget. **Providers** shows a card per provider with a health status, error rate, latency, and sample count. **Jobs** links to Infrastructure → Scheduled Jobs. (Forcing the fleet to reload its config is done from Infrastructure → Config Sync; cache hit-rate and savings live in Traffic → Cache ROI.)

**Detail pages.** Provider Health (`/status/health`) is a full grid of per-provider cards with status, error rate, an average-latency split (upstream total versus time-to-first-byte), sample count, and adapter. A service detail page (`/status/services/<name>`) drills into one service's live telemetry, its instances and their health, and per-dimension metric breakdowns.

**Key concepts.** A provider's health is a backend-supplied status the UI color-codes: `healthy` green, `degraded` amber, `unhealthy` (and `down` / `unavailable`) red, `disabled` red, and anything else neutral as `unknown`. The settings summary on Overview needs the settings read permission; without it the page still renders the rest and shows a note.

**Where the data comes from.** `systemApi` (`getSettings`, `checkReady`, `listInstances`, `listProviderHealth`), `providerApi.list`, and `opsMetricsApi.current`.

## Setup Wizard

**Purpose.** A guided first-run checklist that walks an operator through the steps needed to get the platform serving traffic.

**What you see.** A step bar over a single active-step panel, with back and next navigation. The steps, in order, are: health check, organization, provider, project, virtual key, routing rule, and compliance — followed by a summary.

**Controls.** Each step checks its part of the configuration and points to where to complete it; the compliance step can be skipped. The summary recaps every step and can restart the walkthrough. The wizard counts as complete once every step except compliance reports done.

**Where the data comes from.** `useSetupWizard` drives the per-step checks; the sidebar entry is gated on `settings.update`.

## References

- `packages/control-plane-ui/src/routes/shellRouteConfig.tsx` — route registry and `nav: { sectionKey: 'system', ... }` blocks
- `packages/control-plane-ui/src/i18n/locales/en/nav.json` — sidebar labels
- `packages/control-plane-ui/src/pages/tools/ai-gateway-simulator/AIGatewaySimulatorPage.tsx` — the simulator
- `packages/control-plane-ui/src/api/services/ai-gateway/aiGatewayClientSimulator.ts` — `aiGatewayClientSimulatorApi`, request formats
- `packages/control-plane-ui/src/pages/status/overview/StatusPage.tsx` — Status & Health overview tabs
- `packages/control-plane-ui/src/pages/status/detail/ProviderHealthPage.tsx` — Provider Health grid
- `packages/control-plane-ui/src/pages/status/detail/ServiceDetailPage.tsx` — per-service detail
- `packages/control-plane-ui/src/pages/status/services/` — service card, recent-errors widget, ops-sample grouping
- `packages/control-plane-ui/src/pages/setup/SetupWizardPage.tsx` — Setup Wizard shell
- `packages/control-plane-ui/src/pages/setup/useSetupWizard.ts` — step definitions and completion checks
- `packages/control-plane-ui/src/pages/setup/steps/` — the per-step panels
- `packages/control-plane-ui/src/api/services/infrastructure/misc/system.ts` — `systemApi`
- `packages/control-plane-ui/src/api/services/infrastructure/ops/opsmetrics.ts` — `opsMetricsApi`
