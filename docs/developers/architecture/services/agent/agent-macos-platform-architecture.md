# Agent macOS platform

On macOS the agent intercepts outbound traffic with a bundled
`NETransparentProxyProvider` **system extension** written in Swift. The
extension observes every outbound flow but never terminates TLS itself; it
makes a fast local decision and either lets the OS route the flow natively,
relays it untouched, or hands it to the Go daemon for full TLS-bump inspection.
The extension and the daemon are two processes joined by two loopback channels.

Because the extension sits in the host's outbound packet path, its overriding
rule is **fail-open**: any decision it cannot make cleanly resolves to "let the
traffic through", never "block". A hang or a fail-closed bug here would take
down the whole machine's network (DNS, DHCP, Apple Push, VPN), recoverable only
by manually unloading the extension. Every branch below is shaped by that rule.

## Two processes, two channels

The Swift extension (`NexusProxyProvider`) is loaded by the NE framework — the
`Info.plist` registers it under `NEProviderClasses` (`app-proxy` →
`NexusAgentExtension.NexusProxyProvider`), and `main.swift` calls
`NEProvider.startSystemExtensionMode()`. Its entitlements declare the
network-extension provider type and turn the app sandbox off so it can open a
loopback socket to the daemon.

The Go daemon (`platform.DarwinPlatform`) owns policy and inspection. The two
talk over:

- **`ne.sock`** — a Unix domain socket the daemon binds (`/var/run/nexus-agent/ne.sock`
  when running as root, else `~/.nexus/ne.sock`), `chmod 0600`. It carries
  newline-delimited JSON: the extension sends `flow_new` and gets a decision
  back, plus `flow_update_host` and `flow_closed` notifications. The extension
  connects with Apple's `NWConnection` over a Unix endpoint rather than a POSIX
  `socket()` — inside the system-extension sandbox the BSD socket syscalls are
  denied silently, while `NWConnection` is allowed.
- **`127.0.0.1:9443`** — a loopback TCP listener the daemon runs for inspect
  flows only. The extension redirects an inspect flow to this port, prefixed
  with a one-line text header `BRIDGE <host>:<port> <flowId>\n`; the daemon
  parses the header and hands the remaining stream to `proxy.BumpFlow`. Binding
  is loopback-only so the bump endpoint is invisible off-host.

## Network settings: catch-all plus a fail-open UDP carve-out

`startProxy` installs a single catch-all include rule — protocol `.any`,
direction outbound — so every outbound TCP **and** UDP flow is offered to
`handleNewFlow`. UDP is captured for one reason: to kill QUIC (HTTP/3 over UDP
443) from browsers so they fall back to HTTP/2 over TCP, which the agent can
SNI-parse and inspect.

Capturing all UDP is dangerous, so `startProxy` also installs
`excludedNetworkRules` for the critical system UDP ports — 53 (DNS), 5353
(mDNS), 67/68 (DHCP), 123 (NTP), 500/4500 (IKE), 1900 (SSDP), 5355 (LLMNR), each
for IPv4 and IPv6. These exclusions are the OS-level guarantee that DNS / DHCP /
mDNS / NTP / VPN packets are routed natively and never enter the proxy process
at all — the one mechanism that cannot be undone by a bug in the extension's own
code. Browser QUIC on UDP 443 is deliberately **not** excluded, so it still
reaches `handleNewFlow` to be downgraded.

## handleNewFlow: the synchronous decision

`handleNewFlow` must return synchronously and must never throw — an uncaught
error would make macOS drop the flow instead of routing it natively. It decides
in a fixed order:

1. **Self-intercept guard.** The NE captures the daemon's own outbound
   connections too. The extension reads the daemon's PID (published to
   `daemon.pid`) through `DaemonPIDFilter` and declines (`return false`) any flow
   originating from it, so the daemon's traffic routes natively and never loops
   back through the bridge.
