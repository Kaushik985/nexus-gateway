# M1 — MITM CA issuer + Hub attestation CA

> Phase 1 module audit. Base `77e86466f`. Confirmed findings only (≥2/3 adversarial Opus verifiers).
> 7 of 8 M1 candidates were refuted (the verifiers rejected several "leaked-key" framings on the
> grounds that name constraints don't bind a key-holder, and that on-disk 0600 + optional KMS-wrap
> already address key-at-rest). The one survivor is a genuine defense-in-depth gap.

---

## SEC-M1-01 — MITM CA is an unconstrained root: no `MaxPathLenZero`, no name constraints — **MEDIUM** (2/3)
> **STATUS: PARTIALLY FIXED** (2026-06-09) — added `MaxPathLenZero:true` to the agent device-CA template (`engine.go generateCA`) so a stolen key cannot mint a sub-CA; regression test in `engine_test.go`. The `PermittedDNSDomains` half was intentionally NOT applied (dynamic interception list — see revised remediation). The proxy issuer CA is generated out-of-band (load-from-disk); its key-at-rest protection (KMS-wrap / remote-sign) is the appliance-posture item tracked under FIX-8.
> **Residual fixed (2026-06-10, `ab1dd6403`)** — all proxy-CA generation recipes (`install-test-env.md`, `scripts/dev-start.sh`) now set `basicConstraints=critical,CA:TRUE,pathlen:0`, and the compliance-proxy issuer warns at load when the on-disk CA lacks the path-length constraint — closing the MORPHED residual the G6 verify round surfaced (recipes contradicted remediation item 1).

- **Persona:** A6 host/log read or local-priv-esc who obtains the on-disk CA private key (also A4 if the key is exfiltrated).
- **Invariant:** A MITM CA installed in a host trust store must be scoped to the minimum domains it is meant to intercept (name constraints) and forbidden from issuing intermediate CAs (path-length zero), so its compromise cannot impersonate arbitrary internet services.
- **Verifier note:** one verifier refuted, arguing name constraints don't bind a holder of the CA's own private key (they sign leaves directly) and the device CA's by-design scope is broad HTTPS interception. The majority kept it as valid **defense-in-depth that bounds blast radius and is cheap to add** — RFC 5280 `nameConstraints` *are* enforced by Go/NSS/macOS/Windows verifiers, so scoping the CA does reduce what forged certs the ecosystem will accept, and `MaxPathLenZero` blocks sub-CA minting. Recorded at MEDIUM with the dissent noted.

**Preconditions.** Agent installed with the device CA in the OS trust store (every platform installs `nexus-agent-device-ca` as a `trustRoot`). Attacker reads `/var/lib/nexus-agent/device-ca.key` (0600, owner `nexus-agent` on Linux; root on macOS) via local priv-esc / backup / snapshot / log leak, or extracts the proxy MITM CA key.

**Attack steps.**
1. `generateCA()` builds the device CA with `IsCA:true`, `BasicConstraintsValid:true`, `KeyUsage CertSign|CRLSign`, but **no** `MaxPathLenZero` and **no** `PermittedDNSDomains/ExcludedDNSDomains` (`packages/agent/internal/network/tls/engine.go` `generateCA`). The compliance-proxy issuer CA is loaded from disk with the same unconstrained shape (`issuer.go:82-134`) and never asserts constraints on load.
2. With the recovered key the attacker mints a valid leaf for **any** hostname — banks, email, internal corp services — not just monitored AI provider domains.
3. Absence of `MaxPathLenZero` also lets the attacker mint a working **intermediate CA** off the leaked key, broadening reach.
4. Every device that trusts `nexus-agent-device-ca` (installed fleet-wide as a `trustRoot`; `install_ca_linux.go:24-26,84-91` copies it into the OS-wide bundle) silently accepts the attacker's forged certs. The intended scope ("only AI traffic inspection") is a comment, not enforced.

