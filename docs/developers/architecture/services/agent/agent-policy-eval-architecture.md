# Agent policy evaluation

For every intercepted flow the agent makes one local decision: TLS-bump and
inspect it, or pass it through untouched. This document covers how that decision
is made (the policy engine), the two safety valves that force passthrough — the
cert-pin auto-exemption loop-breaker and the user-initiated protection pause —
and how the admin-pushed configuration the device is honouring is surfaced for
display.

## The decision: the policy engine

`policy/core.Engine.Evaluate(host)` resolves a hostname to a `PolicyResult`
(`inspect` or the default action) in a fixed order:

1. **Exemption check.** If an exemption store is attached and the host is
   exempt, the result is the default action (passthrough) — the host is skipped.
2. **Interception-domain match.** If an interception-hosts callback is wired and
   the host matches a pattern (glob), the result is `inspect`, so the daemon
   bumps the flow and runs the hook pipeline.
3. **Default.** Otherwise the engine returns its configured default action,
   typically passthrough.

The engine is constructed with the default action and given its inputs by
injection: `SetExemptionStore` attaches the exemption store, and
`SetInterceptionHostsFn` registers a callback that returns the current
interception-domain host patterns (sourced from the admin-pushed Cat B
interception list via the compliance pipeline's domain snapshot). Because the
default is passthrough, a host the admin never configured for interception is
never bumped — interception is opt-in per the fleet's domain config, not
all-traffic by default.

The kill switch / pause state is checked upstream of the engine on the
connection-handling path (a paused or kill-switched agent passes every flow
through without consulting the engine), so the engine itself only ever sees
flows the agent is actively allowed to inspect.

## Auto-exemption: the cert-pin loop breaker

Some upstreams pin their certificate and reject the agent's forged leaf. Without
intervention the agent would bump, fail the handshake, fall back to passthrough,
and bump again on the next connection — an endless trip-and-fail loop.
`policy/exemption.Store` breaks it: it tracks bump failures per host in a sliding
window and, once a host crosses the failure threshold within the window,
auto-exempts it (source `auto`) for a configured duration, so subsequent flows
short-circuit to passthrough at step 1 above. Defaults are a threshold of 3
failures in a 60-second window.

The store also holds operator allow/deny lists: a denylisted host may never be
auto-exempted (the operator wants it bumped even if it costs a failed
connection), and the lists let an admin pre-exempt hosts outright. Exemptions are
in-memory with their expiry, so they clear on restart and re-derive from live
failures.

## Protection pause

`lifecycle/protectionpause` is the user-facing "Pause Protection" control reached
over the status IPC. Rather than add a parallel gate, it composes the existing
kill switch: `Pause(seconds)` engages the switch (so the connection bridge's
existing kill-switch check already routes every flow to passthrough) and arms a
one-shot timer that auto-resumes after the duration; `ResumesAt` exposes the
deadline so the menu bar can render a countdown, and `Resume` cancels the timer
atomically. The pause records a "paused-by-user" actor on the switch so an
admin-initiated kill remains distinguishable from a user pause.

Whether a user *may* pause is gated by the admin `quitAllowed` policy — the same
gate that governs quit and unenroll over the IPC (see
[agent-tray-ipc-architecture.md](agent-tray-ipc-architecture.md)).

## The applied-config view

`policy/policies` decodes the shadow-config snapshot the device is honouring
(interception domains, hook chain, exemptions, kill switch, device defaults, …)
into the shapes the Dashboard's Policies page renders, backing the
`GET_APPLIED_CONFIG` IPC command. Parsing is deliberately lenient: an unknown
wire shape or missing key yields an empty section rather than an error, so a
partially-configured fleet still renders. This package only decodes — the config
itself arrives through the normal Hub → shadow path.

## References

- `packages/agent/internal/policy/core/engine.go` — `Evaluate` + the exemption / interception-domain / default decision order
- `packages/agent/internal/policy/exemption/store.go` — sliding-window failure tracking + auto-exemption + allow/deny lists
- `packages/agent/internal/lifecycle/protectionpause/pause.go` — user pause over the kill switch + auto-resume timer
- `packages/agent/internal/policy/policies/applied.go` — the applied-config snapshot decoder for the Policies page
- `packages/agent/internal/policy/policies/snapshot_cache.go` — the cache the `GET_APPLIED_CONFIG` handler reads