2. **UDP flows.** A flow that is a `NEAppProxyUDPFlow` is handled by bundle:
   - a macOS system network service (mDNSResponder, configd, dhcpcd, apsd, …) is
     declined outright — a second layer behind the port exclusions, covering
     system services that use non-standard ports;
   - a bundle on the QUIC force-fallback allowlist has its UDP closed (read and
     write), which downgrades that client to TCP — `return true` because the
     flow was handled by being killed;
   - **anything else is declined** (`return false`) so macOS routes it natively.
     This is the critical safety branch: the extension never claims UDP it
     cannot relay.
3. **TCP flows.** A `NEAppProxyTCPFlow` to a host endpoint is assigned a flow id,
   its destination host taken from `remoteHostname` when present (it is nil for
   callers that pre-resolve DNS, leaving only an IP literal), and passed to the
   SNI-peek path. `handleNewFlow` returns `true` to claim it.

## The SNI peek

Callers that resolve DNS themselves (browsers, Electron apps, `curl`) hand the
NE an IP literal rather than a hostname, so the daemon's policy engine would
match no interception-domain rule and silently pass the flow through. To recover
the real hostname, the extension peeks the TLS ClientHello **before** asking for
a decision: it opens the flow, reads the first chunk, and runs `SNIParser` — a
pure-stdlib walk of the ClientHello that returns the Server Name Indication.

The peeked SNI becomes the host the daemon decides on, and is also sent to the
daemon as `flow_update_host` so the audit row carries the real hostname. The
peek is bounded by a 500 ms timeout (a `TimeoutGuard` ensures the timeout and
the read race resolve exactly once): server-speaks-first protocols (SSH, SMTP,
IMAP) never emit a ClientHello, so on timeout the flow falls through with its
original host. If `flow.open` fails, the extension resets the flow (close read
with the error, close write) so the client retries immediately instead of
hanging ~75 s on a SYN timeout — a reset is the fail-open shape for a
claimed-but-unusable flow.

## Applying the decision

The peeked host and bytes go to the daemon via `requestDecision`, and the reply
drives one of three paths:

- **deny** — the flow is closed with an error (the client sees a reset); nothing
  is relayed.
- **inspect** — the flow is redirected to the `127.0.0.1:9443` bridge: the
  extension writes the `BRIDGE` header, replays the peeked ClientHello bytes
  immediately after, then relays bidirectionally. The Go side terminates TLS and
  runs the bump pipeline. If the bridge connection or header write fails, the
  extension falls back to relaying the flow directly to the real upstream so the
  user's flow still works — inspection is lost, connectivity is not.
- **passthrough** — the flow is relayed directly to the real upstream, peeked
  bytes first.

`requestDecision` is itself fail-open: if the daemon does not answer within 2
seconds, the extension synthesizes a `passthrough` decision; if the IPC
connection drops, every pending decision callback is drained as `passthrough`,
never `deny`. A dead or slow daemon degrades to uninspected traffic, never to a
blocked network.

## The daemon side of the decision

The daemon's IPC server reads `flow_new` / `flow_closed` / `flow_update_host`
frames. For `flow_new` it applies two gates before consulting policy, each
replying `passthrough` without tracking the flow:

- **kill-switch / pause gate** — when protection is paused or the kill switch is
  engaged, the flow passes through and no audit row is written (a paused agent is
  invisible by design);
- **backpressure gate** — when the local audit queue is over its high-water mark,
  flows are shed to `passthrough` so a stalled upload pipeline never blocks the
  user's network.

Otherwise it resolves the source process from the PID, runs the policy engine
(see [agent-policy-eval-architecture.md](agent-policy-eval-architecture.md)) to
get inspect / passthrough / deny, records per-flow tracking state, and replies.
On `flow_closed` it writes a transport-level audit row **only** for
non-inspect flows — inspect flows have already produced per-HTTP-request rows
inside `BumpFlow`, so no duplicate flow-level row is written. `flow_update_host`
rewrites the tracked flow's destination host.

