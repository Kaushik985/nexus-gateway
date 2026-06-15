# Nexus Gateway — Attacker-Perspective Threat Model & Remediation Roadmap

> **Phase 4 synthesis** of the adversarial security audit (`../audit-program.md`).
> Base: settled post-arch-audit code (merge `77e86466f`) + the SEC-M2-01 fix.
> Method: module → chain → whole-system, every finding adversarially verified by ≥2/3 independent
> Opus skeptics (refute-by-default). **41 confirmed findings** (2 CRITICAL, 17 HIGH [1 fixed],
> 14 MEDIUM, 8 LOW) + **19 kill-chains**. Full worklist: [`LEDGER.md`](LEDGER.md).

---

## 1. Verdict

The architecture is sound and the arch-audit closed the structural defects — but an attacker does
not attack structure, they attack **trust assumptions at the seams**, and several load-bearing seams
trust input they must not. The audit found **two CRITICAL** issues reachable today and a cluster of
**HIGH** privilege-escalation / safety-control / secret-blast-radius issues that compose into
**demonstrated end-to-end kill-chains** for every attacker persona. None is an exotic memory bug;
all are *authorization-at-a-boundary* failures — exactly what a "the design is fine" review misses.

The product's **core security promise** — that the compliance MITM proxy inspects all AI traffic and
that a kill-switch can stop it — is **defeatable** today by a rogue node (and, where the message bus
is reachable, by an unauthenticated network attacker). That is the single most important outcome of
this audit and drives the must-fix gate below.

## 2. Headline issues (fix before any GA / external exposure)

| ID | Sev | One-line | Kill-chain |
|----|-----|----------|-----------|
| [SEC-C2-01](02-chains/C2.md) | CRITICAL | SSO enroll by `physical_id` takes over an unassigned token-enrolled node (F-0329 residual `assignment==nil` branch) → cross-node identity takeover + trust escalation | A2-demonstrated |
| [SEC-C3-01](02-chains/C3.md) | CRITICAL | Inter-Hub `nexus.hub.signal` MQ injects forced fleet-wide config (kill-switch disengage / permissive exemptions) — no publisher auth, no F-0139 allowlist, bypasses the version gate via `Force` | A1-KC3 / A3 |
| [SEC-M6-02/03](01-modules/M6-iam.md) | HIGH | A narrow IAM-management verb self-escalates to super-admin (no privilege ceiling / permission boundary on policy-create + grant ops) | **A5-CRITICAL demonstrated** |
| [SEC-M4-01](01-modules/M4-enrollment.md)+[SEC-C2-02](02-chains/C2.md) | HIGH | Attestation pubkey = **permanent, unrevocable** compliance-bypass (verify path ignores 90-day expiry, no revocation, decoupled from device-token lifecycle) | A3/A1-KC2 |
| [SEC-M5-02](01-modules/M5-hub-ws-thing.md)+[SEC-C3-02](02-chains/C3.md) | HIGH | A single rogue node flips the **fleet-wide kill-switch** in either direction via a self-authored break-glass report | A3-demonstrated |
| [SEC-W2-01/02/03](03-system/system-findings.md) | HIGH | The three crown-jewel secrets are single, flat, un-rotatable, over-conflated values; one host/log read → master-key + HMAC + internal-service-token recovery → offline decrypt of every credential | **A6-CRITICAL demonstrated** |
| [SEC-M5-01](01-modules/M5-hub-ws-thing.md) | HIGH | Spill-blob upload lets a rogue node overwrite **another node's captured forensic evidence** (no eventId↔node ownership binding) | A3-demonstrated |
| [SEC-C5-01](02-chains/C5.md) | HIGH | Rogue agent forges cross-VK / cross-org attribution on `traffic_event` + SIEM (ingest binds only `thingId`, trusts self-asserted attribution) | A3 |
| [SEC-C6-01/02](02-chains/C6.md) | HIGH | Quota fails **open** on policy-cache boot failure; VK-scoped quotas silently never enforce (config `vk` vs engine `virtual_key` vocabulary split) → uncapped spend / financial DoS | A2 |
| [SEC-M6-04](01-modules/M6-iam.md) | HIGH | A single-IdP SCIM token can read/modify/suspend **any** Nexus user (cross-IdP account takeover via email change) | A5 |

## 3. Threat model by persona

- **A1 — external unauthenticated.** The one deliberately-public listener is the compliance proxy
  `:3128` (must not bind loopback). From there: (a) **CSV/formula injection** via a crafted CONNECT
  host label that detonates in the auditor's spreadsheet on export (A1-KC1, RCE-to-auditor,
  plausible); (b) **forged attestation** (with a one-time stolen key) for a permanent uninspected
  bypass (A1-KC2); (c) where the **NATS bus is reachable** (compose/dev/flat-network), an
  unauthenticated publish to `nexus.hub.signal` forces fleet-wide config and disengages the
  kill-switch (A1-KC3, CRITICAL). Hardened-AMI loopback binding is the main mitigation for (c) — and
  it is *not* guaranteed by default config (O1).
