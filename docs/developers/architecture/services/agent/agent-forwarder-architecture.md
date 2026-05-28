# Agent Forwarder Architecture

The forwarder is the agent's shared network path: it takes a flow the OS
interception layer captured, asks the policy engine what to do with it, and
then either terminates TLS and inspects it, relays it untouched, or refuses
it. The per-OS capture mechanisms differ (macOS Network Extension, Linux
iptables REDIRECT, Windows WFP) and live in the per-platform docs; this doc
covers the platform-agnostic forward/inspect/audit machinery they all feed
into.

Scope: `packages/agent/internal/network/**` (the `proxy`, `bridge`, and
`tls` packages) plus the platform dispatch glue in
`packages/agent/internal/platform/**` and `packages/agent/cmd/agent/**`. The
actual TLS-bump engine is shared (`packages/shared/transport/tlsbump`) and is
described where it is owned; here we cover how the agent drives it.

See also [agent-architecture.md](./agent-architecture.md) for the service
overview and [agent-ne-fail-open-architecture.md](./agent-ne-fail-open-architecture.md)
for the macOS Network Extension safety rules.

## 1. The OS-abstraction boundary

`packages/agent/internal/platform/api` defines the contract every platform
shim implements:

- **`Platform`** — `Start(ctx, handler)` / `Stop()` / `ProcessInfo(pid)`.
  The shim captures flows from the OS and calls back into a
  `ConnectionHandler`.
- **`ConnectionHandler.HandleConnection(InterceptedConn) Decision`** — the
  per-flow decision callback. `InterceptedConn` carries the flow id, the
  source/destination addresses, the SNI hostname (when known), and the
  originating `ProcessMeta`.
- **`Decision`** — `DecisionInspect`, `DecisionPassthrough`, or
  `DecisionDeny`. The agent's `ConnectionBridge`
  (`packages/agent/cmd/agent/wiring`) implements `ConnectionHandler` by
  consulting the policy engine.
- **`BridgeDepsReceiver.SetBridgeDeps(*proxy.BridgeDeps)`** — the optional
  interface a platform satisfies when its inspect path runs through
  `proxy.BumpFlow`. All three platforms satisfy it; `cmd_run` builds one
  cross-platform `proxy.BridgeDeps` and hands it to the platform once at
  boot.
- **`FlowAuditor.OnFlowComplete(FlowResult)`** — the optional flow-level
  audit callback the platform invokes after a non-bumped flow finishes.

`InterceptionMode` (`ModeNETransparentProxy`, `ModeIPTables`, `ModeNexusWFP`,
`ModeSystemProxyFallback`) and `InterceptionHealth` let the status collector
surface which capture mechanism is active and whether it is attached, so the
tray turns yellow when capture is silently down.

## 2. The three decisions

After `HandleConnection` returns a `Decision`, the platform shim
(`linux_linux.go`, `windows_windows.go`, and the macOS bridge handler) acts
on it:

- **`DecisionDeny`** — the connection is refused. On a transparent path the
  shim hard-closes (`SetLinger(0)`) so the client's handshake never
  completes; on an explicit-proxy path it returns `403` via
  `proxy.RejectCONNECT`.
- **`DecisionPassthrough`** — the shim dials the upstream and runs a plain
  bidirectional byte relay (`proxy.Relay`) with no TLS termination. Any
  ClientHello bytes already peeked off the client socket are replayed to the
  upstream first so it sees a complete handshake. On Linux the upstream dial
  uses the `SO_MARK`-stamped dialer so the agent's own egress is excluded
  from the REDIRECT chain.
- **`DecisionInspect`** — the shim hands the flow to `proxy.BumpFlow` for TLS
  termination and inspection (Section 3). If the bridge dependencies are not
  wired or the TLS ClientHello peek failed, it fails open to a plain relay
  and stamps `BumpStatus = "BUMP_FAILED_PASSTHROUGH"`.

