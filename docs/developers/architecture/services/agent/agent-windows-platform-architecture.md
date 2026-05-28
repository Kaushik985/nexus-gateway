# Agent Windows platform

On Windows the agent captures outbound traffic two ways and prefers the stronger
one. Its first choice is **NexusWFP** — a Windows Filtering Platform kernel
driver that transparently redirects outbound connections to the agent's local
proxy. If that driver is not available, the agent falls back to a **system-proxy
CONNECT proxy**: the installer points WinINet (system proxy settings / PAC /
GPO) at the same local port, and apps reach it by speaking HTTP `CONNECT`.

Both modes terminate at one loopback listener (default `127.0.0.1:19080`) inside
the Go daemon, which resolves each connection's destination and originating
process, asks the policy engine for a decision, and inspects, passes through, or
denies. The kernel-driver internals (WFP layers, callouts, IOCTL and policy wire
formats, signing, MSI sequencing) are described in
[agent-windows-wfp-driver.md](../../agent-windows-wfp-driver.md); this document
covers the Go-side platform shim and how it drives both modes.

## Mode selection

`WindowsPlatform.Start` binds the loopback listener, then attempts to bring up
NexusWFP through the user-mode client: open the driver device, exchange a
`HELLO` IOCTL that checks the driver's protocol version, set the proxy port, and
start the audit pump. If every step succeeds the platform records
`ModeNexusWFP` and keeps the client; if any step fails it logs a warning and
records `ModeSystemProxyFallback`, continuing with the CONNECT-proxy path. The
mode is reported through `InterceptionMode` (defaulting pessimistically to the
fallback before `Start` runs, so the Dashboard never shows a false "NexusWFP"
badge).

This is the platform's fail-open posture: an absent or incompatible driver
degrades interception to the system-proxy path — apps that ignore WinINet
(Electron, custom HTTP stacks) will bypass filtering in that mode, which the
agent surfaces as a degraded state rather than breaking connectivity.

## The user-mode WFP client

`wfpClient` owns the driver device handle and the inverted-call plumbing that
turns kernel events into Go values:

- **IOCTLs.** `Start` issues `HELLO` (version handshake) and `SET_PROXY_PORT`;
  `PushPolicy` marshals the kill switch plus the process- and CIDR-bypass lists
  into the `PUSH_POLICY` body; `GetOriginalDestination` issues `GET_ORIG_DST`.
  The CTL codes and wire layouts match the driver's contract.
- **Audit pump.** A goroutine keeps a fixed depth of overlapped IOCTLs
  outstanding against the driver (inverted call), parses each completed buffer
  into `FlowAuditEvent` records, inserts the redirect events into the flow table,
  and forwards every event on a bounded channel — dropping with a counter rather
  than blocking when the channel is full.
- **Flow table.** An in-memory map from the client's local port to the original
  destination and owning PID, populated by the audit pump. It is the hot-path
  cache the proxy hits on every accepted connection; the driver remains
  authoritative, so a cache miss falls back to a `GET_ORIG_DST` IOCTL and
  back-fills the table.

## Per-connection handling

Each accepted connection runs on a bounded worker pool (a 512-slot semaphore
backpressures the accept loop). The handler first recovers the destination:

- **Transparent (NexusWFP) mode** — the connection arrived by kernel redirect,
  so the handler looks up the original destination by the client's source port
  via `GetOriginalDestination`, then peeks the TLS ClientHello (`proxy.PeekSNI`)
  to upgrade the destination from an IP literal to the SNI hostname and to
  capture the handshake bytes for replay. An unknown source port (e.g. a manual
  probe of the proxy port) is dropped so health checks don't accrue as audit
  events.
- **System-proxy (fallback) mode** — the client sends an HTTP `CONNECT`, parsed
  by `proxy.ParseCONNECT`, which returns the destination and a connection that
  replays any bytes buffered alongside the `CONNECT` line.

It then resolves the originating process: `GetExtendedTcpTable` (iphlpapi) maps
the local TCP endpoint to a PID, and `QueryFullProcessImageNameW` plus the
process token's user fill in executable path, name, and owner. The destination
and process attribution form the `InterceptedConn` the policy engine decides on.

## Applying the decision

The decision drives one of three paths, with the transparent and CONNECT modes
differing only in how they signal the client:

- **deny** — transparent mode closes the socket hard (`SetLinger(0)`) since there
  is no `CONNECT` verb to reject; CONNECT mode returns a rejection.
- **passthrough** — dial the real upstream, replay the peeked ClientHello bytes
  (transparent) or send the `CONNECT` 200 response (fallback), then relay bytes
  in both directions.
- **inspect** — hand the connection to `proxy.BumpFlow`, the shared TLS-bump
  engine (the same one the macOS and Linux paths, the compliance proxy, and the
  AI gateway use; see
  [agent-forwarder-architecture.md](agent-forwarder-architecture.md)). It
  terminates TLS, runs the hook pipeline, and emits one audit row per HTTP
  request, so the flow-level audit row below is skipped. If inspection is not
  possible — the device CA never loaded so the bridge dependencies are unwired,
  or the ClientHello peek failed on a non-TLS/server-speaks-first flow — the
  handler falls open to a plain relay and stamps `BUMP_FAILED_PASSTHROUGH` so the
  audit row records why the flow was not inspected.

For passthrough and deny flows the handler writes a single transport-level audit
row (host, port, process, decision, byte counts, duration, and the agent's own
intercept overhead). Inspect flows write nothing here because `BumpFlow` already
recorded per-request rows.

## Device CA and trust

At startup the platform loads the device CA from the state directory, or mints
and persists one if absent, and builds the TLS engine that signs per-host leaf
certificates for inspect flows. The CA is installed into the Windows Root store
(via `certutil`, idempotently) so host clients trust the intercepted TLS;
install failure is non-fatal — clients see certificate warnings but the daemon
still runs. If the state directory is not writable, the engine falls back to an
ephemeral in-memory CA.

## Shutdown

`Stop` closes the NexusWFP handle before the listener, so the kernel stops
redirecting new flows while in-flight connections drain through the still-open
listener, then waits for the worker pool to finish under a timeout.

## References

- `packages/agent/internal/platform/windows/windows_windows.go` — the platform shim: mode selection, per-connection handler, decision application, process resolution, device CA
- `packages/agent/internal/platform/windows/wfp_windows.go` — the user-mode `WFPClient` (Start/Stop/PushPolicy/GetOriginalDestination/AuditEvents)
- `packages/agent/internal/platform/windows/wfp_ioctl.go` — the DeviceIoControl wrappers for the NexusWFP IOCTLs
- `packages/agent/internal/platform/windows/wfp_policy.go` — the `PUSH_POLICY` body marshalling
- `packages/agent/internal/platform/windows/wfp_flowtable.go` — the port → original-destination cache
- `packages/agent/internal/platform/windows/wfp_audit_pump.go` — the inverted-call IRP audit pump
- `packages/agent/internal/network/proxy/proxy.go` — `PeekSNI`, `ParseCONNECT`, `Relay`, and the CONNECT response helpers
- `packages/agent/internal/network/proxy/bridge.go` — `BumpFlow`, the entry into the shared TLS-bump pipeline
- `packages/agent/internal/platform/catrust/catrust_windows.go` — device-CA install into the Windows Root store
- `docs/developers/architecture/agent-windows-wfp-driver.md` — the NexusWFP kernel driver design (WFP layers, callouts, IOCTL and policy wire formats)
