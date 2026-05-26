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
are cached are encrypted with AES-256-GCM under a key derived from the CA
material via HKDF, so the cache never stores a plaintext private key.

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
`tls/kms` (`packages/compliance-proxy/internal/tls/kms`) abstracts the unwrap
behind the `KMSProvider` interface:

- **`NoopProvider`** — the default; the CA key is a raw PEM on disk.
- **`CommandProvider`** — shells out to a configurable command (AWS KMS, `sops`,
  age, Vault, …) with a `{file}` placeholder for the ciphertext path.

The unwrapped key is held in memory and used by the in-process issuer; signing
never re-invokes the KMS.

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

- `packages/compliance-proxy/internal/tls/issuer/` — leaf cert signing (ECDSA P-256), AES-GCM key encryption
- `packages/compliance-proxy/internal/tls/cache/` — LRU → Redis (`nexus:proxy:cert:`) → sign cache
- `packages/compliance-proxy/internal/tls/kms/` — CA key envelope unwrap (`NoopProvider`, `CommandProvider`)
- `packages/shared/transport/tlsbump/` — shared bump + `PinningTracker`
- `packages/compliance-proxy/cmd/compliance-proxy/wiring/pinning.go` — pinning tracker wiring