`proxy/proxy.go` provides the transport primitives shared across these
branches: `Relay` (bidirectional copy with half-close), `PeekSNI` /
`ExtractSNI` (read the ClientHello to recover the SNI without consuming it),
`ReplayConn` (replay peeked bytes back through the real handshake), and
`ParseCONNECT` / `RespondCONNECT` / `RejectCONNECT` (HTTP CONNECT framing for
the explicit-proxy path).

## 3. The inspect path: `BumpFlow`

`proxy.BumpFlow` (`packages/agent/internal/network/proxy/bridge.go`) is the
single entry point for inspect-mode flows on every platform. It hands the
flow to `tlsbump.BumpConnection` — the same TLS-bump engine the compliance
proxy and the AI gateway use.

`BumpFlow` validates its dependencies (`TLSEngine`, `Upstream`, `AuditQueue`
must be non-nil), then:

1. **Port filter.** TLS-bump only makes sense on TLS ports. A flow whose
   destination port is not `443` or `8443` (e.g. an over-broad inspect rule
   that matched a host then caught a `git push` over SSH) is opaque-relayed
   rather than failed (Section 4).
2. **Mint a hostname-only leaf cert.** `tls.Engine.IssueLeafCertByHostname`
   signs a leaf with `CN = SAN = {hostname}`, 24h validity, signed by the
   device CA. The device CA is in the OS trust store, so local HTTPS clients
   accept the leaf. No probe of the upstream's real certificate is needed —
   clients only validate the SAN against the host they connected to, which is
   what the leaf sets. Skipping the probe lets strict-anti-bot upstreams
   (which reject vanilla Go TLS dials) flow through the bump pipeline. The
   minted cert is served by a static `GetCertificate` callback
   (`staticCertGetter`); there is no per-ClientHello probe.
3. **Build the bump options and delegate.** `BumpFlow` wires an
   `AuditEmitter` to the agent's local SQLite `AuditQueue` and calls
   `tlsbump.BumpConnection(ctx, conn, dstHost, getCert, Upstream, logger,
   bumpOpts...)`. The options carry the agent identity (`WithIdentity`), the
   originating process (`WithProcessInfo`), the compliance pipeline
   (`WithCompliance` — the `PolicyResolver`, audit emitter, and per-hook/total
   timeouts), the live streaming-mode store
   (`WithStreamingPolicyStore`), and the payload-capture / adapter-registry /
   domain-engine / normalize-registry hooks. `BumpConnection` then terminates
   client TLS, runs the hook pipeline on the decrypted HTTP, re-encrypts to
   the upstream, and emits one audit row per HTTP request.

### BridgeDeps construction

`proxy.BridgeDeps` bundles everything `BumpFlow` needs, built once per process
after the agent's config settles. There are two construction sites:

- **Linux / Windows** — `wiring.BuildBridgeDeps`
  (`packages/agent/cmd/agent/wiring/bridgedeps.go`) loads-or-generates the
  device CA, builds the `tlsbump.UpstreamTransport` (wiring the attestation
  injector when present), opens the local spill store, and binds the policy
  resolver / domain engine / adapter registry from the agent pipeline. A nil
  pipeline or a CA / transport failure leaves the inspect path unwired so
  flows fall through to passthrough (fail-open). `cmd_run` then calls
  `SetBridgeDeps` on the platform.
- **macOS** — `platformshim.WireDarwinBridge`
  (`packages/agent/cmd/agent/platformshim/wire_bridge_darwin.go`) loads the
  device CA via `DarwinPlatform.LoadTLSEngineFromDisk`, builds the upstream
  transport, assembles the `BridgeDeps`, calls `SetBridgeDeps`, and starts the
  loopback listener (Section 6).

The upstream transport (`tlsbump.UpstreamTransport`, built via
`tlsbump.NewUpstreamTransportWith`) optionally carries a `RequestInjector`.
When an attestation signer is wired, every outbound HTTPS request through the
bump path gets the `X-Nexus-Attestation` header injected; the injector is
fail-open (a signer error omits the header but never aborts the request).