- **A2 — valid VK holder.** Enrollment-JWT → node-identity takeover → fleet compliance bypass
  (CRITICAL demonstrated); restricted-VK model/credential-scope escape via routing `FallbackChain`
  (SEC-C1-01); cross-VK cache/quota gaps; VK-in-URL self-leak to logs (SEC-M3-02).
- **A3 — rogue / compromised node.** The richest surface: fleet kill-switch flip, permanent stealth
  bypass, forensic-evidence fabrication, victim-node + service-Thing impersonation — all
  **demonstrated**. Root cause: several Hub seams trust **node-asserted** provenance (desired-config,
  attestation, attribution, break-glass) instead of re-deriving authority server-side.
- **A5 — low-privilege insider admin.** A narrow IAM-management verb → silent super-admin →
  org-wide compromise (CRITICAL demonstrated); SIEM-webhook verb → org-wide audit/traffic
  exfiltration + SSRF; single-IdP SCIM → cross-IdP takeover; semantic-cache poisoning across VKs.
  The IAM tier model lacks a **privilege ceiling** — the SEC-M2-01 class generalized.
- **A6 — host / DB / log read.** One read of a committed/flat secret cascades: master AES key + HMAC
  secret + internal-service token recovery → offline decrypt of all credentials and forge of VK/admin
  hashes (CRITICAL demonstrated). The crown-jewel secrets have no per-purpose derivation, no
  rotation, no second factor.
- **A4 — on-path / rogue provider.** Mostly bounded by the (now-confirmed) MITM design; residual is
  the unconstrained CA blast radius (SEC-M1-01) and http:// leakage paths (closed for ai-guard by
  SEC-M2-01).

## 4. Blast-radius / single-points-of-failure (W2)

Three secrets each gate **many** independent trust decisions with **no containment**:
`ADMIN_KEY_HMAC_SECRET` (conflates admin-key AND VK hashing, un-rotatable), `INTERNAL_SERVICE_TOKEN`
(one flat value across 4 services), `CREDENTIAL_ENCRYPTION_KEY` (one flat AES master, no KDF/salt,
nil AAD). This is why the A6 kill-chains reach CRITICAL from a single read. Remediation is structural
(split per purpose, derive per-record, enable rotation) — FIX-5.

## 5. Must-fix-before-GA gate

A unit ships only when these are closed (CRITICAL + every HIGH that anchors a *demonstrated*
kill-chain). In priority order = the fix-cluster order:

1. **FIX-2** safety-control authZ (SEC-C3-01 CRITICAL, SEC-M5-02/03) — restore the kill-switch /
   compliance-inspection promise.
2. **FIX-3** enrollment/attestation identity (SEC-C2-01 CRITICAL, SEC-M4-01) — stop node takeover +
   permanent bypass.
3. **FIX-1** IAM permission model (SEC-M6-02/03/01/04) — stop insider super-admin escalation.
4. **FIX-5** secret hardening + SPOF split (SEC-W2-01/02/03, SEC-M9-01) — collapse the A6 cascade.
5. **FIX-7** audit integrity (SEC-C5-01/02, SEC-M5-01) — trustworthy evidence + no export RCE.
6. **FIX-4** quota fail-closed (SEC-C6-01/02) — no uncapped-spend DoS.
7. **FIX-6** VK isolation (SEC-C1-01, SEC-M3-01/02, SEC-C4-01).
8. **FIX-8** NE availability + CA + appliance posture (SEC-M8-01/02, SEC-M1-01, SEC-W3-01, SEC-W4-*).

## 6. Remediation roadmap (Phase 5)

Execution batches + per-finding membership: [`LEDGER.md` §Phase-5 fix clusters](LEDGER.md). Policy:
CRITICAL+HIGH+MEDIUM mandatory to the SEC-M2-01 standard (real fix → tests asserting the closed
invariant → doc/openapi lockstep → re-run the finding's re-check probe → commit); simple LOW fixed;
design-needing LOW deferred with reason. **FIX-1 (IAM permission model)** gets a brainstorm first —
a privilege-ceiling / permission-boundary is an architecture decision, not a patch.

## 7. Methodology, coverage, honesty

Each phase: attacker-lens finders fan out → every candidate judged by 3 independent Opus verifiers
on distinct lenses (reachability / exploitability / existing-control), refute-by-default, ≥2/3 to
survive. ~50 candidates were **refuted** and dropped (e.g. several M1 leaked-key framings, most M7
OAuth attempts, most C4 cache attempts) — the verifier layer is doing real work, not rubber-stamping.
Coverage: all 9 crown-jewel modules, all 6 trust-boundary chains, whole-system SPOF/fail-open/supply
-chain. **Not covered live:** native macOS/Windows agent paths (SEC-M8-* reasoned from source, not
run on a device), and any finding needing a live multi-service stack to demonstrate (PoCs are
code-traced, not executed) — these carry `requires-strong-preconditions` / probe-based verification
and should be confirmed on a live deployment before the gate is declared met.
