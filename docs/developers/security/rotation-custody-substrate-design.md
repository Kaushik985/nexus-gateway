# Rotation & Custody Substrate — combined design (W2-01 keyring + W2-03 KMS; W2-02 C3 per-edge CANCELLED / risk-accepted)

> **Status (per layer, updated 2026-06-09):** **Layer A (versioned HMAC keyring) — SHIPPED** (A-1..A-4). **Layer C (KMS envelope custody) — SHIPPED.** **Layer B (per-edge tokens / per-node mTLS) — CANCELLED; W2-02 C3 residual RISK-ACCEPTED** (see "Layer B — CANCELLED" below). This was the unified design for the three deferred FIX-5 follow-ups, which the handoff + [[project-kms-envelope-custody]] flagged "design together" because they share one substrate: the **lifecycle of inter-service key material** — *how a root secret is custodied at rest (KMS), how it is versioned/rotated (keyring), and how it is scoped per edge (per-edge tokens)*. They are orthogonal layers; neither subsumes the others, and a single secret can carry all three.

## Why one design, three layers

| Layer | Finding | Question it answers | Independence |
| --- | --- | --- | --- |
| **A. Versioned keyring** | W2-01 part-b (HMAC) + W2-02 C3 rotatability | "which version sealed/hashed/authenticated this, and can I rotate without a fleet lockstep flip?" | needs schema (keyVersion stamps) |
| **B. Per-edge tokens** ~~(CANCELLED)~~ | W2-02 C3 | "which *edge* holds this token, so a leak is contained to that edge?" — **risk-accepted, not implemented** | would have touched the WS + HTTP auth paths |
| **C. KMS envelope custody** | W2-03 remediation #4 | "is the root secret plaintext-at-rest in an env a host/backup reader can lift?" | independent; wraps the roots the other two version/scope |

Composition example for `CREDENTIAL_ENCRYPTION_KEY`: **C** unwraps it from a KMS-wrapped blob at boot (no plaintext hex in env), **A** is the existing `CREDENTIAL_KEY_MAP` keyring that versions it. For `INTERNAL_SERVICE_TOKEN`: **C** custodies it and **A** could rotate it with an accept-old+new window; **B** (split it per edge) was **cancelled / risk-accepted**, so the single shared token is retained.

## Current state (from the 2026-06-09 code survey — facts, file:line)

**Layer A — what exists, what's missing.**
- The AES credential path ALREADY has a versioned keyring to mirror: `MultiVault`/`MultiDecryptor` parse `"[*]id:hex64,…"` (`control-plane/internal/platform/crypto/aes_gcm.go:220-322`, `ai-gateway/internal/credentials/decrypt/decrypt.go:112-152`), a per-row stamp `Credential.encryption_key_id String @default("v1")` (`schema.prisma:396`), and an eager background rotation worker (`control-plane/internal/ai/providers/handler/key_rotation.go`) that decrypts-old→reseal-new because AES is reversible.
- The HMAC path has **NO keyring**: `ADMIN_KEY_HMAC_SECRET` is a single scalar in CP (`config.go:209`) and ai-gw (`config.go:244`); hashing is `HMAC(keyderive.DeriveSubkey(secret, class), rawKey)` (`apikey.go:58-74`, `vkauth.go:110-132`). **No `ADMIN_KEY_HMAC_KEY_MAP` anywhere; no keyVersion column on `AdminApiKey` (schema.prisma:148-180) or `VirtualKey` (schema.prisma:349-386); no `Account` model; no lazy-rehash-on-auth precedent** (bcrypt sites do plain compare, no cost-upgrade).
- **Why HMAC is harder than AES:** HMAC is one-way — you cannot decrypt-and-reseal a stored hash. Rotation must be *try-all-versions on auth* + *lazy re-hash on the matching auth*.

**Layer B — CANCELLED (kept here only as the current-state record behind the risk-acceptance).** Every inter-service validator is a single `subtle.ConstantTimeCompare` against ONE configured `INTERNAL_SERVICE_TOKEN`, with no per-caller/edge identity (Hub `ServiceAuth`, `DeviceOrServiceAuth` service path, WS `authenticate` Path-1, ai-gw `runtimeapi/auth.go` + `internalauth.go`, compliance-proxy `runtime/auth/auth.go`); the WS edge identity is self-asserted via query params, gated only by the shared token. C2 (shipped) already discriminates by Thing *type* on the HTTP mutation path. The remaining cross-backend-service residual is **risk-accepted** — see the "Layer B — CANCELLED" record below; this design layer is not pursued.