## 4. Fail-open: `opaqueRelay`

`opaqueRelay` (`proxy/bridge.go`) shuttles bytes between client and upstream
without TLS termination. It is the fail-open fallback that keeps the user's
flow working when inspection is not possible. It fires in three cases:

1. **Non-TLS destination port** — a flow on a port other than `443` / `8443`.
2. **Leaf mint failure** — defense-in-depth if the device CA is corrupted.
3. **Bump failure** — `tlsbump.BumpConnection` returned an error.
   `classifyBumpFailureStage` maps the error to a coarse stage for the log —
   `client_pin_check` (a cert-pinning client rejected the minted leaf at its
   own handshake), `upstream_not_tls` (the upstream presented a non-TLS first
   record), `upstream_utls_dial` (the uTLS dial to the upstream failed), or
   `unknown`. The stage is a diagnostic signal only; **every** bump error
   falls back to `opaqueRelay` regardless of stage, because a user-visible
   silent breakage (a cert-pinning app that can never be bumped) outranks
   HTTP-level visibility on a single flow.

The fallback trades HTTP-level audit (headers, body, hooks) for raw TCP
relay; the destination host:port and byte counts are still captured. The
upstream dialer is the `opaqueDialContext` package variable, swapped in tests
for an in-memory fake so the relay paths exercise without binding sockets.

## 5. The audit model

Inspect and non-inspect flows audit on two different paths, and the agent is
careful never to write both for one flow:

- **Inspect (bumped) flows audit per HTTP request.** Inside
  `tlsbump.BumpConnection`, the `AuditEmitter` calls the agent's
  `loggingQueueWriter`, which wraps `auditqueue.NewQueueWriter(AuditQueue)`
  and logs one INFO line per emit (host, method, path, classification
  inputs, provider, model) before writing the SQLite row. A single bumped TLS
  connection therefore produces N audit rows — one per request — each
  carrying the decrypted-HTTP detail (method, path, hook decision, provider,
  model, tokens, bodies). The originating process name/bundle/user, passed in
  via `WithProcessInfo`, is stamped onto every row so the admin UI's App
  column populates for inspect traffic.
- **Non-inspect flows audit once, at flow completion.** `DecisionDeny`,
  `DecisionPassthrough`, and the inspect-fallback path call
  `FlowAuditor.OnFlowComplete(FlowResult)` exactly once. The platform shim
  guards this with a `bumpedViaTLSBump` flag: a flow that went through
  `BumpFlow` skips `OnFlowComplete` so it is not double-audited.

Because a `FlowResult` is produced only for non-bumped flows, it carries only
what the transport layer observes without decrypting HTTP — flow id,
addresses, process, decision, bytes, duration, bump status, and (on macOS,
from the Swift `flow_closed` message) upstream TTFB/total and the
`intercept_ms` latency breakdown. It has no method/path/provider/hook fields;
those exist only on the per-request inspect rows.
`ConnectionBridge.OnFlowComplete`
(`packages/agent/cmd/agent/wiring/bridge_audit.go`) maps the `FlowResult` to
an `audit.Event`, deriving the error code (`POLICY_DENIED` for deny,
`BUMP_FAILED` for the inspect-fallback) and resolving the matched policy rule
id from the per-flow `policyResults` map. The `TraceID` equals the flow id so
events this flow generates downstream (compliance proxy, AI gateway) join
across services.

Upstream timing on the bumped path is measured inside `tlsbump` per HTTP
request (a per-request `PhaseSink` records TTFB and total) and lands on the
per-request rows; the flow-level `UpstreamTtfbMs` / `UpstreamTotalMs` fields
are populated only on the macOS non-bumped path, where the Swift side
surfaces them. A Linux/Windows raw relay has no distinct upstream call to
time, so it leaves them nil.

