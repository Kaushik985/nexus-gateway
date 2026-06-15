# Agent auto-update

The agent keeps itself current in two ways: it always tells the operator when a
newer build is available, and — when it is given a signing key — it can
download, verify, and apply the new build itself (a whole-bundle `.pkg` install
on macOS, an in-place binary swap elsewhere). A boot-time crash-loop guard backs
the binary-swap mode by rolling back to the previous binary if a fresh install
fails to stay up. This document covers the two operating modes, the Hub
update-check contract, the auto-install lifecycle and its mandatory signature
chain, and the crash-loop rollback.

## Two operating modes

`updater.NewUpdater` decides at construction which mode the agent runs in:

- **Availability-only.** The updater polls Hub on an interval and surfaces a
  "newer build available" signal to the Dashboard, but installs nothing — the
  operator installs the new `.pkg` manually.
- **Auto-install.** In addition to the signal, the updater downloads the new
  artifact, verifies it, and applies it — a whole-bundle `.pkg` install on macOS
  (which also re-registers SMAppService + the NE), an in-place binary swap on
  other platforms.

Auto-install requires two conditions together: the updater is enabled
(`updaterEnabled`) **and** it holds an Ed25519 public key to verify the download
against. `NewUpdater` enforces this — asked to enable auto-install without a
public key, it logs a warning and forces itself back to availability-only, so an
unsigned binary can never be accepted. The wiring (`wiring.InitUpdater`)
constructs the updater from the `updaterEnabled` / `updaterCheckSec` config and
does not supply a public key, so the agent runs in availability-only mode and
the auto-install lifecycle below stays gated behind the key.

## The update-check contract

`hub.Client.CheckUpdate` issues `GET /api/internal/things/update-check` with the
agent's current version and decodes an `UpdateInfo`: whether an update is
`Available`, its `Version`, a `DownloadURL`, the expected `SHA256` and Ed25519
`Signature`, release notes, and a `ForceUpdate` flag. The agent passes its
`runtime.GOOS` to the call for call-site clarity, but the Hub update target is
keyed per-agent-type rather than per-OS, so the OS name is not sent on the wire.
Both the check and the binary download reuse the Hub client's shared mTLS +
CA-pinned HTTP transport (`HTTPClient`), so the updater inherits the same
authenticated, pinned channel as every other Hub call.

## The auto-install lifecycle

When auto-install is active, `CheckAndUpdate` runs a fixed sequence and aborts
(cleaning up the temp file) at the first failure, so a partial or unverified
download never reaches the live binary path:

1. **Check.** `CheckUpdate`; return early if nothing is available.
2. **Download** the artifact to a sibling temp file of the current executable
   over the pinned transport. On macOS the artifact is a whole-bundle `.pkg`
   (`*.update.pkg`); on other platforms it is the bare daemon binary (`*.tmp`).
3. **SHA-256 (mandatory).** Reject if the server omitted the hash or the
   computed hash disagrees.
4. **Ed25519 (mandatory).** Reject if the server omitted the signature or no
   public key is configured; otherwise verify the signature over the file hash
   against the configured public key.
5. **Apply** (`applyUpdate`, dispatched by OS):
   - **macOS — whole-bundle `.pkg` install.** Run `/usr/sbin/installer -pkg
     … -target /` **detached** (new session). The pkg replaces the entire app
     bundle — app + daemon + NE extension + the embedded SMAppService launchd
     plist — atomically. The installer's preinstall boots out the running daemon
     (this very process), which is why the install is detached so it survives;
     the postinstall re-opens the app, which re-registers SMAppService and
     re-activates the NE (with the existing reboot-pending surface when macOS
     defers the system-extension swap). The daemon comes back up on the new
     binary via SMAppService. The whole-bundle install is why a macOS update no
     longer leaves the daemon and the extension on mismatched versions.
   - **Other platforms — in-place binary swap.** Rename the current binary to a
     `.rollback` sibling, then rename the verified `.tmp` into place; on failure
     the `.rollback` is renamed back, so the agent is never left without a
     working binary.

After a non-macOS swap the running process keeps executing the old in-memory
code and stops further update checks; the new binary takes effect on the next
restart, when the service manager respawns the process. On macOS the detached
installer restarts the daemon as part of the bundle install.

## Crash-loop rollback

Independent of whether auto-install ever runs, every boot guards against a bad
binary. `WriteStartStatus` stamps the current time into a status file (a sibling
of the audit database) at startup, and `DetectCrashLoop`, run before full
startup, reads that timestamp: if the previous start was more recent than the
threshold (30 seconds) and a `.rollback` binary exists, it renames the rollback
back into place and reports the rollback. This catches an update — or any change
— that lets the agent start but not survive, reverting to the last binary that
did.

## The availability signal

`Run` and `RunWithAvailabilityCallback` are the periodic loop. The callback form
fires one immediate check on start (so the Dashboard learns about a pending
update without waiting a full interval, which defaults to one hour) and then on
every tick reports the `Available` flag through the supplied callback — wired to
the status collector's `SetUpdateAvailable`, which the menu bar and Dashboard
read to render an "update available" banner. The signal is deliberately
decoupled from the install action: availability is reported on every tick
regardless of whether auto-install is enabled, while the install path stays
behind the enabled + signature gate. Availability-check errors are logged at
debug and swallowed, so a Hub outage does not spam the agent log on each poll.

## References

- `packages/agent/internal/host/updater/updater.go` — the updater lifecycle: check, download, SHA-256 + Ed25519 verify, atomic swap, crash-loop rollback
- `packages/agent/cmd/agent/wiring/updater.go` — `InitUpdater` construction
- `packages/agent/cmd/agent/cmd_run.go` — boot-time crash-loop guard + the availability-callback wiring
- `packages/agent/internal/sync/hub/client.go` — `CheckUpdate` + the `UpdateInfo` contract + the shared mTLS transport
- `packages/agent/internal/sync/schema/config.go` — `updaterEnabled` / `updaterCheckSec` config fields
- `packages/agent/internal/sync/status/status.go` — `SetUpdateAvailable` on the status collector
