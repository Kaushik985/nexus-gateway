# Agent UI — Onboarding (first launch and enrollment)

The Nexus Agent's desktop UI opens into one of a few top-level states depending on whether the local agent daemon is reachable and whether the device is enrolled. **Onboarding** is the first-launch experience shown until the device is enrolled. The state machine lives in `packages/agent/ui/frontend/src/app/App.tsx`; the onboarding card in `packages/agent/ui/frontend/src/pages/onboarding/Onboarding.tsx`.

## Top-level states

The UI polls the local agent daemon every two seconds and shows one of four states:

- **Agent not running** — the daemon (or the UI's bridge to it) is unreachable. A retry is offered.
- **Onboarding** — the daemon is reachable but reports no enrolled device.
- **Finishing setup** — a roughly 30-second grace screen shown right after an enrollment attempt, while the daemon restarts, so a brief restart doesn't flash the "Agent not running" screen.
- **Steady-state shell** — the seven-item sidebar (Overview, Activity, Traffic, Policies, Stats, Diagnostics, Settings). Once the daemon reports an enrolled device, the shell takes over.

## Onboarding by device-auth mode

A welcome card branches on the device-auth mode the daemon reports, which an operator configures centrally:

- **Enterprise login (SSO).** A button starts the authenticate flow, which opens the default browser for an OAuth sign-in (PKCE). If the flow needs an explicit confirmation, the card shows Continue and Cancel.
- **Token (mTLS-only).** A field to paste a single-use enrollment token issued by a Control Plane admin; submitting it enrolls the device, with running, success, and error states.
- **Discovering.** While the daemon is still resolving the deployment mode through the Hub's bootstrap, the card shows a waiting state.

## After enrollment

Submitting either flow marks an enrollment attempt, which puts the app into the Finishing-setup window so the daemon's restart doesn't surface as an error. When the daemon comes back reporting a device, the next status poll swaps in the steady-state shell.

## Where the data comes from

`agentApi` — `getStatus` (the two-second poll), `authenticateSSO` / `authenticateConfirm` / `authenticateCancel` (the SSO flow), and `enrollWithToken` (the token flow). The UI talks to the local agent daemon over its bridge, not the Control Plane admin API.

## References

- `packages/agent/ui/frontend/src/app/App.tsx` — top-level state machine and steady-state routes
- `packages/agent/ui/frontend/src/pages/onboarding/Onboarding.tsx` — the onboarding card and its branches
- `packages/agent/ui/frontend/src/pages/diagnostics/AgentNotRunning.tsx` — the agent-not-running screen
- `packages/agent/ui/frontend/src/pages/diagnostics/Reconnecting.tsx` — the finishing-setup screen
- `packages/agent/ui/frontend/src/layout/Shell.tsx` — the steady-state sidebar
- `packages/agent/ui/frontend/src/api/agent.ts` — `agentApi` bridge calls