## 6. macOS Network Extension bridge

On macOS the `NETransparentProxyProvider` observes flows but does not
terminate TLS itself. The `bridge` package
(`packages/agent/internal/network/bridge`) closes that gap: the daemon
listens on a loopback TCP port (default `127.0.0.1:9443`), and Swift NE
redirects each flow it decides to inspect to that port instead of the real
upstream, prefixing the connection with a single-line text header:

```
BRIDGE <host>:<port> <flowId>\n
```

`bridge.Listener` parses the header (`parseHeader` accepts DNS names and
bracketed IPv6 literals), drains any peeked ClientHello bytes, and invokes the
registered `HandleFunc` — `DarwinPlatform.handleBridgeFlow`, a thin dispatcher
into `proxy.BumpFlow`. Binding is loopback-only so the bump endpoint is
invisible off-host. If the listener cannot accept, Swift NE's redirect connect
fails and Swift falls back to its raw-relay path with the row stamped
`BUMP_FAILED_PASSTHROUGH` — the flow still reaches its destination. The NE
provider's fail-open rules (it sits in the host's packet path) are covered in
[agent-ne-fail-open-architecture.md](./agent-ne-fail-open-architecture.md);
the per-platform capture mechanisms are in
[agent-macos-platform-architecture.md](./agent-macos-platform-architecture.md),
[agent-linux-platform-architecture.md](./agent-linux-platform-architecture.md),
and [agent-windows-platform-architecture.md](./agent-windows-platform-architecture.md).

## 7. Device CA and leaf certificates

`tls.Engine` (`packages/agent/internal/network/tls`) owns the device CA and
mints leaf certificates. `LoadOrGenerateCA` loads the CA from disk when both
the cert (mode 0644 — the CA cert is public by design) and key (mode 0600)
exist, otherwise generates a fresh self-signed CA and persists it; the
privileged install step creates it once so the runtime daemon never needs
write access at runtime. `IssueLeafCertByHostname` mints (and caches, keyed by
hostname with a bounded LRU that evicts the oldest 25% when full) the
hostname-only leaves the bump path serves. The hook pipeline that runs on the
decrypted HTTP is the same compliance pipeline the proxy uses — see
[compliance-pipeline-architecture.md](../compliance-proxy/compliance-pipeline-architecture.md)
and, for the provider adapters that classify traffic,
[provider-adapter-architecture.md](../ai-gateway/provider-adapter-architecture.md).

The audit-upload queue that ferries the rows written here to the Hub is
covered in
[agent-observability-architecture.md](./agent-observability-architecture.md).

## References

- `packages/agent/internal/network/proxy/proxy.go` — transport primitives (Relay, PeekSNI, ParseCONNECT, opaqueRelay)
- `packages/agent/internal/network/proxy/bridge.go` — BumpFlow, BridgeDeps, opaqueRelay, classifyBumpFailureStage
- `packages/agent/internal/network/bridge/listener.go` — macOS NE loopback listener + BRIDGE header parsing
- `packages/agent/internal/network/tls/engine.go` — device CA + hostname-only leaf minting
- `packages/agent/internal/platform/api/api.go` — Platform / ConnectionHandler / Decision / BridgeDepsReceiver / FlowAuditor / FlowResult
- `packages/agent/cmd/agent/wiring/bridgedeps.go` — Linux/Windows BridgeDeps construction
- `packages/agent/cmd/agent/platformshim/wire_bridge_darwin.go` — macOS BridgeDeps construction + listener start
- `packages/agent/cmd/agent/wiring/bridge_audit.go` — flow-level OnFlowComplete → audit.Event
- `packages/agent/internal/platform/linux/linux_linux.go`, `windows/windows_windows.go`, `darwin/platform_darwin.go` — per-platform decision dispatch
- `packages/shared/transport/tlsbump` — the shared TLS-bump engine BumpFlow delegates to
