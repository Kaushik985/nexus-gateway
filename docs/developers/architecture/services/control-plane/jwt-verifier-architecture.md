# JWT verifier

The JWT verifier is the verification side of the admin bearer token: it validates
the RS256 access JWT the auth server issues, against the auth server's JWKS, and
enforces revocation, before a request reaches an admin handler. The issuing side
— how that token is minted and how revocation events are produced — is in
[oauth-pkce-admin-auth-architecture.md](oauth-pkce-admin-auth-architecture.md);
what the verified claims then authorise is in
[iam-identity-architecture.md](iam-identity-architecture.md).

The verifier is single-issuer: it accepts only tokens whose issuer is the
configured CP auth server and rejects all others. Verification of external-IdP
id tokens during login (each IdP its own issuer and JWKS) is a separate concern
in the OIDC login path — see
[idp-sso-architecture.md](idp-sso-architecture.md).

## Verification

`packages/control-plane/internal/identity/jwt/` configures a verifier with the
issuer, the JWKS URL, the expected audience, a clock skew (five minutes by
default), and a revocation checker. `Verify` parses the token allowing only the
`RS256` signing method, resolves the signing key by the token's `kid` through the
JWKS cache, and applies the clock-skew leeway to the time-based claims. It then
enforces the claim expectations in order: the issuer must equal the configured
issuer, the audience must contain the configured audience, and the subject must
be non-empty — a structurally valid but principal-less token is rejected so an
empty subject never propagates into a downstream IAM or database lookup. Finally
it runs the revocation check. Each failure maps to a precise sentinel
(`ErrWrongIssuer`, `ErrWrongAudience`, `ErrMalformed`, `ErrExpired`,
`ErrNotYetValid`, `ErrInvalidSignature`, `ErrJWKSUnavailable`, `ErrRevoked`) so
the caller can surface an exact reason. The surfaced claims include the standard
registered claims plus `client_id`, `scope`, the session id `sid`, `device_id`,
`email`, `idp`, and `amr`.

## JWKS cache

The verifier fetches the issuer's RSA public keys from its JWKS endpoint and
caches them. A snapshot is cached for fifteen minutes; within that window a key
is served from memory by `kid`. Past the window the next caller triggers a
refresh, and concurrent refreshes are coalesced through a singleflight group so a
cold cache is hit upstream only once. If a refresh fails while a still-fresh
snapshot holds the requested key, that cached key is served
(stale-while-revalidate); if no key matches, the parse fails with
`ErrJWKSUnavailable`. Only `RSA` / `RS256` / signing-use keys are retained, and
keys are indexed by `kid`, so the auth server can rotate signing keys without a
verifier restart.

## Request middleware

The verifier exposes Echo middleware that requires a `Bearer` token on every
guarded request. A missing, non-Bearer, or empty token, and any verification
failure, return HTTP 401 with an RFC 6750 `WWW-Authenticate` challenge. The
challenge's `error_description` is drawn from a fixed allow-list keyed off the
error sentinels — the raw error string is never echoed back, so internal
prefixes cannot leak into or inject characters through the response header. On
success the verified claims are attached to the Echo context for handlers to read.

## Revocation

Revocation is pluggable behind a `RevocationChecker` interface; the default is a
no-op that never rejects, so real revocation is opt-in. The production checker
keeps revocation state in memory and is fed by the revocation event stream over
MQ: a Bloom filter plus an exact set of revoked token ids, and per-subject,
per-device, and per-session revocation cutoffs. A check tests the token id
against the Bloom filter first — a definite miss answers immediately; a hit
confirmed by the exact set is a revocation; a Bloom hit the exact set cannot
confirm falls through to the auth server's introspection endpoint to resolve the
false positive. The subject, device, and session cutoffs revoke a token whenever
the cutoff is later than the token's issued-at time; the session cutoff matches
on the `sid` claim, so a session revocation — including the compromise teardown a
refresh-token replay triggers on the issuing side — invalidates that session's
outstanding access tokens.

The checker fails safe. If the MQ event stream goes quiet longer than a
disconnect timeout, it flips into strict mode, where every check round-trips to
the introspection endpoint rather than trusting possibly-stale in-memory state; a
successfully applied event clears strict mode. The read lock is released before
any introspection round-trip so event application is never blocked on a network
call. The matching scopes key on the same claims the auth server emits — token
id, subject, `device_id`, and `sid` — so the verify side and the issue side stay
aligned.

## References

- `packages/control-plane/internal/identity/jwt/verifier.go` — parse + claim checks
- `packages/control-plane/internal/identity/jwt/claims.go` — surfaced claim set
- `packages/control-plane/internal/identity/jwt/jwks.go` — JWKS fetch + cache
- `packages/control-plane/internal/identity/jwt/middleware.go` — Echo bearer middleware + WWW-Authenticate
- `packages/control-plane/internal/identity/jwt/revocation.go` — RevocationChecker interface + no-op default
- `packages/control-plane/internal/identity/jwt/mqrevocation.go` — MQ-fed revocation state + introspect + strict mode
- `packages/control-plane/cmd/control-plane/wiring/jwt.go` — verifier + revocation-checker wiring
