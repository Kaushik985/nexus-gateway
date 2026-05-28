# Operator Toolkit (`nexus`)

`nexus` is a single binary that operates and observes the gateway from your terminal. It is the same capability set as the web Control Plane's read and triage surfaces, reached only through the existing admin API and `/v1/*` — so everything you can do in `nexus` is governed by exactly the same IAM as the web console. It has three faces over one core: an interactive **TUI**, a scriptable **CLI**, and an **MCP server** for agents.

## Environments and login

`nexus` keeps named environments (for example `local`, `dev`, `prod`) in `~/.config/nexus/config.toml`. Each environment records its base URLs and the model + Virtual Key you last used; secrets never go in that file — your access token, admin key, and Virtual Key secret live in the OS keychain. A built-in `local` target works out of the box; point `nexus` at your own deployment with a one-time setup.

- `nexus setup [name]` walks you through an environment (Control Plane URL, AI Gateway URL, OAuth client, prod flag), saves it, and makes it the default. Run it again on an existing name to edit it.
- `nexus env add <name> --cp-url … [--aigw-url …] [--prod]` adds or overwrites an environment non-interactively (for scripts).
- `nexus env ls` lists the environments and marks the default; `nexus env use <name>` switches the default; `nexus env rm <name>` removes one.
- `--env <name>` targets a different environment for a single command.

If you run a command before configuring or signing in, `nexus` tells you what to do next — `nexus setup` when no environment is configured, or `nexus login` when an environment exists but you are not authenticated — instead of failing with a raw error.

You authenticate one of two ways:

- **As a person** — `nexus login` opens your browser for the standard OAuth2 + PKCE sign-in and caches the resulting token.
- **As a machine** — `nexus login --admin-key` reads an admin API key from stdin and stores it for an unattended profile.

The active environment is always visible, and a **prod** environment is shown with a persistent red banner so you cannot mistake which deployment you are acting on.

## The TUI

Running `nexus` with no subcommand on a terminal opens the console. On first use (or whenever the remembered selection is missing or invalid) an entry wizard walks you through choosing an environment (pick one you have configured, or create a new one inline), signing in, picking a model, and choosing a Virtual Key — either pasting a key you hold or pressing `c` to create your own. Once a selection is stored, launches go straight to the dashboard. Navigation is k9s-style: a few hot-path tabs plus a `:` command palette to fuzzy-jump to any view (`:nodes`, `:alerts`, `:cost`…); `q` quits. The bottom-right of the screen always shows the active profile and its address, so you can confirm which deployment you are acting on (reddened on a prod environment, alongside the top red banner).

Press `>` to open **Ask Nexus**, a natural-language bar: type a question in plain English and your selected model turns it into an action. It can **jump** to the right view and pre-filter it ("show 5xx from openai in the last hour" opens a filtered Radar), **answer** a read question by pulling the relevant data and summarizing it ("what's my most expensive provider today?", "what's failing right now?"), or **explain** an event you name by id. Ask Nexus only reads and navigates — it never changes anything on its own; mitigations always stay behind their own confirmed controls. Because it answers through your selected model and Virtual Key, your gateway's own compliance policy applies to what it sends, so an answer can be blocked just like any other call.

