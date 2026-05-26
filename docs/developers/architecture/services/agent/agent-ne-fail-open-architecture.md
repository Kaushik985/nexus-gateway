# Agent NE fail-open architecture

The macOS agent intercepts traffic with a `NETransparentProxyProvider` system
extension (`packages/agent/platform/darwin/NexusAgent/NexusAgentExtension`). That
provider sits in the host's **outbound packet path**: every outbound flow from
every process on the Mac is offered to it. A hang, a panic, or a flow that the
provider claims but cannot relay does not just break the agent — it takes down
the whole machine's networking: DNS, DHCP, mDNS, NTP, Apple Push, and VPNs all
ride the same path. Recovery from that state is manual (`launchctl unload` plus
deleting the extension), so the provider is engineered to **fail open**: when in
doubt, decline the flow and let macOS route it natively, or relay it
un-inspected — never block or hang.

This document describes the five binding fail-open rules and the exact code paths
that enforce them. It is the document the `ne-fail-open` editing rule points at;
read it before changing anything under
`packages/agent/platform/darwin/NexusAgent/NexusAgentExtension`. For the broader
macOS interception design (system-extension lifecycle, the MITM bridge, decision
application) see [agent-macos-platform-architecture.md](agent-macos-platform-architecture.md)
and [agent-forwarder-architecture.md](agent-forwarder-architecture.md); for build
and signing see [macos-build-signing-architecture.md](macos-build-signing-architecture.md).

## What "fail open" means here

Two distinct decisions must never be confused:

- **Infrastructure failure** — the daemon is down, an IPC call times out, a flow
  cannot be opened. The provider responds by passing the flow through
  un-inspected (or declining it so macOS routes natively). It never blocks.
- **Policy decision** — the daemon explicitly returns `deny` for a flow. The
  provider honours it and closes the flow. This is admin policy, not a failure,
  and is the *only* path that intentionally blocks a flow.

Every rule below protects the first case. The provider's principal class is
registered through `NEProvider.startSystemExtensionMode()`
(`NexusAgentExtension/main.swift`); the implementation is `NexusProxyProvider` in
`NexusAgentExtension/TransparentProxyProvider.swift`.

## Two-layer protection for system-critical UDP

Critical system UDP must never reach the provider, because UDP is the path with
no relay implementation — claiming it risks dropping DNS/DHCP/NTP. Two
independent layers enforce this.

**Layer 1 — OS-level rule exclusion.** `startProxy` installs a single catch-all
`includedNetworkRules` entry (`protocol: .any`, outbound) so the proxy can see
browser QUIC, then a set of `excludedNetworkRules` covering the critical UDP
ports — `53` (DNS), `5353` (mDNS), `67`/`68` (DHCP), `123` (NTP), `500`/`4500`
(IKE), `1900` (SSDP), `5355` (LLMNR) — with both an IPv4 (`0.0.0.0`) and IPv6
(`::`) rule per port. macOS routes those ports natively and they never enter
`handleNewFlow`.

**Layer 2 — bundle-ID fast-decline.** `handleNewFlow` declines any UDP flow whose
source bundle is in `systemNetworkServiceBundles` (`com.apple.mDNSResponder`,
`com.apple.configd`, `com.apple.dhcpcd`, `com.apple.apsd`,
`com.apple.nsurlsessiond`, `com.apple.kdc`, `com.apple.timed`,
`com.apple.locationd`, `com.apple.bootpd`, `com.apple.symptomsd`, `ntpd`,
`mdnsresponder`, `launchd`) regardless of destination port. This catches the long
tail a port rule cannot — a system service sending UDP to a non-standard port
(for example DNS-over-HTTPS on UDP/443, or Apple Push on ports that vary across
macOS releases). The two layers are deliberately redundant: Layer 1 is the
primary guarantee, Layer 2 is the belt-and-suspenders if NECP does not honour the
UDP port match.

## The five fail-open rules

### Rule 1 — `handleNewFlow` decides synchronously and claims only what it can fully relay

`handleNewFlow` returns `true`/`false` synchronously and never throws — an
uncaught Swift error would make macOS drop the flow without native routing, which
the user sees as a network outage. The decision order is:

