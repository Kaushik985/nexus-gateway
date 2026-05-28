# Agent Linux platform

On Linux the agent captures outbound traffic with a transparent proxy: an
iptables `REDIRECT` rule in the `nat` table sends outbound TCP to a local
listener (default `127.0.0.1:19080`) inside the Go daemon. The daemon recovers
each connection's real destination with `SO_ORIGINAL_DST`, attributes the
originating process through `/proc`, asks the policy engine for a decision, and
inspects, passes through, or denies. Interception runs in `ModeIPTables`.

Two pieces make the transparent redirect safe and durable: an `SO_MARK` on the
agent's own sockets keeps its egress out of its own redirect (no self-loop), and
a reconciler keeps the iptables chain healed against anything else on the host
that rewrites netfilter (firewalld, ufw, a manual flush).

## The NEXUS_AGENT chain

All redirect logic lives in a dedicated `nat`-table chain, `NEXUS_AGENT`, hooked
from `OUTPUT` by a single `-j NEXUS_AGENT` jump. The chain holds three rules in
order:

1. `-m mark --mark 0x4e58 -j RETURN` — traffic the agent itself originated
   (stamped with `SO_MARK`) returns immediately, never redirected.
2. `-d 127.0.0.0/8 -j RETURN` (IPv4) or `-d ::1/128 -j RETURN` (IPv6) — loopback
   is left alone.
3. `-p tcp -j REDIRECT --to-ports <proxy port>` — everything else is redirected
   to the local listener.

The chain is maintained for both families: `iptables` for IPv4 and `ip6tables`
for IPv6, which are present even on nft-only distributions as the `iptables-nft`
compatibility shim.

## The reconciler

`Reconciler` keeps kernel netfilter state matching that canonical rule set. Its
`Start` performs the first install synchronously — so a successful return means
capture is live — and a failed first install is fatal to the daemon's startup,
because without the chain no traffic reaches the proxy. It then runs a 5-second
drift loop: each tick dumps the live chain (`iptables -t nat -S`), compares it
line-by-line against the canonical rules, and on drift (or first install)
re-applies the whole chain through `iptables-restore --noflush` — a single
atomic transaction that touches only `NEXUS_AGENT` and leaves firewalld's,
Docker's, and the user's chains intact. The `OUTPUT` hook is re-asserted
idempotently every tick. First install logs at info; later drift logs at warn
(a signal that something on the host interfered).

`Stop` tears the chain down idempotently in both families — unhook from
`OUTPUT`, flush, delete — best-effort so a partial or already-removed state does
not error. The systemd unit carries an `ExecStopPost` cleanup as a safety net
for the case where the daemon dies before its own teardown runs.

## SO_MARK loop avoidance

Every socket the agent opens for its own egress — the MITM upstream dialer and
all the agent's outbound HTTP clients (enrollment, relay, updater, the
thingclient HTTP fallback) — is stamped with `SO_MARK` `0x4e58` ("NX") via the
dialer's `Control` callback, before `connect`. The agent's HTTP transports pick
this up through a global dial-control hook the Linux build installs at startup.
The `NEXUS_AGENT` chain's first rule returns marked traffic, so the proxy's own
upstream connections are never caught by the redirect that would otherwise loop
them back into the proxy. The mark is identification, not a secret — it carries
no security property, only loop avoidance.

## Per-connection handling

Each redirected connection is accepted on a bounded worker pool (a 512-slot
semaphore backpressures the accept loop) and handled as follows:

- **Original destination.** `getsockopt(SO_ORIGINAL_DST)` on the redirected
  socket recovers the IP and port the client actually dialed (the listener only
  sees the redirect target otherwise).
- **Hostname.** `proxy.PeekSNI` peeks the TLS ClientHello to upgrade the
  destination from an IP literal to the SNI hostname and to capture the
  handshake bytes for replay; a flow with no SNI keeps the IP.
- **Process.** The owning PID is found by matching the socket's local/remote
  address in `/proc/net/tcp` to a socket inode, then scanning `/proc/<pid>/fd`
  for that inode (a short-lived inode→PID cache avoids the full scan on every
  connection). `/proc/<pid>/{exe,comm,status}` then give the executable path,
  name, and owning user.

The destination and process attribution form the `InterceptedConn` the policy
engine decides on.

## Applying the decision

- **deny** — the client socket is closed hard (`SetLinger(0)`).
- **passthrough** — dial the real upstream through the `SO_MARK`-stamped dialer
  (so the upstream connection escapes the redirect), replay the peeked
  ClientHello bytes, then relay both directions.
- **inspect** — hand the connection to `proxy.BumpFlow`, the shared TLS-bump
  engine the macOS and Windows paths, the compliance proxy, and the AI gateway
  all use (see
  [agent-forwarder-architecture.md](agent-forwarder-architecture.md)). It
  terminates TLS, runs the hook pipeline, and emits one audit row per HTTP
  request. If inspection is not possible — the device CA never loaded so the
  bridge dependencies are unwired, or the ClientHello peek failed on a
  non-TLS / server-speaks-first flow — the handler falls open to a plain relay
  and stamps `BUMP_FAILED_PASSTHROUGH`.

Passthrough and deny flows write one transport-level audit row (destination,
process, decision, byte counts, duration, and the agent's own intercept
overhead). Inspect flows write nothing here because `BumpFlow` already recorded
per-request rows.

## Device CA and trust

The platform loads the device CA from the state directory and builds the TLS
engine that signs per-host leaf certificates for inspect flows. On a packaged
install the post-install script runs `nexus-agent install-ca` as root, which
generates and persists the CA under the state directory and installs it into the
OS trust store (`update-ca-certificates`), so host clients trust the intercepted
TLS. When the on-disk CA path is unreadable or unwritable — an unprivileged dev
run, or an install where the post-install step did not run as root — the engine
falls back to an ephemeral in-memory CA, and intercepted TLS is untrusted until
the CA is installed properly.

## Shutdown

`Stop` removes the iptables chain before closing the listener, so the kernel
stops redirecting new connections while in-flight ones still drain through the
open listener, then waits for the worker pool to finish under a timeout.

## References

- `packages/agent/internal/platform/linux/linux_linux.go` — the platform shim: listener, per-connection handler, `SO_ORIGINAL_DST`, `/proc` process resolution, decision application, device CA
- `packages/agent/internal/platform/linux/reconciler_linux.go` — the self-healing chain reconciler (canonical rules, drift detection, teardown)
- `packages/agent/internal/platform/linux/iptables_linux.go` — the `iptables` / `ip6tables` wrappers (`iptables-restore`, dump, hook, remove)
- `packages/agent/internal/platform/linux/marker_linux.go` — `SO_MARK` stamping (`markControl`, `MarkedDialer`, `MarkedTransport`)
- `packages/agent/internal/network/proxy/proxy.go` — `PeekSNI` and `Relay`
- `packages/agent/internal/network/proxy/bridge.go` — `BumpFlow`, the entry into the shared TLS-bump pipeline
- `packages/shared/transport/http` — the global dial-control hook the agent's HTTP clients consult for `SO_MARK`
