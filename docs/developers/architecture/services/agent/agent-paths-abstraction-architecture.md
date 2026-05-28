# Agent filesystem-path abstraction

The agent runs as a root-owned daemon on three operating systems, each with its
own convention for where system software keeps state, config, logs, and IPC
endpoints. `packages/agent/internal/platform/paths` is the single place that
knows those conventions: every filesystem location the agent reads or writes is
resolved through it, so no other package hardcodes an OS path. A path that is
wrong for the OS — or that a GUI process cannot reach across the daemon's
privilege boundary — is a class of bug this package exists to prevent.

## The contract

`paths.Paths` is a flat struct of absolute locations, and `paths.DefaultPaths()`
returns the one populated for the current OS:

| field | what lives there |
|-------|------------------|
| `StateDir` | runtime state the daemon owns: device cert + key, the gateway CA, device-id / thing-id / device-token, the SQLCipher-encrypted audit queue, and the spill directory for oversize captured bodies |
| `ConfigDir` / `ConfigFile` | `agent.yaml` (the daemon's boot config) |
| `LogDir` | the structured slog JSON log file |
| `SocketPath` | the IPC endpoint the daemon listens on for the menu-bar UI's status queries |
| `FlagsDir` / `UserQuitFlagPath` | user-writable signal files the unprivileged GUI sets to signal intent to the root daemon |
| `DaemonUnitPath` | where the OS process supervisor expects the daemon's launch configuration |

`DefaultPaths` is a package-level variable assigned the per-OS `defaultPaths`
function. The implementation is selected at compile time by build tags —
`paths_darwin.go`, `paths_linux.go`, `paths_windows.go` each carry a
`//go:build <goos>` constraint and define `defaultPaths()` — so the binary for a
given platform links exactly one implementation and callers never branch on
`runtime.GOOS` themselves.

## Per-OS layout

Each platform follows its native convention rather than a lowest-common-denominator
scheme:

| field | macOS (Apple File System Programming Guide) | Linux (FHS 3.0) | Windows (Application Data) |
|-------|------|-------|---------|
| `StateDir` | `/Library/Application Support/com.nexus-gateway.agent` | `/var/lib/nexus-agent` | `%ProgramData%\NexusAgent` |
| `ConfigDir` | = `StateDir` (one bundle dir per app) | `/etc/nexus-agent` | = `StateDir` |
| `LogDir` | `/Library/Logs/com.nexus-gateway.agent` | `/var/log/nexus-agent` | `%ProgramData%\NexusAgent\Logs` |
| `SocketPath` | `/var/run/nexus-agent-status.sock` | per-user runtime socket (see below) | `\\.\pipe\nexus-agent-status` |
| `DaemonUnitPath` | `/Library/LaunchDaemons/com.nexus-gateway.agent.plist` | `/etc/systemd/system/nexus-agent.service` | the service executable path (SCM has no on-disk unit) |

macOS keys everything off the reverse-DNS bundle identifier
`com.nexus-gateway.agent`; Linux off the package name `nexus-agent`; Windows off
`%ProgramData%` (falling back to `C:\ProgramData` when the environment variable
is unset) under the `NexusAgent` application directory.

### Linux IPC socket — per-user, with a fallback chain

macOS and Windows use a single system-wide IPC endpoint, but the Linux daemon
and tray UI run as the same logged-in user (v1 ships single-user installs), so
the socket lives in a per-user runtime location resolved in order: the
systemd-logind-provisioned `$XDG_RUNTIME_DIR`; else `~/.nexus/agent-status.sock`
(creating `~/.nexus` at mode `0700`); else `/tmp/nexus-agent-status.sock` as a
last resort when the home directory is unreadable.

## The privilege boundary: StateDir vs FlagsDir

The daemon runs privileged and owns `StateDir`, but the menu-bar UI runs as the
unprivileged logged-in user and cannot write there. `FlagsDir` is the crossing
point: a subdirectory the installer creates world-writable so the GUI can drop —
and later clear — small signal files the daemon watches. The macOS installer's
post-install step sets `StateDir` to mode `0755` (daemon-owned) and
`StateDir/flags` to mode `0777` with no sticky bit, precisely so the GUI can both
create and delete files inside it.

The one signal file today is `UserQuitFlagPath` (`FlagsDir/user-quit`): the GUI
writes it to tell the daemon to self-exit — and to keep self-exiting on every
supervisor respawn — until the GUI clears it on its next launch. Because the
daemon and the GUI resolve the same path through `DefaultPaths`, the daemon's
flag-watcher and the GUI's quit helper agree without duplicating the literal.
The macOS GUI is a separate Swift target (`NexusAgentUI`), so this handshake is
the contract that lets two separately-built processes coordinate through the
filesystem.

The IPC socket carries the same boundary concern: on macOS the daemon places the
status socket under `/var/run` and chmods it `0666` so any logged-in user's tray
binary can connect to the root daemon; the per-user socket on Linux stays `0600`
(owner-only). The socket mode is applied by the listen helper, not the path
package — `paths` only decides *where* the socket lives.

## Who resolves paths through it

`DefaultPaths()` is the sole path source across the agent: the config loader
fills blank `agent.yaml` fields (cert / key / CA / audit-DB / log) from it so a
config only needs to override exceptions; enrollment writes the issued device
cert + key into `StateDir` so the daemon picks them up without a manual copy; the
audit/spill subsystem roots the SQLCipher queue and the encrypted spill directory
under `StateDir`; the keystore, the CA-install helpers, and the status-socket
wiring all read their locations from it; and the Swift GUI's quit handshake reads
`UserQuitFlagPath`. Installer scripts (pkg layout, launchd plist, uninstaller
targets) target the same locations.

## References

- `packages/agent/internal/platform/paths/paths.go` — the `Paths` struct + the `DefaultPaths` variable
- `packages/agent/internal/platform/paths/paths_darwin.go` — macOS layout (`com.nexus-gateway.agent` bundle id)
- `packages/agent/internal/platform/paths/paths_linux.go` — Linux FHS layout + the per-user socket fallback chain
- `packages/agent/internal/platform/paths/paths_windows.go` — Windows `%ProgramData%` layout
- `packages/agent/platform/darwin/installer/postinstall.sh` — the `StateDir` `0755` / `flags` `0777` mode setup
- `packages/agent/cmd/agent/wiring/helpers.go` — `UserQuitFlagPath` accessor wrapping `DefaultPaths`
- `packages/agent/cmd/agent/cmd_run.go` — the user-quit boot check + `startQuitFlagWatcher`
- `packages/agent/cmd/agent/cmd_enroll.go` — enrollment cert directory resolved from `DefaultPaths().StateDir`
- `packages/agent/internal/sync/status/statusapi_listen_other.go` — the macOS `0666` / default `0600` socket mode
- `packages/agent/platform/darwin/NexusAgentUI/Sources/App/QuitFlag.swift` — the GUI side of the quit-flag handshake
