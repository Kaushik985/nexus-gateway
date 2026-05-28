# Agent secret storage

The agent holds two classes of secret on the device: the **SQLCipher database
key** that encrypts the audit queue at rest, and **session/identity secrets**
(enrollment refresh tokens, session ids, the clock offset). Two packages own
these, each with a different scope and backing strategy:

- `internal/identity/keystore` — the device-bound DB key. A minimal
  get/set/delete `Store` over the OS's per-user secret facility.
- `internal/identity/secretstore` — the session secrets. A richer `Store`
  (it is `Close`-able) that prefers the OS-native vault and falls back to a
  self-encrypting file when that vault is unavailable.

## keystore — the at-rest encryption root

`keystore.GetOrCreateDBKey` returns a 32-byte (AES-256) key, generating a fresh
random one via `crypto/rand` and persisting it on first run. This key is the
root of the agent's at-rest encryption: the SQLCipher audit database is opened
with it, and the local spill store derives its own AES-256-GCM key from it
(domain-separated), so anything the agent persists locally traces back to this
one device-bound secret.

The `Store` interface is deliberately small — `Get` / `Set` / `Delete` — and
`NewPlatformStore` returns the implementation compiled in for the OS:

| platform | backend | protection |
|----------|---------|------------|
| macOS | Keychain via Security.framework (`go-keychain`) | a generic-password item under service `com.nexus-gateway.agent`, marked `AccessibleWhenUnlockedThisDeviceOnly` and non-synchronizable (device-bound, never iCloud-synced) |
| Linux | a base64 file at `~/.nexus/secrets/<key>.key`, mode `0600` | filesystem ACL only — any process with the same UID can read it; the package documents TPM2 / a secrets manager as the production upgrade path |
| Windows | DPAPI (`CryptProtectData`) blob, base64 at `~/.nexus/secrets/<key>.dpapi`, mode `0600` | user-bound OS encryption |

The macOS path uses the framework directly rather than shelling out to the
`security` CLI, which would expose the key on the process argument list. On a
missing item every backend returns a nil value (treated as "generate a new
key"), not an error.

## secretstore — session and identity secrets

`secretstore` persists the values the enrollment and SSO flows and the clock-skew
tracker produce. Its `Store` adds `Close` because the native-vault handles are
stateful. `Open` picks the strongest backend available and transparently falls
back to an encrypted file otherwise:

| platform | preferred vault | fallback trigger |
|----------|-----------------|------------------|
| macOS | Keychain | the framework constructor failing (does not happen on real hosts) |
| Linux | Secret Service (libsecret over D-Bus — gnome-keyring / KWallet) | no session bus (headless hosts, systemd services without a user session) |
| Windows | Credential Manager (DPAPI-backed generic credentials) | the vault being unreachable (e.g. a service-account logon with no user vault) |

The fallback is not plaintext: it is an HKDF-derived AES-256-GCM encrypted file
(`OpenFallback`), with the HKDF info string versioning the on-disk format. The
construction mirrors the control-plane crypto package, including package-level
function seams (`newCipherFn` / `newGCMFn` / `randReadFn` / `mkdirAllFn`) that
exist only so tests can drive the otherwise-unreachable error branches; production
never reassigns them.

## Why two stores, and a Linux asymmetry to be aware of

The split is intentional: the DB key needs only the simplest possible
device-bound get/set, while session secrets need a richer lifecycle (multiple
keys, native vaults, a graceful fallback for headless/service contexts). They do
not share code.

One consequence worth calling out: on Linux the **DB key** — the most valuable
secret, since it decrypts everything the agent stored — gets the **weakest**
protection of the two (a `0600` file with no cryptographic wrapping), while
session tokens in `secretstore` get either the Secret Service or an HKDF+AES-GCM
encrypted file. macOS (Keychain) and Windows (DPAPI) protect both with OS crypto,
so the asymmetry is Linux-only; the keystore package documents it as a known
limitation with TPM2 / a secrets manager as the upgrade path.

## References

- `packages/agent/internal/identity/keystore/keystore.go` — the `Store` interface + `GetOrCreateDBKey`
- `packages/agent/internal/identity/keystore/keystore_darwin.go` — macOS Keychain backend
- `packages/agent/internal/identity/keystore/keystore_linux.go` — Linux `0600`-file backend + the limitation note
- `packages/agent/internal/identity/keystore/keystore_windows.go` — Windows DPAPI backend
- `packages/agent/internal/identity/secretstore/store.go` — the session-secret `Store` interface
- `packages/agent/internal/identity/secretstore/fallback.go` — the HKDF + AES-256-GCM encrypted-file fallback
- `packages/agent/internal/identity/secretstore/open_linux.go` — Secret Service preference + fallback selection (per-OS siblings alongside it)
- `packages/agent/cmd/agent/wiring/observability.go` — where the audit DB key is fetched via `GetOrCreateDBKey`
- `packages/agent/cmd/agent/wiring/spill.go` — where the spill key is derived from the DB key