- **Affected:** `packages/agent/internal/network/tls/engine.go` (`generateCA` template — `IsCA:true`, no `MaxPathLenZero`, no `Permitted*DNSDomains`); `packages/compliance-proxy/internal/tls/issuer/issuer.go:82-134` (CA loaded without asserting name constraints).
- **Re-check probe.** `rg -n 'IsCA: *true' packages/agent/internal/network/tls/engine.go packages/compliance-proxy/internal/tls/issuer/` and assert each adjacent template also sets `MaxPathLenZero:true` and `PermittedDNSDomains`. Unit test: call `generateCA()` and fail if `cert.MaxPathLenZero==false || len(cert.PermittedDNSDomains)==0`.
- **Remediation (revised 2026-06-08 after maintainer review).** Split the defense by threat and by which CA:
  1. **`MaxPathLenZero:true` on every locally-minted MITM CA template (device CA + proxy CA)** — unconditional. Independent of the (dynamic) domain list; blocks a leaked key from minting a working intermediate CA. Cheap pure win.
  2. **Do NOT use `PermittedDNSDomains` driven by the interception-domain allowlist.** That list is **runtime hot-swapped** (`access.Checker.SwapDomainAllowlist`, `checker.go:57-61`, fed by Hub-pushed `InterceptionDomain` changes = static YAML + dynamic DB), but `nameConstraints` is an immutable extension fixed at CA-generation. Baking the dynamic list into the CA would require regenerating + re-distributing the CA on every domain add, and any not-yet-baked domain would **fail-closed** (the client rejects the bumped leaf and legitimate interception breaks). Mechanism mismatch — dropped.
  3. **Defend the leaked-key threat with root-key protection, which is list-agnostic — and prioritise by blast radius:**
     - **Compliance-proxy issuer CA (HIGH blast radius — one key per appliance intercepts every proxied user).** The issuer **already supports** KMS-wrapping the on-disk key (`kmsProvider.Decrypt` before PEM parse, `issuer.go:105`) and a **remote-signing mode** where the key never lands locally (`remote_signer.go:117`). Appliance/prod deployments should enable one of these; that downgrades "leaked CA key → MITM all proxied users for arbitrary domains" at the root.
     - **Agent device CA (LOW marginal value — per-machine self-generated, 0600; leaking it presupposes the attacker already owns that host).** Keep 0600, exclude `device-ca.key` from backups/snapshots; per-machine KMS-wrapping is over-engineering.
  4. **(Optional defense-in-depth) issuance-time SAN allowlist** — have the issuer refuse to mint a leaf whose SAN is not in the *current live* allowlist (reads the hot-swapped `access.Checker`, so it IS dynamic-friendly). **Caveat:** this only binds the legitimate proxy code path — a holder of the leaked CA key signs leaves directly and bypasses it — so it mitigates confused-deputy / over-bumping, NOT the leaked-key threat in this finding. Worth having, not a substitute for (3).

> **Maintainer note:** the agent device CA being per-machine (`engine.go:89 LoadOrGenerateCA`) and the proxy issuer CA already supporting KMS/remote-sign together argue this is a low-to-medium hardening item, not a critical one. `MaxPathLenZero` is the concrete cheap fix; the rest is deployment posture (enable KMS/remote-sign for the appliance proxy CA).

---

### Refuted in M1 (recorded for transparency — not findings)

The other 7 candidates were dropped by adversarial verification, chiefly: KMS-command-injection paths (verifiers found the command args are not attacker-influenced); fail-open-on-KMS-error (the issuer fails closed); cleartext CA bootstrap (the trust-distribution path uses signed/attested channels); cert-cache DEK SETNX race (fail-closed on missing KMS, DEK is HKDF input not a trust anchor); unauth `/management/ca-cert` (serves only the public cert, which is meant to be public). See the workflow transcript for per-candidate verdicts.