**Layer C — the template + the gap.**
- `packages/compliance-proxy/internal/tls/kms/kms.go` is the exact shape to promote: `KMSProvider{Name(); Decrypt(ctx, ct)}` + `Encryptor{Name(); Encrypt(ctx, pt)}` interfaces (`:30-53`), `NoopProvider` (raw passthrough, dev default, `:55-64`), `CommandProvider`/`CommandEncryptor` shelling to **aws kms / sops / age / vault** via a `{file}` placeholder or STDIN (`:66-199`, F-0299 pipes secrets via stdin, never a temp file). Config is **argv-only, no secret in config** (`CAKMSConfig` `compliance-proxy/.../config/config.go:238-260`); the CA key is unwrapped **once at boot** (`issuer.go:105`), with an optional remote-signing mode that never loads the key. The cert-cache DEK envelope (`cert_cache_dek.go:69-127`) is the bootstrap template for wrap-once-store-in-Redis.
- The gap: **every other root secret is loaded raw via `os.Getenv` into a plaintext field** (`CREDENTIAL_ENCRYPTION_KEY`, `CREDENTIAL_KEY_MAP`, `ADMIN_KEY_HMAC_SECRET`, `INTERNAL_SERVICE_TOKEN`, `HUB_CONFIG_TOKEN`, `COMPLIANCE_PROXY_API_TOKEN`). KMS custody is applied ONLY to the compliance-proxy CA key today.
- Env→config contract: `bootenv` loads repo-root `.env` for dev only; code reads `os.Getenv` exclusively; prod delivers via systemd `EnvironmentFile=` / K8s Secret (`shared/core/bootenv/bootenv.go`, `local-dev-debugging.md` "Environment variables").

## Design

### Layer A — versioned keyring (generalize the proven AES pattern to HMAC + tokens)

**A1. HMAC keyring (`ADMIN_KEY_HMAC_KEY_MAP`).** Mirror `CREDENTIAL_KEY_MAP`'s `"[*]vN:secret,…"` format and `*current` marker. New shared helper `hmackeyring` (or extend `keyderive`) that, given the map, exposes:
- `Current() (version string, key []byte)` — the `*`-marked entry, used to hash NEW issues. (Shipped: also `CurrentVersion() string` for stamping `key_version`.)
- `All() []Entry` — all versions, **CURRENT FIRST then map-insertion order**, for try-all on auth (the steady-state hot path is a one-hash hit under current). (As-shipped name; the earlier sketch called this `Versions()` "newest-first" — the implementation uses current-first, which is the correct hot-path order. The shipped `Versions() []string` is a different, ids-only accessor feeding the boot-time keyring log on CP + ai-gw: version ids + current, never secret bytes.)
- Each version's hashing key is still domain-separated via `keyderive.DeriveSubkey(versionSecret, ClassAPIKeyAdmin|ClassAPIKeyVirtualKey)` — so the keyring composes with the FIX-5/B domain separation already shipped.

**A2. Schema stamps.** Add `keyVersion String @default("v1")` to `AdminApiKey` (`schema.prisma:148`) and `VirtualKey` (`:349`) (+ `@map("key_version")`, mirroring `Credential.encryption_key_id`). Seed/issue stamps `Current()`'s version.

**A3. Try-all-versions lookup + lazy re-hash (the one-way-hash answer).** On admission:
1. Hash the raw key under `Current()` first, `FindByKeyHash` → hit on the steady-state common case (1 hash + 1 lookup).
2. On miss, try each older version newest-first; on a hit under version `vN ≠ current`, **lazy re-hash**: recompute the hash under `Current()`, `UPDATE … SET keyHash=$new, key_version=current` for that row (single statement), then admit. (The bcrypt-cost-upgrade pattern, net-new here.)
3. Steady-state cost after a rotation window is back to 1 hash + 1 lookup; old-version keys migrate on next use; the `key_version` column lets an admin report/prune stragglers and eventually drop the retired map entry.

