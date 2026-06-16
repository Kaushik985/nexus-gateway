# Security Audit — Consolidated Findings Ledger

> Single ranked worklist for the Phase-5 fix program. **41 confirmed findings** (2 CRITICAL, 17 HIGH, 14 MEDIUM, 8 LOW). Each ≥2/3 adversarial Opus verifiers. Phase-5 policy: CRITICAL+HIGH+MEDIUM mandatory; simple LOW fixed; rest recorded. **Progress (FINAL — G6 verify round complete 2026-06-10): all 41 findings have a landed fix.** G6 = an independent re-verification of every shipped fix. Verdicts: **35 CLOSED** (fix verified holding by a real regression test); **2 PLATFORM_PENDING** — SEC-M4-02 (keystore) + SEC-M8-02 (NE watchdog): code + regression tests landed, on-host macOS/Windows build+test is maintainer-owned via `Skill('build-agent')`; **3 MORPHED** (invariant closed in code, probe form changed) with their residuals now resolved — SEC-M1-01 proxy-CA `pathlen:0` in all recipes + issuer-load warning (`ab1dd6403`), SEC-C3-01 resync MQ frame now signed via `SignHubSignal` (`ab1dd6403`), SEC-W2-02 residual **risk-accepted by user decision** (Layer B mTLS CANCELLED 2026-06-09; bounded by SEC-C3-02; shared `INTERNAL_SERVICE_TOKEN` retained, the desktop agent keeps its per-device token — see the SEC-W2-02 STATUS + `rotation-custody-substrate-design.md` "Layer B — CANCELLED"); and **SEC-W3-01 reopened by G6, then re-fixed** — the original fix was half-built (strict build error logged-and-ignored at all 5 compliance-proxy bump sites), refusal wired at all 5 sites in `03de276d1` + strict-branch unit coverage in `dcced4d2c`. Layer A review SHIP_WITH_FIXES items all landed (`2a2b11c3a`); SEC-M8-01's deferred NE-Swift half is implemented (`14a98c6a2`, on-host test pending).
>
> **G6 verdict legend (ranked index `Status` column):** `fixed` = G6-verified CLOSED (or MORPHED with the invariant closed in code and the residual fixed / risk-accepted as noted above); `fixed (platform-pending)` = fix + regression tests landed, on-host platform verification (macOS/Windows build + run-test) still maintainer-owned — applies to SEC-M4-02 and SEC-M8-02 only.

Kill-chains composing these findings: [`03-system/kill-chains.md`](03-system/kill-chains.md) (19 chains, several CRITICAL demonstrated).

## Ranked index (by evaluator severity)

