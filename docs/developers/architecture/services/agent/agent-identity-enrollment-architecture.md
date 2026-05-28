# Agent identity & enrollment

Before the agent can do anything useful it must become a known Thing: get a
device certificate signed by Nexus Hub, receive a device-id and a bearer token,
and (optionally) an attestation key. This document covers that lifecycle — the
two enrollment paths, the credentials that result, the attestation key issued
alongside them, and the hardened browser launch the SSO path relies on.

## The enrollment Manager

`enrollment.Manager` owns the on-disk identity artifacts in the agent's cert
directory: the mTLS device certificate (`device.pem`), its key
(`device-key.pem`), the gateway CA (`gateway-ca.pem`), the device-id, and the
bearer token. `IsEnrolled` is the boot gate — it reports enrolled only when the
cert, key, and token are all present; until then the daemon serves the status
IPC so the Dashboard can drive sign-in, and does not start interception. The
Manager also exposes `ThingID`, `CertPaths`, `TrustLevel`, and the SSO email.

Two collaborators are injected as options: a `HubEnroller` (the Hub HTTP call
that signs a CSR into a device cert) and a `CertRenewer` (cert rotation).

## Two enrollment paths

**Token enrollment** (`Enroll`) is the headless / mTLS path: the agent generates
a P-256 ECDSA key, builds a CSR, and exchanges an enrollment token with Hub for
the signed device certificate. This is the path the `ENROLL_TOKEN` IPC command
drives.

**SSO enrollment** drives a PKCE OAuth flow against the Control Plane:

1. The agent generates a PKCE verifier/challenge and starts a short-lived local
   HTTP server on loopback to catch the OAuth redirect.
2. It opens the operator's Control Plane authorize URL in the user's browser
   (through the hardened opener below).
3. The browser completes SSO; the redirect hits the local callback server, which
   captures the authorization code (matched against the PKCE state).
4. The agent exchanges the code for an enrollment JWT and presents it to Hub,
   which signs the device certificate.

The SSO path is what the Dashboard's sign-in flow uses; it is split across
`sso_flow.go` (orchestration), `sso_pkce.go` (the PKCE primitives), and
`sso_server.go` (the loopback callback server).

## Key material

Enrollment provisions two independent keypairs:

- **P-256 ECDSA** — the mTLS device identity. Its certificate (`device.pem`) is
  what every authenticated Hub call presents.
- **Ed25519** — the traffic-attestation key, generated in the same `Enroll` step.
  This is **fail-open**: a failure to generate or register the attestation key
  does not block enrollment — the device still comes up, just without
  attestation.

The bearer token returned by enrollment is stored in the cert directory and read
back by `auth.LoadDeviceToken`; it rides as `Authorization: Bearer` on Hub calls.
`auth.ClearEnrollment` wipes these artifacts — the sign-out / unenroll path.
SSO-flow refresh tokens and session ids are kept separately in `secretstore` (see
[agent-keystore-architecture.md](agent-keystore-architecture.md)).

## Attestation

The Ed25519 key issued at enrollment backs `attestation.Signer`. The signer lazy-
loads the key from disk on its first `Sign`, caches it in memory, and produces
the `X-Nexus-Attestation` header value stamped on every outbound CONNECT to the
compliance proxy. `InjectInto` is the request hook the agent's tlsbump
`UpstreamTransport` calls per request.

Two properties matter:

- **Live toggle.** The signer is constructed with an `enabledLookup` callback
  read on every `Sign`, sourced from the applied-config device defaults
  (`attestationEnabled`), so an admin flipping attestation takes effect on the
  next request without a restart.
- **Fail-open.** Every `Sign` error path causes the caller to omit the header;
  the request still flows to the compliance proxy through the normal bumped path.
  Attestation never blocks traffic.

The wire format the signer emits is defined in
`packages/shared/transport/tlsbump/attestation.go`, shared with the
compliance-proxy verifier that reads it.

## Hardened browser launch

The SSO path must open a URL in the user's browser, and the Dashboard's
`OPEN_BROWSER` IPC command does the same. Both go through `openbrowser.Opener`
rather than shelling out directly, so a compromised WebView renderer cannot
invoke arbitrary commands. `Open` enforces a fixed policy before any shell-out:
the URL must parse as absolute, its scheme must be `https`, and its host must be
on an operator-configured allowlist (`SetAllowedHosts`, populated from the
configured Control Plane URL). Anything else is rejected before `dispatch` runs
the platform open command. (The `OPEN_BROWSER` IPC entry point is covered in
[agent-tray-ipc-architecture.md](agent-tray-ipc-architecture.md).)

## References

- `packages/agent/internal/identity/enrollment/enroll.go` — the `Manager`, on-disk artifacts, `Enroll`, and the parallel Ed25519 generation
- `packages/agent/internal/identity/enrollment/hub_enroll.go` — the Hub CSR-signing call
- `packages/agent/internal/identity/enrollment/sso_flow.go` — PKCE SSO orchestration
- `packages/agent/internal/identity/enrollment/sso_pkce.go` — PKCE verifier/challenge
- `packages/agent/internal/identity/enrollment/sso_server.go` — the loopback OAuth callback server
- `packages/agent/internal/identity/auth/device_token.go` — `LoadDeviceToken` / `ClearEnrollment`
- `packages/agent/internal/identity/attestation/signer.go` — the Ed25519 attestation signer (`Sign` / `InjectInto`)
- `packages/agent/internal/host/openbrowser/openbrowser.go` — the https + host-allowlist browser opener
- `packages/shared/transport/tlsbump/attestation.go` — the attestation header wire format