The shared TLS-bump pipeline that runs behind the bridge — leaf-cert minting,
HTTP parse, hooks, audit emission, and the opaque-relay fail-open fallback — is
the same engine the Linux and Windows paths use and is described in
[agent-forwarder-architecture.md](agent-forwarder-architecture.md).

## File-bridged admin configuration

Two pieces of state the extension needs on its synchronous hot path are
delivered as files the daemon writes, not as IPC pushes — a per-flow blocking
IPC round-trip would tank throughput:

- **`quic-bundles.json`** — the admin-controlled allowlist of bundle IDs whose
  QUIC the extension downgrades. The daemon writes it from the Hub-pushed
  `agent_settings` shadow value; the extension reads it with a 60 s lazy refresh,
  matches by exact bundle id or helper/child prefix (Chromium's UDP comes from
  `…Chrome.helper`, not the parent), and treats a missing or unreadable file as
  an **empty** allowlist. Empty means no UDP is killed — the deliberate fail-safe
  so a bootstrap gap or admin change never over-enforces against policy, and
  there is no hardcoded fallback list to silently override the admin.
- **`daemon.pid`** — the daemon's own PID for the self-intercept guard, refreshed
  every few seconds so a daemon restart is picked up without restarting the
  extension; a missing file disables the filter rather than false-blocking.

## Process attribution and bundle-version inventory

The extension extracts the source PID from the flow's `audit_token` (the PID
lives at a fixed offset in the token struct, avoiding a private SDK symbol). The
daemon resolves that PID to process name, path, bundle id, and owning user via
`proc.ProcessInfo`, and stamps the attribution onto every audit row.

At startup the daemon logs a bundle-version inventory of the host app, the
on-disk system extension, and the extension macOS actually loaded. macOS skips
replacing an installed system extension when the new `CFBundleVersion` does not
strictly increase, which can leave a freshly installed binary on disk while the
running provider executes the cached old code; the inventory makes that mismatch
visible in one log line.

## References

- `packages/agent/platform/darwin/NexusAgent/NexusAgentExtension/TransparentProxyProvider.swift` — the NE provider: network settings, `handleNewFlow`, SNI peek, decision application, relay loops
- `packages/agent/platform/darwin/NexusAgent/NexusAgentExtension/IPCProtocol.swift` — the `ne.sock` client, fail-open decision timeout and disconnect drain
- `packages/agent/platform/darwin/NexusAgent/NexusAgentExtension/SNIParser.swift` — the TLS ClientHello SNI extractor
- `packages/agent/platform/darwin/NexusAgent/NexusAgentExtension/QUICFallbackBundles.swift` — the `quic-bundles.json` allowlist + `TimeoutGuard`
- `packages/agent/platform/darwin/NexusAgent/NexusAgentExtension/DaemonPIDFilter.swift` — the `daemon.pid` self-intercept filter
- `packages/agent/platform/darwin/NexusAgent/NexusAgentExtension/Info.plist` — `NEProviderClasses` registration
- `packages/agent/platform/darwin/NexusAgent/NexusAgentExtension/NexusAgentExtension.entitlements` — network-extension provider entitlement
- `packages/agent/internal/platform/darwin/platform_darwin.go` — the daemon `ne.sock` server, decision gates, `StartBridge`, `flow_closed` audit
- `packages/agent/internal/platform/darwin/ne/protocol_darwin.go` — the `ne.sock` JSON message types and socket path
- `packages/agent/internal/platform/darwin/flow/state_darwin.go` — per-flow tracking state
- `packages/agent/internal/platform/darwin/proc/processmeta_darwin.go` — PID → process metadata
- `packages/agent/internal/platform/darwin/bundles/bundles_darwin.go` — the bundle-version inventory
- `packages/agent/internal/network/bridge/listener.go` — the `127.0.0.1:9443` BRIDGE-header listener
- `packages/agent/internal/network/proxy/bridge.go` — `BumpFlow`, the bridge entry into the shared TLS-bump pipeline