| ID | Sev | Status | Persona | Title | Detail |
|----|-----|--------|---------|-------|--------|
| SEC-C2-01 | **CRITICAL** | fixed | A2 valid-VK | SSO enroll by physical_id takes over an unassigned token-enrolled node (F-0329 residual: | [C2](02-chains/C2.md) |
| SEC-C3-01 | **CRITICAL** | fixed | A3 rogue-node | Inter-Hub `nexus.hub.signal` MQ path injects forced fleet-wide config (incl. permissive  | [C3](02-chains/C3.md) |
| SEC-C1-01 | **HIGH** | fixed | A2 valid-VK | Per-VK allowedModels allowlist bypassed by a routing rule's inline FallbackChain (recove | [C1](02-chains/C1.md) |
| SEC-C3-02 | **HIGH** | fixed | A3 rogue | Single compromised node can flip the FLEET-WIDE kill-switch via a self-authored break-gl | [C3](02-chains/C3.md) |
| SEC-C5-01 | **HIGH** | fixed | A3 rogue-node | Rogue agent forges cross-VK / cross-org attribution on traffic_event + SIEM via self-ass | [C5](02-chains/C5.md) |
| SEC-C6-01 | **HIGH** | fixed | A2 valid-VK | Quota policy-cache boot-load failure fails open silently and persistently — unmetered, n | [C6](02-chains/C6.md) |
| SEC-C6-02 | **HIGH** | fixed | A5 | VK-scoped quota policy/override created in the UI is silently never enforced — CP stores | [C6](02-chains/C6.md) |
| SEC-M2-01 | **HIGH** | fixed | A5 low-priv-insider-ad | M2 — AI-Guard external_url backend exfiltrates any decrypted provider API key to an admi | [M2](01-modules/M2-credential-crypto.md) |
| SEC-M4-01 | **HIGH** | fixed | A3 rogue | Attestation pubkey grants permanent, unrevocable compliance-pipeline bypass — verifier e | [M4](01-modules/M4-enrollment.md) |
| SEC-M5-01 | **HIGH** | fixed | A3 rogue | Spill blob upload allows cross-node forensic-evidence tampering: mint binds no eventId↔n | [M5](01-modules/M5-hub-ws-thing.md) |
| SEC-M5-02 | **HIGH** | fixed | A3 rogue | Rogue node can flip the FLEET-WIDE kill-switch in either direction via a self-issued bre | [M5](01-modules/M5-hub-ws-thing.md) |
| SEC-M6-01 | **HIGH** | fixed | A5 low-priv-insider-ad | SIEM webhook config at `audit-log:write` tier exfiltrates the org-wide traffic + admin-a | [M6](01-modules/M6-iam.md) |
| SEC-M6-02 | **HIGH** | fixed | A5 low-priv insider ad | No privilege-ceiling on IAM policy create/update/attach — any delegated `iam-policy.*` o | [M6](01-modules/M6-iam.md) |
| SEC-M6-03 | **HIGH** | fixed | A5 low-priv insider ad | IAM grant operations (attach policy to principal/group, add group member) gated on gener | [M6](01-modules/M6-iam.md) |
| SEC-M6-04 | **HIGH** | fixed | A5 low-priv insider ad | SCIM User endpoints lack per-IdP ownership scoping — a SCIM token for one IdP can read/m | [M6](01-modules/M6-iam.md) |
| SEC-M9-01 | **HIGH** | fixed | A6 host | ADMIN_KEY_HMAC_SECRET drift: Control Plane silently hashes admin keys + virtual keys wit | [M9](01-modules/M9-secrets.md) |
| SEC-W2-01 | **HIGH** | fixed | A6 host | ADMIN_KEY_HMAC_SECRET is a single un-rotatable value that conflates TWO distinct authent | [W2](03-system/system-findings.md) |
| SEC-W2-02 | **HIGH** | fixed | A3 rogue | INTERNAL_SERVICE_TOKEN is a single flat shared secret across four services that simultan | [W2](03-system/system-findings.md) |
| SEC-W2-03 | **HIGH** | fixed | A6 host | CREDENTIAL_ENCRYPTION_KEY is a single master AES key (flat 32-byte, no KDF/salt, nil AAD | [W2](03-system/system-findings.md) |
| SEC-C1-02 | MEDIUM | fixed | A6 host | Provider-credential ciphertext is not AAD-bound to its credential id/provider — cross-cr | [C1](02-chains/C1.md) |
| SEC-C2-02 | MEDIUM | fixed | A3 rogue-node | Attestation key trusted indefinitely — verify path ignores cert 90-day expiry and has no | [C2](02-chains/C2.md) |
| SEC-C4-01 | MEDIUM | fixed | A5 low-priv-admin | Semantic-cache prewarm lets a low-priv admin plant attacker-chosen responses under any v | [C4](02-chains/C4.md) |
| SEC-C5-02 | MEDIUM | fixed | A2 valid-VK | CSV/formula injection in compliance-event exports — attacker-controlled traffic_event fi | [C5](02-chains/C5.md) |
| SEC-M1-01 | MEDIUM | fixed | A6 host-or-log-read | M1 — Agent device MITM CA (and proxy MITM CA) is an unconstrained root: no MaxPathLen an | [M1](01-modules/M1-ca-issuer.md) |
| SEC-M2-02 | MEDIUM | fixed | A6 host-or-log-read | M2: No weak/known-key rejection at boot — fixed dev key and all-zeros pass every CREDENT | [M2](01-modules/M2-credential-crypto.md) |
| SEC-M3-01 | MEDIUM | fixed | A5 low-priv-insider-ad | M3 — Admin "Revoke user access" disables the user's VKs in the DB but pushes no virtual_ | [M3](01-modules/M3-vk-auth.md) |
| SEC-M3-02 | MEDIUM | fixed | A6 host-or-log-read | M3: Virtual key accepted as `?key=` URL query parameter — plaintext VK leaks to any fron | [M3](01-modules/M3-vk-auth.md) |
| SEC-M4-02 | MEDIUM | fixed (platform-pending) | A6 host | Attestation private key stored as plaintext 0600 PEM on agent disk (not the platform key | [M4](01-modules/M4-enrollment.md) |
| SEC-M6-05 | MEDIUM | fixed | A5 low-priv insider ad | VK approval-workflow handlers (revoke/renew) skip the owner re-check their sibling CRUD  | [M6](01-modules/M6-iam.md) |
| SEC-M7-01 | MEDIUM | fixed | A5 low-priv-insider | sso-enroll IAM evaluation hardcodes nexus:CurrentTime to empty string — time-windowed De | [M7](01-modules/M7-oauth-pkce.md) |
| SEC-M8-01 | MEDIUM | fixed | A5 | QUIC-fallback kill-list is never validated against the system DNS/DHCP/Push allowlist; a | [M8](01-modules/M8-ne-failopen.md) |
| SEC-W3-01 | MEDIUM | fixed | A5 low-priv insider ad | Compliance-proxy appliance silently downgrades admin-configured FailBehavior=fail-closed | [W3](03-system/system-findings.md) |
| SEC-W4-01 | MEDIUM | fixed | A4 on-path attacker du | AMI appliance build pulls and compiles all runtime infra (Valkey + valkey-search vendore | [W4](03-system/system-findings.md) |
| SEC-C2-03 | LOW | fixed | A5 low-priv-admin | SSO enrollment JWT (a device-enrollment grant) lets a low-priv user mint a fake SERVICE- | [C2](02-chains/C2.md) |
| SEC-M4-03 | LOW | fixed | A4 on-path | Enrollment-JWT replay guard (JTI cache) is in-memory only — a captured 5-min JWT is repl | [M4](01-modules/M4-enrollment.md) |
| SEC-M5-03 | LOW | fixed | A3 rogue | Single compromised node can flip the fleet-wide killswitch (engage OR disengage) via bre | [M5](01-modules/M5-hub-ws-thing.md) |
| SEC-M5-04 | LOW | fixed | A3 rogue | A single compromised node can engage the fleet-wide kill-switch via break-glass, disabli | [M5](01-modules/M5-hub-ws-thing.md) |
| SEC-M5-05 | LOW | fixed | A3 rogue | Rejected/over-privileged break-glass attempts from a node produce no audit row and no SI | [M5](01-modules/M5-hub-ws-thing.md) |
| SEC-M8-02 | LOW | fixed (platform-pending) | A4 on-path-or-rogue-pr | Post-peek relay connection establishment has no fail-open watchdog — black-holed upstrea | [M8](01-modules/M8-ne-failopen.md) |
| SEC-M9-02 | LOW | fixed | A6 host-or-log-read | Control Plane silently falls back to the committed dev HMAC secret unless a separate, ea | [M9](01-modules/M9-secrets.md) |

## Phase-5 fix clusters (batched worklist)

### FIX-1 IAM permission model (design — brainstorm)
- **Findings:** SEC-M6-02, SEC-M6-03, SEC-M6-01, SEC-M6-04, SEC-M6-05, SEC-M7-01
- Permission-boundary / privilege-ceiling on IAM grant+policy ops; SIEM-webhook tier+SSRF; SCIM per-IdP scoping; VK-approval owner re-check; sso-enroll time-condition fail-open. Backs A5 CRITICAL kill-chain (narrow verb→super-admin).

### FIX-2 Safety-control authZ (kill-switch / break-glass / config push / MQ)
- **Findings:** SEC-C3-01, SEC-C3-02, SEC-M5-02, SEC-M5-03, SEC-M5-04, SEC-M5-05
- Authenticate desired-config provenance end to end; reject node-authored break-glass on fleet keys; publisher-auth + F-0139 allowlist + schema on inter-Hub nexus.hub.signal MQ (A1-KC3 CRITICAL); audit every break-glass attempt.

### FIX-3 Enrollment / attestation identity
- **Findings:** SEC-C2-01, SEC-M4-01, SEC-C2-02, SEC-M4-02, SEC-C2-03, SEC-M4-03
- CRITICAL physical_id takeover (nil-assignment branch); attestation expiry+revocation (breaks A1-KC2/A3 permanent-bypass); service-type mint in JWT path; attestation key at rest; JTI replay across restart.

### FIX-4 Quota enforcement
- **Findings:** SEC-C6-01, SEC-C6-02
- Fail-closed/self-healing quota policy-cache boot; unify config 'vk' vs engine 'virtual_key' so VK-scoped quotas enforce.

### FIX-5 Credential & secret hardening + SPOF split
- **Findings:** SEC-C1-02, SEC-M2-02, SEC-M9-01, SEC-M9-02, SEC-W2-01, SEC-W2-02, SEC-W2-03
- AAD-bind credential ciphertext to row id; reject weak/known master keys at boot; CP HMAC fail-closed (no committed-constant fallback); split the conflated SPOF secrets (ADMIN_KEY_HMAC_SECRET admin-vs-vk; per-purpose-derive; rotation). Backs A6 CRITICAL kill-chains (master-key + INTERNAL_SERVICE_TOKEN recovery).

### FIX-6 VK isolation / leakage
- **Findings:** SEC-C1-01, SEC-M3-01, SEC-M3-02, SEC-C4-01
- allowedModels enforced on FallbackChain targets; revoke pushes VK cache invalidate; ?key= carrier opt-in; semantic-prewarm scope auth.

### FIX-7 Audit integrity / export
- **Findings:** SEC-C5-01, SEC-C5-02, SEC-M5-01
- Server-authoritative attribution on agent-audit ingest; CSV formula neutralization (breaks A1-KC1 RCE-to-auditor); spill-blob eventId↔node ownership binding.

### FIX-8 NE availability + CA + appliance posture
- **Findings:** SEC-M8-01, SEC-M8-02, SEC-M1-01, SEC-W3-01, SEC-W4-01
- QUIC kill-list vs system DNS/DHCP/Push allowlist; post-peek relay watchdog (native); MaxPathLenZero + KMS/remote-sign on MITM CA; compliance appliance must not downgrade fail-closed; appliance artifact integrity.


_LOW outside a cluster are recorded; simple ones fold into the nearest cluster; design-needing LOW deferred with reason at fix time._