**TK. Token keyring (OPEN follow-up — NOT part of the shipped Layer A; rotatability for the retained shared `INTERNAL_SERVICE_TOKEN`).** With Layer B cancelled, the shared service token stays; TK (if pursued) would let the Hub hold a **set** (`"[*]vN:secret"`) and accept **old+new during a rotation window**, so rotating the shared token never forces the documented lockstep-flip 403 outage. No schema (tokens aren't stored hashed — the Hub holds the live set in memory from env). This is the lighter-weight open follow-up for W2-02; it is independent of the cancelled per-node-identity work. (Relabeled from "A4" to avoid colliding with the shipped Layer A implementation step A-4, the ai-gw VK try-all.)

### Layer B — CANCELLED (W2-02 C3 risk-accepted)

Layer B (per-edge tokens / per-node mTLS to replace the shared `INTERNAL_SERVICE_TOKEN`) was **explored and dropped**; the C3 residual is **risk-accepted**. The existing shared-token model is retained, the agent keeps its per-device token, and no new auth mechanism is added. See the "Layer B — CANCELLED" record near the end of this doc for the full rationale and re-open trigger.

### Layer C — KMS envelope custody (W2-03 #4)

**C1. Promote the package.** Move `compliance-proxy/internal/tls/kms` → `packages/shared/<bucket>/kms` (likely `shared/storage/kms` or `shared/core/kms`), unchanged interfaces (`KMSProvider`/`Encryptor`/`NoopProvider`/`CommandProvider`). compliance-proxy imports the shared package (its CA-key path is unchanged).

**C2. Generalize from "CA PEM" to "any root secret."** Each service, at boot, for each of its root secrets: read an **env-wrapped blob** (`<SECRET>_WRAPPED`, base64 ciphertext) + the provider **argv config** (yaml, no secret), call `provider.Decrypt` once into a process-memory field — exactly the `issuer.go:105` one-shot pattern. `Provider: "noop"` (default) keeps today's raw-env behavior for dev / the appliance's simplest mode, so this is **non-breaking when unconfigured**.

**C3. Least-privilege per secret (memory decision).** Separate wrapped blob + grant per secret, so a service's KMS grant covers only ITS OWN secrets (e.g. ai-gw decrypts the credential key + its edge token, not the HMAC secret). NOT a single bundle. NOT Hub-brokered — each service unwraps its own at boot with its own grant; the Hub may distribute only **non-secret references** (which alias / wrapped-blob id) as ordinary config.

**C4. Coverage.** `CREDENTIAL_ENCRYPTION_KEY`/`CREDENTIAL_KEY_MAP`, `ADMIN_KEY_HMAC_SECRET`/`ADMIN_KEY_HMAC_KEY_MAP`, the per-edge `HUB_TOKEN_*`, `HUB_CONFIG_TOKEN`, `COMPLIANCE_PROXY_API_TOKEN`. (The compliance-proxy CA key already done.)

## How the layers compose (orthogonality)

- KMS (C) does NOT fix one-secret-two-domains or rotation — it only stops an env/backup reader. Keyring (A) does NOT stop an env reader — it bounds blast radius on rotation. Per-edge (B) does NOT custody or version — it scopes. All three are needed; none replaces another (the [[project-kms-envelope-custody]] memory states this explicitly).
- The keyring's `*current` map values become KMS-wrapped blobs under Layer C — i.e. `ADMIN_KEY_HMAC_KEY_MAP` entries are themselves unwrapped at boot. The layers stack cleanly.

## The organizing axis — TWO node classes (load-bearing, 2026-06-09)

The fleet has two structurally different node classes, and the custody + identity model differs per class. The whole design is organized around this:

| | **Service (on a server)** | **Desktop agent (on a user's computer)** |
| --- | --- | --- |
| Host control | operator (systemd / K8s Secret) | the END USER — operator does NOT control the host; on-disk material is readable by the user / local malware |
| Holds | the fleet ROOT secrets (`CREDENTIAL_ENCRYPTION_KEY`, `ADMIN_KEY_HMAC_SECRET`, service token) | ONLY its own per-device material (device cert/token, local SQLCipher key); **never the fleet roots** |
| Identity today | a SHARED bearer (`INTERNAL_SERVICE_TOKEN`) ← the W2-02 problem | ALREADY per-device **mTLS** (agent-CA enrolled) |
| At-rest custody fit | KMS / sops+age / vault (server-side) | OS keystore (Keychain / DPAPI / kernel keyring) — you can't give a user laptop a fleet KMS grant |

Consequences that shape the layers:
- **Custody is two stories under ONE abstraction.** The promoted `kms` package is one pluggable `Provider` interface; **server services** use KMS/command providers (this pass), **desktop agents** use an OS-keystore provider — which is exactly the deferred **SEC-M4-02** (needs a macOS host). Agents are out of scope for the root-secret custody because they don't hold the roots.
- **Identity converges, it doesn't fork.** Agents already have per-node mTLS; the right end-state for services is the SAME model (per-service certs, reusing the agent enrollment CA) — NOT a throwaway shared-token interim. North star: **every node, service or agent, has its own identity; the fleet has no shared bearer secret.** C2 (shipped) is literally the service↔agent boundary (a service token can't impersonate an agent).

## Fresh-dev posture (binding — CLAUDE.md development-phase policy)

Pre-GA, no installed users. Every layer is built in its **cleanest final form + dev re-seed**: **no migration code, no `<SECRET>`-vs-`<SECRET>_WRAPPED` backward-compat precedence dance, no parallel legacy paths, no accept-old+new *deploy* cutover window, no rollback flags** (rollback = `git revert`). (The keyring's *runtime* multi-version acceptance is the product feature of rotation itself — legitimate; the *deploy* cutover is a clean swap + re-seed.) This dissolves most of the design-review's "don't break existing deploys" concerns: there is nothing to not-break.

## Decisions (LOCKED 2026-06-09, with user)

1. **Scope this pass: C + A only. B and M4-02 deferred** (was "C→A→B"). C and A are server-side; both built cleanly + dev re-seed.
2. **A — FULL versioned HMAC keyring.** `ADMIN_KEY_HMAC_KEY_MAP` (+ `key_version` columns) for GA-grade non-disruptive rotation. **admin keys lazy-rehash on the CP auth path** (CP owns the table, can write); **VKs do NOT lazy-migrate** (ai-gw auth path is read-only) — they ride `try-all-versions` and are pruned by re-issue/expiry. New keys stamped `v1`; **no hash migration** (re-seed).
3. **C — KMS custody, server services, per-SERVICE grant, crown jewels first.** Promote `compliance-proxy/internal/tls/kms` → shared; ONE pluggable provider interface (server KMS now, agent OS-keystore = M4-02 later). Wrap `CREDENTIAL_ENCRYPTION_KEY` + `ADMIN_KEY_HMAC_SECRET` first. Each service unwraps its OWN secret set with one grant (`per-service bundle` default; per-secret separate grants = opt-in). Provider switch: `noop` (dev, reads raw env) / `command` (prod, reads the wrapped blob) — a clean config choice, NOT a compat fallback.
4. **C provider surface: argv `CommandProvider`** (cloud-agnostic aws/sops/age/vault, zero new SDK deps, single-binary appliance). No native AWS-KMS SDK this pass.
5. **B — when done: per-node mTLS for services, reusing the agent enrollment CA**, retiring `INTERNAL_SERVICE_TOKEN` in one clean swap (no compat window). NOT named tokens (the roadmap would only delete that interim). Deferred to GA-prep. Its full token-edge inventory (the Hub registration edge + the CP→ai-gw `/v1/ai-guard/classify` `X-RS-Token` edge + the compliance-proxy→Hub attestation-pubkey edge) is captured for that pass.

## Work order & sequencing (THIS PASS: C → A; B + M4-02 deferred)

**C (KMS custody, server services) — in 2 commits:**
1. **C-1 promote:** move `compliance-proxy/internal/tls/kms` → `packages/shared/core/kms` (imports only stdlib — no new shared deps, no cycle); re-import in compliance-proxy (CA path unchanged). Build all 5 + sweeps; pure refactor commit.
2. **C-2 generic custody + crown jewels:** a per-service custody loader — yaml `secretCustody.{provider,command}` (argv only, no secret in yaml); `provider: noop` reads raw `<NAME>` env (dev), `provider: command` reads the wrapped `<NAME>` blob → `Provider.Decrypt` once at boot. Wire `CREDENTIAL_ENCRYPTION_KEY` + `ADMIN_KEY_HMAC_SECRET` on CP + ai-gw through it. Regression: noop == raw-identity; command round-trips via a fake decrypt cmd; boot fail-closed when a wrapped secret can't unwrap.

**A (HMAC keyring) — SHIPPED (after C):** `key_version` columns on `AdminApiKey` + `VirtualKey`; `ADMIN_KEY_HMAC_KEY_MAP` (mirrors `CREDENTIAL_KEY_MAP`, `*current` marker); `try-all-versions` current-first in `apikey.go` (CP) + `vkauth.go` (ai-gw); admin-key **lazy-rehash** on the CP path; VK **no lazy-migrate** (read-only path) → pruned by re-issue/expiry. New keys stamped `Current()`; **no hash migration** (dev re-seed). Implemented across A-1..A-4:
- **A-1** (`packages/shared/core/hmackeyring`) — keyring parser (`New`/`Single`/`Current`/`All`), HMAC counterpart of `crypto.MultiVault`.
- **A-2** — `key_version String @default("v1") @map("key_version")` on both tables + migration `20260625000000_admin_vk_hmac_key_version`.
- **A-3** (CP admin keys) — `auth` injects a `*hmackeyring.Keyring` (replacing the single secret); `HashAPIKeyVersions` try-all + `adminauth` lazy-rehash via the `AdminAPIKeyRehasher` seam (`apikeystore.UpdateKeyHashAndVersion`, touches ONLY keyHash+key_version); issue/rotate stamp `CurrentKeyVersion()`. CP `validate()` accepts secret OR map.
- **A-4** (ai-gw VKs) — `vkauth.NewAuthenticator` takes the keyring, derives a VK sub-key per version, `lookupVK` tries all current-first with NO lazy migrate; ai-gw `validate()`/`InitVKAuth` accept secret OR map; CP VK issue/regenerate stamp the version. Single-secret mode is byte-identical (Single→v1), so the CP↔ai-gw VK `[MUST MATCH]` holds in both modes. Regression suites: rotate-while-authing (admin lazy-migrates; VK keeps working without migrating), keyring parse/order/fail-closed, cross-service hash equivalence. **Residual:** the ai-gateway live smoke (env-gated; single-secret path is provably unchanged, unit + config-load regressions cover the keyring derive→hash chain).

**B (deferred → GA-prep): per-node mTLS for services**, reusing the agent enrollment CA; one clean swap retiring `INTERNAL_SERVICE_TOKEN`. Token-edge inventory to cover: Hub registration/WS, CP→ai-gw `/v1/ai-guard/classify` `X-RS-Token`, compliance-proxy→Hub attestation-pubkey GET. **M4-02 (deferred → Mac host): agent OS-keystore provider** dropped into the same `kms.Provider` interface from C.

Each layer/commit: re-validate finding probe → implement (cleanest form, dev re-seed, **no migration/compat code**) → regression test asserting the closed invariant → build all 5 → full affected-service sweep → doc/finding/ledger + prod-deploy lockstep. New env/config = `.env.example` entry + prod-deploy SKILL.md step + dev-start.sh default + boot-required fail-closed check (the C1 pattern). These are **L2 env / yaml-shape config, not configKeys** — the `shared/schemas/configkey` registry does not apply; conformance is to `configuration-architecture.md` for the env/yaml split.

## Risks (fresh-dev re-scoped)

- **C custody is server-only.** Desktop agents must NOT be wired through the KMS path (they don't hold the roots, can't take a fleet grant); their at-rest custody is M4-02 (OS keystore) — keep the `Provider` interface able to host it later, but do not implement it now.
- **C `noop` default is a dev convenience, not a compat fallback.** Fresh-dev: there is no old plaintext deploy to protect, so the provider switch is a clean config choice (`noop` raw vs `command` wrapped), not a dual-read precedence contract. Still: boot fail-closed if `provider: command` and a secret won't unwrap.
- **A lazy-rehash is net-new + asymmetric.** admin keys (CP, writable) lazy-migrate; VKs (ai-gw, read-only) do not — designed behavior, not a gap. The lazy UPDATE touches ONLY `keyHash`+`key_version`, never the admin-key rotation-lifecycle columns (`status`/`rotatingAt`/`rotatedFromId`). Concurrency: two parallel auths recompute the *same* deterministic hash → idempotent row-targeted UPDATE.
- **No migration code anywhere** (dev-phase): A/C deploy = dev re-seed; rollback = `git revert`.

## Promote target

`packages/shared/core/kms` (sibling to `keyderive`; stdlib-only, so it stays within the vetted core tier and adds no dependency).

## Layer C — post-implementation review findings (2026-06-09) — RESOLVED

C-1 (`ccd8fc32a`, promote) + C-2 (`b1cd3278f`, custody loader + crown-jewel wiring) shipped. The end-of-phase dual review (2 fresh Opus) found the **`noop` default is safe and byte-identical**, but the **`command` provider was broken end-to-end** for two crown-jewel consumers that read the secret from `os.Getenv` at point-of-use, bypassing the config field the custody loader populates. ai-gateway was already correct (reads from config). **Both gaps are now FIXED** (the two command-mode commits below); `command` mode is usable end-to-end across all four server services.

1. **CP HMAC was a dead write (HIGH) — FIXED.** `resolveCustodySecrets` set `cfg.Auth.HMACSecret`, but CP's hashing read `os.Getenv("ADMIN_KEY_HMAC_SECRET")` directly via `auth.HMACSecret()` (`control-plane/internal/identity/authn/apikey.go`, used by `hashKeyForClass` → `HashAPIKey`/`HashVirtualKey`). Under `command` CP would have hashed every admin key + VK under the **wrapped blob**, silently breaking all admin/VK auth and the VK `[MUST MATCH]` with ai-gw. **Fix shipped:** the env read is retired in favour of a package-level `injectedHMACSecret` installed once at boot by `auth.InitHMACSecret(cfg.Auth.HMACSecret)` (wiring.InitBootstrap), mirroring ai-gw's `InitVKAuth(hmacSecret)`. CP `validate()` now carries the HMAC required-check (was absent; the old gate was the env-reading `auth.ValidateHMACSecret()`, now removed). Regression: the admin/VK hash depends ONLY on the injected plaintext, so the `command`-unwrapped value and the `noop`/plaintext value produce the SAME hash, never a wrapped-blob hash.
2. **Hub `CREDENTIAL_ENCRYPTION_KEY` not wired (HIGH) — FIXED.** `CREDENTIAL_ENCRYPTION_KEY` is a **3-service** `[MUST MATCH]` (CP ↔ ai-gw ↔ **Hub**); Hub consumes it for alert-channel secrets (`nexus-hub/internal/alerts/engine/secret.go`, REQUIRED + fail-closed). Hub had no `secretCustody` wiring, so (a) Hub's crown jewel stayed plaintext-at-rest (the W2-03 gap, unclosed for Hub) and (b) wrapping the shared env var would have made Hub read a base64 blob as 64-hex → **unbootable**. **Fix shipped:** Hub config gains `SecretCustody kms.CustodyConfig` + `resolveCustodySecrets(CREDENTIAL_ENCRYPTION_KEY)` → `cfg.Auth.CredentialMasterKey`; `ChannelSecretCipherFromEnv` is replaced by `ChannelSecretCipherFromKey(keyHex)`, fed the resolved plaintext through `InitAlerts(pool, credentialMasterKey, logger)`. Hub's crown jewel is now custodied like CP's + ai-gw's.

**Net:** every crown jewel's consumers now read the custody-resolved field, so `command` mode wraps `CREDENTIAL_ENCRYPTION_KEY` (3-service) and `ADMIN_KEY_HMAC_SECRET` (CP + ai-gw) end-to-end. (Remaining non-blocking follow-up: the `secretCustody` vs compliance-proxy `ca.kms` config shapes could eventually unify via an embedded `CustodyConfig`.)

### Layer C remaining work — DONE
1. ✅ CP HMAC: injected resolved `cfg.Auth.HMACSecret` into `apikey` hashing; retired the `os.Getenv` read; added CP `validate()` HMAC required-check; regression asserts `command` produces the SAME hash as `noop`/plaintext (not the wrapped-blob hash).
2. ✅ Hub: `SecretCustody` + `resolveCustodySecrets(CREDENTIAL_ENCRYPTION_KEY)` in Hub config; unwrapped value fed to `ChannelSecretCipherFromKey`; regression asserts `command` unwraps + the noop raw-passthrough + fail-closed on an unwrappable blob.
3. prod-deploy SKILL.md wrapping runbook (out-of-band blob creation, `kms:Decrypt` grant, per-service yaml + grant) — added in the same commit as the code fix.
4. **Live `command`-mode smoke (deferred to a live env):** re-run the ai-gateway credential-decrypt + admin/VK-auth smoke once `command` is exercised against a real KMS/sops/age/vault in a deployed environment. Unit + config-load regressions cover the unwrap → inject → hash/decrypt chain; the live smoke is the final cross-service confirmation and is gated on a deployment with a real decrypt provider configured.
5. Then end-of-phase dual review again; THEN Layer A.

## Layer B — CANCELLED (W2-02 C3 residual RISK-ACCEPTED, 2026-06-09)

> **Status: CANCELLED — NOT IMPLEMENTED.** Layer B (retire the shared `INTERNAL_SERVICE_TOKEN`, replace service↔Hub edges with per-node mTLS) was explored and **dropped**. The current model is **retained unchanged**: backend services authenticate to the Hub and to each other with the shared `INTERNAL_SERVICE_TOKEN` (`ServiceAuth` Bearer + `rstokenauth` `X-RS-Token`); the **desktop agent uses its per-device token** to the Hub and is **not** in the service-token chain. The SEC-W2-02 **C3 residual is RISK-ACCEPTED** rather than closed. No new auth mechanism is introduced — in particular the ai-gw `/v1/ai-guard/classify` gate keeps the `INTERNAL_SERVICE_TOKEN` it had.
>
> **Why (maintainer decision).** Implementation surfaced that the design's §B2 assumption — `tls.RequireAndVerifyClientCert` on the Hub's "service-facing listeners" — does not fit the code: the Hub serves **everything on one plain-HTTP port (3060)** (health, agent enrollment, `/ws`, `/api/internal/things/*`), and `/ws` + `/api/internal/things/*` are **shared between services (token) and agents**, where agents structurally **cannot present an mTLS client cert** (their attestation cert carries no ClientAuth EKU by design). Requiring client certs there would break every agent; the only routes were a `VerifyClientCertIfGiven` mixed-auth listener or a second mTLS port — both moving the whole Hub + every agent onto TLS to narrow a residual that is already bounded. The maintainer accepted the residual instead. Rationale (full version in the SEC-W2-02 finding STATUS): the residual is bounded by the shipped [[security-audit-program]] SEC-C3-02 (break-glass is per-Thing-override only, never the fleet kill-switch); exploiting it requires **first compromising a backend-service process** on an operator-controlled host, at which point that node's own identity is already breached; and a single shared service token is an acceptable trust assumption for an internal, operator-controlled, pre-GA mesh.
>
> **What was undone.** The only landed Layer B code — `agentca.SignServiceCSR` / `ServiceIdentityFromCert` (B-1, commit `d38233240`) — was **reverted** as unused speculative surface. No config keys, listeners, or `dev-start.sh` were changed.
>
> **Re-open trigger.** If the trust model tightens (multi-tenant hosting, untrusted co-located services, a per-node-identity compliance requirement), recover the full mTLS design (CA & cert profile, operator-provisioned delivery, cert→identity binding, clean-swap stages) from git history at commit `1da6da88a` and the reverted B-1 capability from `d38233240`. The TK token-keyring follow-up (shared-token rotatability without a lockstep flip) remains the lighter-weight open item for the retained shared token.

## Memory anchors

- [[project-kms-envelope-custody]] — the custody decision (shared lib, not Hub-brokered, local-or-AWS pluggable).
- [[security-audit-program]] — the parent program; this is the post-FIX-5 follow-up cluster.
- [[feedback-perfect-product-no-complexity-compromise]] — drives the "full keyring" / "real per-edge" defaults over half-measures.
