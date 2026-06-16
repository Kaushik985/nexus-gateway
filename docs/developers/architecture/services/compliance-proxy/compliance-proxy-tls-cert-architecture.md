# Compliance Proxy TLS interception & certificate architecture

To inspect a TLS flow the Compliance Proxy must present a leaf certificate for
the target hostname, signed by an enterprise CA the client already trusts. This
doc covers how that certificate is issued, cached, and how the CA private key is
protected — plus how certificate pinning is handled on the bump path.

## What this doc covers (and what it does not)

The forward gate that decides bump-vs-passthrough is in
[compliance-proxy-connect-forward-architecture.md](compliance-proxy-connect-forward-architecture.md);
the shared TLS bump handshake + hook execution lives in
`packages/shared/transport/tlsbump` and is described from the Agent side in
[agent-forwarder-architecture.md](../agent/agent-forwarder-architecture.md).
This doc is the certificate-supply side that the bump consumes.

## 1. Leaf certificate issuance

`tls/issuer` (`packages/compliance-proxy/internal/tls/issuer`) signs a leaf
certificate per target hostname with an ECDSA P-256 key via
`x509.CreateCertificate`, chained to the enterprise CA. Leaf private keys that
are cached are encrypted with AES-256-GCM under a key derived via HKDF (salt
`nexus-cert-cache`, info `aes-256-gcm`), so the cache never stores a plaintext
private key. The HKDF **input keying material (IKM)** depends on the signing
mode:

- **Local mode** (`signingMode: local`, the default) — IKM is the CA private
  key DER. The key already lives in process memory, so the cache key is bound
  to it for free.
- **Remote mode** (`signingMode: remote`) — the CA private key never exists
  locally, so the IKM is a KMS-managed 32-byte **data-encryption key (DEK)**,
  not any CA material. See §3a. (Deriving the IKM from the *public* CA cert
  would be a flaw: anyone with Redis read access plus the published CA cert
  could decrypt every cached leaf private key.)

## 2. Two-layer certificate cache

`tls/cache` (`packages/compliance-proxy/internal/tls/cache`) sits in front of
the issuer as two layers, then a sign on miss:

1. **In-memory LRU** — the hot path; bounded, per-process.
2. **Redis** — shared across restarts and across proxy instances, under the key
   prefix `nexus:proxy:cert:`. Each entry stores the AES-256-GCM-encrypted leaf
   private key plus the certificate chain.
3. **Sign on miss** — fall through to `tls/issuer` and populate both layers.

## 3. CA key protection via KMS envelope

The CA private key is unwrapped **once at startup**, never per signature.
`kms` (`packages/shared/core/kms`, the shared envelope-custody package; promoted
out of compliance-proxy so the fleet root secrets can reuse it) abstracts the
unwrap behind the `KMSProvider` interface:

- **`NoopProvider`** — the default; the CA key is a raw PEM on disk.
- **`CommandProvider`** — shells out to a configurable command (AWS KMS, `sops`,
  age, Vault, …) with a `{file}` placeholder for the ciphertext path.

The unwrapped key is held in memory and used by the in-process issuer; signing
never re-invokes the KMS.

In remote mode the CA private key is never on disk at all — every signature
goes through a `CommandSigner` (`tls/issuer/remote_signer.go`) that shells out
to the configured `ca.kms.signCommand` (grant `kms:Sign`).

## 3a. Cert-cache DEK envelope (remote mode)

In remote mode there is no local CA key to derive the cache key from, so the
proxy **self-bootstraps** a KMS-wrapped DEK — zero manual key ceremony:

1. At startup the issuer reads the wrapped DEK blob from Redis at the
   well-known key `nexus:proxy:cert-cache-dek`.
2. **Absent** (first boot in a fresh deployment): generate a fresh 32-byte DEK
   via `crypto/rand`, wrap it with KMS Encrypt (`ca.kms.encryptCommand`, grant
   `kms:Encrypt`), and persist the wrapped blob via Redis `SETNX`. KMS
   ciphertext is safe to store in Redis. If `SETNX` loses a race against
   another instance booting concurrently, re-read the winner's blob and use
   it, so every instance converges on one DEK.
