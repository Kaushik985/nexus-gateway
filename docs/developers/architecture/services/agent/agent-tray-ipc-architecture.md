# Agent tray IPC

The agent daemon runs headless (a root LaunchDaemon on macOS, a service on
Linux/Windows). The user-facing surfaces — the macOS menu-bar app, the macOS
Wails Dashboard, and the Linux/Windows tray binary — are separate, unprivileged
processes. They talk to the daemon over one local IPC channel: a line-oriented
request/response protocol on a Unix domain socket (macOS/Linux) or a named pipe
(Windows). This is the only way a UI reads the daemon's status or asks it to
pause, sign out, or quit.

## Transport

The listener is created by `platformListen`, and the path always comes from
`paths.DefaultPaths().SocketPath` (never hardcoded — see
[agent-paths-abstraction-architecture.md](agent-paths-abstraction-architecture.md)):

| platform | endpoint | access |
|----------|----------|--------|
| macOS | Unix socket `/var/run/nexus-agent-status.sock` | chmod `0666` — world-connectable |
| Linux | Unix socket under `$XDG_RUNTIME_DIR` (or `~/.nexus/`) | chmod `0600` — owner-only |
| Windows | named pipe `\\.\pipe\nexus-agent-status` | SDDL `D:P(A;;GA;;;OW)` — owner-only |

macOS is the outlier: the daemon runs as root while the UIs run in the user's
session, so the socket must be reachable across UIDs and is made
world-connectable. There is no peer-credential check on the socket; the
authorization that matters is applied per command (below). Linux and Windows
keep the endpoint owner-scoped because the daemon and the UI run as the same
user in single-user installs.

## Protocol

Each request is a single line — `COMMAND` optionally followed by `?` and a
URL-style query string — terminated by a newline. The daemon replies with a
single line of JSON and closes the connection. `dispatch` splits the line on the
first `?` into the command and its params, then routes on the command.

```
GET_STATUS\n                          → {"state":"active", ...}\n
PAUSE_PROTECTION?seconds=900\n         → {"paused":true,"resumes_at":"..."}\n
EVENT_BY_ID?id=evt-123\n               → {"event":{ ... }}\n
```

No framing beyond the newline, no streaming, no persistent session: a client
opens a connection per call, writes one line, reads one line, closes. That keeps
every client (Go, Swift, JavaScript) trivial and lets a UI poll on a ticker
without serialising user clicks.

## Server

`Server.Start` listens and runs an accept loop. Each accepted connection is
handled on its own goroutine, but the number of concurrent handlers is capped
(`statusapiMaxConcurrent`); once the cap is reached the daemon closes new
connections immediately so a stuck or hostile client cannot pin every goroutine.
`handleConn` reads the request line, calls `dispatch`, and writes the JSON reply.

Handlers are injected as function fields, most through optional `Set…Fn` setters;
a command whose handler was never wired returns a `"… not configured"`
placeholder rather than erroring, so a minimal build (tests, headless harness)
serves the read-only commands and degrades the rest gracefully.

## Command surface

| read-only | what it returns |
|-----------|-----------------|
| `GET_STATUS` | the status snapshot (state, agent info, today's stats, recent events, pause state, quit policy, shutdown warning) |
| `QUERY_EVENTS` / `EVENT_BY_ID` | the Traffic list page (metadata) / one event's full detail incl. body + normalized |
| `QUERY_LIFECYCLE_EVENTS` | the Activity timeline |
| `QUERY_STATS` | rolled-up metric series |
| `GET_APPLIED_CONFIG` | the admin-pushed config snapshot the device is honouring |
| `GET_DIAGNOSTICS` / `GET_RUNTIME` / `VERSION` / `CHECK_UPDATE` | diagnostics, runtime introspection, version, update availability |

| state-changing | effect |
|----------------|--------|
| `SHUTDOWN` | graceful daemon exit (the immediate stop; the GUI pairs it with the user-quit flag for persistence) |
| `PAUSE_PROTECTION` / `RESUME_PROTECTION` | temporarily disable / re-enable enforcement |
| `UNENROLL` | clear local enrollment + restart into onboarding |
| `AUTHENTICATE` / `AUTHENTICATE CONFIRM` / `AUTHENTICATE CANCEL` / `ENROLL_TOKEN` | SSO / token enrollment flows |
| `SYNC_CONFIG` / `REFRESH_POLICIES` | pull fresh config / policies from Hub now |
| `OPEN_BROWSER` / `REPORT_PROXY_INSTALL` | open a URL in the user's browser / report a proxy-install outcome |

## Authorization and security

Because the macOS socket is world-connectable, the commands that would stop or
suspend the agent are gated at the authorization layer rather than relying on
socket permissions. `SHUTDOWN`, `PAUSE_PROTECTION`, and `UNENROLL` all check the
admin `quitAllowed` policy (via `quitAllowedFn`): when the operator has disabled
quit, each returns a `"… disabled by policy"` status and does nothing. When quit
is allowed — the default — all three work normally and a shutdown gracefully
exits the daemon. (`SHUTDOWN` performs the immediate exit only; keeping the
daemon down across an OS respawn is the separate user-quit-flag mechanism the
GUI writes — see
[agent-paths-abstraction-architecture.md](agent-paths-abstraction-architecture.md).)
Gating at this layer means the policy holds on every platform regardless of
socket mode.

The user-facing explanation is kept out of the IPC layer: the daemon ships the
`quitAllowed` flag and the per-locale `shutdownWarning` text in the `GET_STATUS`
snapshot, and the UI decides what to show. The IPC error strings are
machine-readable status, not display copy.

The read-only commands are not authorization-gated, so on a multi-user macOS
host any local user that can reach the socket can read the snapshot, traffic
events, and applied config; a peer-credential (`LOCAL_PEERCRED`) or group-ACL
transport check is the remaining hardening for multi-user installs.

## Clients

Three clients speak the same protocol, each shaped for its host:

- **macOS menu-bar app** — the Swift `StatusClient`, part of the `NexusAgentUI`
  app target.
- **macOS Dashboard** — the Wails `AgentBridge`, which shuttles the raw JSON
  shapes to the React frontend as `map[string]any`.
- **Linux / Windows tray** — the Go `trayipc.Client`, which decodes into small
  typed structs (`Snapshot`, `PauseResponse`, `ShutdownResponse`) so the tray
  binary stays free of the React frontend and the full agent runtime. It dials
  with a bounded timeout (falling back to 5s) and resolves the socket path from
  `paths.DefaultPaths().SocketPath`, the same value the daemon listens on.

## References

- `packages/agent/internal/sync/status/statusapi_server.go` — the dispatch table, command handlers, accept loop, and concurrency cap
- `packages/agent/internal/sync/status/statusapi_listen_other.go` — Unix socket listener + macOS `0666` / default `0600` mode
- `packages/agent/internal/sync/status/statusapi_listen_windows.go` — named pipe listener + owner-only SDDL
- `packages/agent/internal/sync/status/status.go` — the `StatusSnapshot` the `GET_STATUS` command returns (incl. `quitAllowed` + `shutdownWarning`)
- `packages/agent/cmd/agent/status_ipc.go` — wires the daemon's handlers onto the server
- `packages/agent/internal/host/trayipc/client.go` — the Go tray client
- `packages/agent/ui/bridge.go` — the Wails Dashboard bridge
- `packages/agent/platform/darwin/NexusAgentUI/Sources/IPC/StatusClient.swift` — the macOS menu-bar client