- **Overview** — health tiles (requests, cost, tokens, cache hits, errors), a braille trend chart (`c` cycles requests/cost/latency), the five services, and a DLQ backlog signal.
- **Radar** — a live, polled list of recent traffic with flashing BLOCKED / PII / cache-HIT badges and a running window-cost total. Press `f` to filter to errors, `enter` on a row to open it.
- **Event** — one traffic event in detail: status, model/provider, tokens and cost, the trace id, the latency-phase waterfall, the hook decisions and why, the request/response bodies (`b` cycles), `x` to have your model explain the event in plain language, and `r` to replay the captured request through the pipeline under your own key.
- **SLO** — overall availability and, per provider, request volume and p50 / p95 / TTFB-p95 latency (red-amber-green by p95), plus routing-fallback activity. Select a provider (`enter`) to drill into its detail — availability, error rate, cache-hit rate, average latency and TTFB, and cost; `esc` returns. Providers are always shown by their friendly name. From the detail, `t` enables or disables that provider (a prod environment first requires typing the environment name to confirm).
- **Cost** — per-provider spend with average latency (top talkers), a cache-ROI line, and a burn-rate ($/hr) with a 30-day projection. Press `f` to flush the gateway's cached config (prod requires a typed confirmation).
- **Chat** — a streaming chat playground against your selected model and Virtual Key; each turn shows its token usage (including cached tokens) and latency, plus a running session-cost tally. Slash commands tune the session: `/system <text>` sets a system prompt, `/temp <0–2>` sets the sampling temperature, `/clear` resets the conversation, and `/compare <model>` turns on **A/B mode** — each prompt is sent to your model and the chosen model side by side, with the faster reply flagged (`/solo` exits). `/help` lists the commands.
- **Lab** — a synthetic traffic generator (make the radar come alive on demand), a request lab that runs a crafted request through the real pipeline, and a routing dry-run (`t`) that shows which provider/model your model resolves to.
- **Kill** — the emergency controls. It shows the current **kill switch** state (which halts TLS bumping on every node) and the **emergency passthrough** snapshot (which bypasses the compliance hooks) — the global tier plus a count of any per-adapter or per-provider overrides currently bypassing the pipeline. `e`/`d` toggle the kill switch; `p`/`o` toggle the global passthrough. In a prod environment, every toggle requires typing the environment name to confirm.
- **Alerts** — the alerts firing right now, colored by severity.
- **Nodes** — every node's heartbeat, version, and whether its applied config has drifted from target.
- **Compliance** — the compliance KPIs: total requests, blocked count, block rate (RAG), TLS coverage, hook error rate.
- **Jobs** — the scheduled background jobs, whether each is enabled, its interval, and last run.
- **Sync** — the fleet-wide config-drift rollup (how many nodes have not applied the target config).
- **Models** — the full model catalog grouped by provider: each model's code, friendly name, context window, input/output price per million tokens, and whether it is enabled. Scroll with ↑/↓.
- **Keys** — the deployment's Virtual Keys with their type, approval status (RAG), and enabled state. Press `r` to **revoke** the selected key (offered only for keys still in *active* status) or `g` to **regenerate** its secret — the new key is shown once in a panel you dismiss with `esc`, so copy it immediately. Both actions require typing the environment name to confirm in a prod environment.
- **Rules** — the routing rules in priority order: name, strategy, priority, pipeline stage, and enabled state. Press `t` to enable or disable the selected rule (prod requires a typed confirmation) — a one-keystroke way to take a misbehaving rule out of the path during an incident.

Views poll on a throttled interval and keep showing the last good data with an inline note if a refresh fails, so a transient error never blanks the screen.

Anything that sends real traffic (chat, the lab, the generator) uses a Virtual Key you hold the secret for — your own key or one you create in the wizard — so you never spend another team's quota.

## The CLI

Every capability is also a command, so scripts and other tools can shell out to `nexus`. Add `--output json` for a stable JSON shape on any command.

- `nexus health` — health tiles + service/node status.
- `nexus models ls` — the configured model catalog.
- `nexus traffic ls [--status …]` and `nexus traffic get <id> [--normalized]` — list and inspect traffic events.
- `nexus cost [--group provider|user|model]` — cost grouped as requested.
- `nexus slo` — availability, per-provider latency percentiles, and fallbacks.
- `nexus chat "<message>" [--model …] [--vk …]` — send one prompt and stream the reply (uses your remembered model and stored Virtual Key secret unless overridden).
- `nexus simulate [--model …] [--prompt …]` — run a crafted request through the pipeline via the admin simulator and print the full response.
- `nexus route explain --model <slug>` — dry-run the router: which provider/model the request resolves to, plus any warnings. Fires no real request.
- `nexus vk create [--name …]` — mint a personal Virtual Key you own; the secret is printed once and (by default) stored for this environment.
- `nexus killswitch status` — show the current global kill-switch state; `nexus killswitch on|off` toggles it (prod requires `--yes`).
- `nexus passthrough status` — show the three-tier emergency-passthrough snapshot; `nexus passthrough global on|off` toggles the global tier (on bypasses the hooks by default; `--bypass-cache`/`--bypass-normalize` add the others; prod requires `--yes`).

Commands return distinct exit codes so scripts can branch: `0` success, `1` transport/other, `2` usage error, `3` authentication required, `4` IAM denied, `5` not found.

## MCP server (for agents)

`nexus mcp serve` exposes the toolkit as Model Context Protocol tools over stdio, so an agent or a partner platform can drive the gateway without bespoke glue. The server has no auth of its own — it runs every tool as the principal of the configured admin credential, through the same admin API and IAM, so an agent's reach is exactly what that service user's IAM policy allows. Tools are tiered: **observe** (health, traffic, models, firing alerts, node health/drift, the kill-switch state, the emergency-passthrough snapshot), **analyze** (cost, SLO, compliance KPIs, and a routing dry-run that explains where a model resolves), and **simulate** (run a crafted request through the pipeline). The **mitigate** tier is off unless you pass `--enable-mitigate`; it covers the kill switch, the global emergency passthrough, a cache flush, disabling a provider, toggling a routing rule, and revoking a Virtual Key. The entity actions take a human-friendly name (a provider name, a rule name, or a key name/prefix) and resolve it to the right id for you, so a typo fails with the list of valid names — and a name that matches more than one entity is refused rather than resolved — instead of touching the wrong thing. Because an agent can't confirm interactively, these write tools rely on being explicitly enabled plus the service user's IAM policy and server-side audit — there is no typed confirmation as there is in the interactive console.

## Installation

`nexus` is a single static Go binary built from `packages/nexus-cli/cmd/nexus`.