3. **Present** (restart, or a second instance): read the blob and KMS Decrypt
   it (`ca.kms.command`, grant `kms:Decrypt`) to recover the DEK.
4. The DEK becomes the HKDF IKM (§1). The on-the-wire AES-GCM cache format is
   unchanged — only the IKM source differs from local mode.

The DEK is loaded **once at boot** into memory; runtime cache reads/writes
never call KMS (no hot-path KMS dependency). A mid-run Redis or cache-decrypt
failure degrades to signing a fresh leaf, exactly as in local mode — it never
crashes the proxy.

**Fail-closed.** Remote mode requires Redis plus both KMS commands. A missing
Redis client, a missing `ca.kms.encryptCommand` / `ca.kms.command`, a KMS
Encrypt/Decrypt failure, or an unreadable wrapped blob aborts startup with an
error naming the responsible config field and operator grant. The issuer never
falls back to deriving the key from CA bytes.

### Operator runbook — cert-cache DEK

- **First boot**: nothing to do. The proxy generates, wraps, and stores the
  DEK automatically. Required IAM grants on the KMS key: `kms:Encrypt`,
  `kms:Decrypt`, `kms:Sign`.
- **Restart / scale-out**: every instance reads the same wrapped DEK from
  Redis and unwraps it — cached leaf keys survive restarts and are shared
  across instances. `SETNX` makes concurrent first-boots safe.
- **Rotation**: delete the Redis key `nexus:proxy:cert-cache-dek`. The next
  instance to boot mints a fresh DEK. Per-host cache entries under
  `nexus:proxy:cert:` that were encrypted under the old DEK then fail to
  decrypt and are transparently re-signed — no manual cache flush needed.
- **Failure messages** all name the fix: e.g. *"remote signing mode requires
  ca.kms.encryptCommand (KMS encrypt argv; grant kms:Encrypt)"*, *"KMS …
  decrypt cert-cache DEK failed (check ca.kms.command and the kms:Decrypt
  grant)"*, *"remote signing mode requires Redis … (set redis.addrs /
  REDIS_ADDRS)"*.

KMS credentials themselves are **ambient to the proxy process** (e.g. the AWS
SDK's standard environment / instance role consumed by `encryptCommand` /
`command` / `signCommand`); they are not Nexus config and never appear in
yaml.

## 4. Certificate pinning

When a client pins certificates, the proxy cannot present its own leaf, so the
bump must fall back to passthrough rather than break the connection. The active
pinning tracker is the shared `tlsbump.PinningTracker`
(`packages/shared/transport/tlsbump`), wired into the proxy via
`cmd/compliance-proxy/wiring/pinning.go`. The forward gate consults it for
exemptions before bumping and records a failure that triggers passthrough when a
bump hits a pinning error (see
[compliance-proxy-connect-forward-architecture.md](compliance-proxy-connect-forward-architecture.md)).

## References

- `packages/compliance-proxy/internal/tls/issuer/` — leaf cert signing (ECDSA P-256), AES-GCM key encryption; `remote_signer.go` = remote `CommandSigner` + cert-cache DEK bootstrap (`cert_cache_dek.go`)
- `packages/compliance-proxy/internal/tls/cache/` — LRU → Redis (`nexus:proxy:cert:`) → sign cache
- `packages/shared/core/kms/` — shared envelope-custody package: CA key + DEK envelope (`NoopProvider`, `CommandProvider` decrypt, `CommandEncryptor` encrypt). Promoted from compliance-proxy so server services can reuse it for root-secret custody.
- Redis key `nexus:proxy:cert-cache-dek` — the KMS-wrapped cert-cache DEK (remote mode); delete to rotate
- `packages/compliance-proxy/cmd/compliance-proxy/wiring/cert.go` — issuer + cache + KMS wiring, `redisDEKStore` adapter
- `packages/shared/transport/tlsbump/` — shared bump + `PinningTracker`
- `packages/compliance-proxy/cmd/compliance-proxy/wiring/pinning.go` — pinning tracker wiring