1. **Daemon self-intercept** — if the flow's source PID is the agent daemon (see
   `DaemonPIDFilter`), `return false`. The daemon's own upstream connections must
   not re-enter the interception loop. (Declining means macOS routes the daemon's
   traffic natively; an early-boot window before the daemon PID is known lets a
   request through, which the daemon's HTTP client simply retries.)
2. **UDP** (`NEAppProxyUDPFlow`): a system-service bundle returns `false`
   (Layer 2 above); a bundle on the QUIC-fallback allowlist has its read and
   write closed (`closeReadWithError` + `closeWriteWithError`) and returns `true`,
   which forces the client to fall back from HTTP/3-over-QUIC to HTTP/2-over-TCP
   where the TCP path can inspect it; **any other UDP returns `false`**. This last
   default is the load-bearing safety branch — the provider never claims UDP it
   has no relay for.
3. **Non-TCP, non-UDP** flow classes return `false`.
4. A TCP flow whose remote endpoint is not an `NWHostEndpoint` returns `false`.
5. Otherwise the flow is a relayable TCP flow: the provider records it, returns
   `true`, and hands off asynchronously to `peekSNIThenDecide`.

Protocol and bundle checks all happen *before* the flow is claimed, so a flow is
only claimed once the provider knows it can carry it.

### Rule 2 — every async daemon callback has a fail-open timeout

No flow may hang waiting on the daemon. Each asynchronous hop is time-bounded and
falls through to a non-blocking outcome:

- **`requestDecision`** (`AgentIPCClient`, `IPCProtocol.swift`) arms a 2-second
  timer. If the daemon has not answered, it fires a synthetic `passthrough`
  decision so the flow proceeds un-inspected. A hung decision would freeze the
  user's application.
- **`peekSNIThenDecide`** bounds the TLS-ClientHello peek at 500ms. Server-speaks-
  first protocols (SSH, SMTP, IMAP) never send a ClientHello; on timeout the
  provider requests a decision with the original (IP / pre-resolved) host instead
  of waiting forever.
- **`peekSNIThenRelay`** applies the same 500ms bound on the relay path and falls
  straight through to a plain relay on timeout.
- **IPC teardown** (`disconnect`, and the receive-loop error / peer-close paths)
  drains every pending decision callback with a synthetic **`passthrough`** — not
  `deny`. Draining with `deny` would reject every in-flight flow the instant
  daemon IPC dropped, which presents as a wholesale outage.

The race between a timeout firing and the real callback arriving is resolved by
`TimeoutGuard` (`QUICFallbackBundles.swift`): whichever calls `tryFire()` first
wins, and the loser drops its work, so a flow is never both timed-out and
relayed.

A related fail-open shape covers a flow that is claimed but then cannot be used:
when `flow.open` fails, or `createTCPConnection` returns nil, the provider closes
the flow's read and write (a reset) and completes it. The client sees an immediate
reset and retries — far better than the ~75-second SYN timeout it would otherwise
sit through.

### Rule 3 — no hardcoded enforcement lists in the extension

The list of bundles whose QUIC is killed is **admin policy**, not a constant. It
originates in the Hub-pushed `agent_settings.forceQUICFallbackBundles` shadow
value; the daemon writes it to `/var/run/nexus-agent/quic-bundles.json`
(`packages/agent/cmd/agent/platformshim/quic_fallback_darwin.go`, fed from the
`agent_settings` applier in `packages/agent/cmd/agent/configappliers.go`); and
`QUICFallbackBundles` reads that file only, refreshing on a timer. The read is
empty-as-fail-safe: a missing or unreadable file yields an empty allowlist (no
UDP is killed), and an undecodable file keeps the previous list. There is no
hardcoded fallback allowlist — a hardcoded list would silently override an admin
who removed a bundle, and a brief no-enforcement window at first boot is the
intended safe default.

The one hardcoded set in the extension, `systemNetworkServiceBundles`, is **not**
an enforcement list and does not contradict this rule: it only ever causes the
provider to *decline* (never to claim or block), so it can only reduce
interception. It is hardcoded because macOS system-service bundle IDs are stable;
adding to it is a deliberate, security-reviewed change because a user application
placed on it would become invisible to interception.

### Rule 4 — no placeholder `true` conditions

Every decision is a real predicate or an explicit `return false`; the extension
ships no `isLikely… = true` stand-ins. For example `isLikelyIPLiteral` actually
inspects the string (dotted-quad or colon-hex) rather than assuming a result, and
the bundle / protocol / endpoint checks in `handleNewFlow` each evaluate a
concrete condition before the flow is claimed.

### Rule 5 — system DNS / DHCP / Push UDP is never closed

Closing UDP is only ever done by the QUIC-fallback branch in Rule 1, and that
branch fires solely for bundles on the admin-controlled allowlist. System network
services are protected three times over: the `excludedNetworkRules` keep their
standard ports out of the provider entirely (Layer 1), the
`systemNetworkServiceBundles` fast-decline catches them on any port (Layer 2),
and the "any other UDP returns `false`" default means an unknown or unsigned
process's UDP is declined rather than closed. The result is that
`mdnsresponder`, `configd`, `dhcpcd`, `apsd`, `nsurlsessiond`, `kdc`, and `ntpd`
keep their UDP no matter what the provider is doing.

## Decision and relay flow (summary)

Once a TCP flow is claimed, the provider opens it, peeks the first chunk for a TLS
SNI hostname (so callers that pre-resolve DNS still yield a real hostname to the
policy engine), requests a decision from the daemon, and applies it:

- **`deny`** — close the flow with a 403-coded error (the explicit policy block).
- **`inspect`** — relay through the Go MITM bridge on `127.0.0.1:9443` using a
  `BRIDGE <host>:<port> <flowId>` header; if the bridge is unreachable or the
  header write fails, fall back to a direct relay so the flow keeps working.
- **`passthrough`** — relay directly to the remote.

The SNI peek and the bridge / relay machinery are detailed in
[agent-forwarder-architecture.md](agent-forwarder-architecture.md) and
[agent-macos-platform-architecture.md](agent-macos-platform-architecture.md). The
SNI parser itself (`SNIParser`) is pure byte-level TLS-ClientHello walking and
returns nil on any short or malformed buffer.

## Self-intercept guard

`DaemonPIDFilter` reads the daemon's PID from `/var/run/nexus-agent/daemon.pid`
(written by the daemon at startup, `packages/agent/cmd/agent/cmd_run.go`) and
caches it with a short refresh so a daemon restart is picked up without restarting
the extension. Flows whose source PID matches are declined in Rule 1. The filter
is fail-safe: a missing or unparseable PID file disables it (the provider just
loses the extra loop protection; it never blocks a flow because of it).

## Invariants any change must preserve

- A fresh macOS boot can browse the web (DNS, DHCP, HTTPS) with the extension
  active.
- With the daemon / Hub unreachable, networking still works (decisions fall
  through to passthrough).
- Malformed or unknown flows (random UDP, non-TCP classes) never hang the
  provider.
- A QUIC handshake is either killed to force TCP fallback or left alone — never
  both passed through and captured.

Builds and signing for the extension go through the `build-agent` skill; never
invoke `codesign` / `xcrun notarytool` / `swift build` directly. See
[macos-build-signing-architecture.md](macos-build-signing-architecture.md).

## References

- `packages/agent/platform/darwin/NexusAgent/NexusAgentExtension/TransparentProxyProvider.swift` — provider, `handleNewFlow`, decision/relay paths, UDP exclusion
- `packages/agent/platform/darwin/NexusAgent/NexusAgentExtension/IPCProtocol.swift` — daemon IPC client, `requestDecision` timeout, disconnect drain
- `packages/agent/platform/darwin/NexusAgent/NexusAgentExtension/QUICFallbackBundles.swift` — file-only QUIC-fallback allowlist + `TimeoutGuard`
- `packages/agent/platform/darwin/NexusAgent/NexusAgentExtension/DaemonPIDFilter.swift` — self-intercept guard
- `packages/agent/platform/darwin/NexusAgent/NexusAgentExtension/SNIParser.swift` — TLS ClientHello SNI extraction
- `packages/agent/platform/darwin/NexusAgent/NexusAgentExtension/main.swift` — system-extension entry point
- `packages/agent/cmd/agent/platformshim/quic_fallback_darwin.go` — daemon writer for `quic-bundles.json`
- `packages/agent/cmd/agent/configappliers.go` — `agent_settings` applier feeding the QUIC allowlist
- `packages/agent/cmd/agent/cmd_run.go` — daemon PID file writer
- `.cursor/rules/ne-fail-open.mdc` — the editing rule that points here
