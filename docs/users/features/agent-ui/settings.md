# Agent UI — Settings

Settings holds this device's account information, preferences, the protection toggle, and the sign-out action, grouped into Account, Preferences, Protection, and a Danger zone, with an About line at the bottom. The page is `packages/agent/ui/frontend/src/pages/settings/Settings.tsx`.

## Account

The account card shows how this device is registered: the signed-in user (display name, email, status), and the device itself — device id, trust level (`0` revoked, `1` enrolled, `2` linked, `3` compliant), SSO email, device-auth mode, and certificate expiry. When the agent belongs to an organization, a second card shows the organization hierarchy as a root-to-current breadcrumb plus the current organization's name, code, timezone, and description.

## Preferences

- **Theme** — light, dark, or system.
- **Language** — English, 中文, or Español; the choice persists.

## Protection

**Pause / Resume** is the one control that changes daemon behavior. While running, you can pause protection for 15 minutes, 1 hour, 8 hours, or until you resume; while paused, the card shows a Resume button and, when set, the time protection resumes. A separate **Updates** card has a "check now" button that reports whether the agent is up to date or a new version is available.

## Danger zone

**Sign out** unenrolls the device — a destructive action behind a two-step confirmation. On success the daemon exits and relaunches in its pre-enrollment state, so the UI returns to onboarding.

## About

A footer line shows the agent name, its version, and whether it is connected to the gateway.

## Where the data comes from

The account and organization cards read the applied-config snapshot (`useAppliedConfig` — user context and organization tree) and the polled status; theme is handled by the UI's theme provider and language by i18n. The actions are `agentApi.pauseProtection`, `resumeProtection`, `checkUpdate`, and `unenroll`, all over the local bridge — Settings does not call the Control Plane admin API.

## References

- `packages/agent/ui/frontend/src/pages/settings/Settings.tsx` — the Settings page and its groups
- `packages/agent/ui/frontend/src/pages/activity/AccountPanel.tsx` — the account and organization cards and the About footer
- `packages/agent/ui/frontend/src/api/agent.ts` — `agentApi.pauseProtection` / `resumeProtection` / `checkUpdate` / `unenroll`
