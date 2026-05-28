# IdP & SSO Architecture

How the Control Plane integrates identity providers (IdPs) so administrators
and end users sign in, and how external directory users become Nexus users.

Nexus is the **service provider (SP)**: it consumes assertions/tokens issued by
external IdPs and never acts as one to a third party. "IdP" in this document
always means an external provider (Okta, Azure AD, Google Workspace, …). The
built-in local password store is the implicit fallback, not a peer IdP.

The subsystem has five parts, each its own section below:

1. The `IdentityProvider` data model and its two stores.
2. The admin configuration plane (CRUD, connectivity probe, secret handling,
   group mappings, SCIM tokens).
3. Interactive login (the auth server): the method picker, local password, and
   the unified external-IdP SSO entry plus the OIDC and SAML return legs.
4. Federated identity and just-in-time (JIT) provisioning.
5. SCIM provisioning and agent SSO enrollment.

## IdentityProvider model

Every provider is one `IdentityProvider` row. `type` is `local`, `oidc`, or
`saml`. The row carries `name`, `enabled`, a per-protocol `config` JSONB blob, a
`roleMapping` JSONB array, `defaultRole`, and `jitEnabled`.

Two stores read the same table for different audiences:

- **Runtime** — `packages/control-plane/internal/identity/authserver/store/idp_store.go`
  (`IdPStore`) serves the login path with `ListEnabled`, `GetByID`, and
  `GetLocal`.
- **Admin** — `packages/control-plane/internal/identity/scim/scimstore`
  (`IdentityProviderRecord`) backs the CRUD handler.

The per-protocol `config` blob is decoded into a typed shape at use time.
`DecodeOIDCConfig` reads `issuer`, `jwksUri`, `clientId`, `clientSecret`,
`redirectUri`, `authorizeUrl`, `tokenUrl`, `audience`, `emailClaim` (defaulting
`emailClaim` to `email`). `DecodeSAMLConfig` reads `entityId`, `ssoUrl`,
`certificatePem`, and the email/groups attribute names (defaulting to `email`
and `groups`).

Roles are **not** an IdP-adapter concern: `NexusUser` has no role column, and a
principal's permissions are resolved from IamPolicy at token-issuance time. The
IdP layer only authenticates and surfaces the external identity. See
[iam-identity-architecture.md](iam-identity-architecture.md).

## Admin configuration plane

`packages/control-plane/internal/identity/users/handler/identity_provider.go`
registers the admin surface under the admin API group:

- IdP CRUD: `GET`/`POST` `/identity-providers`, `GET`/`PUT`/`DELETE`
  `/identity-providers/:idpId`.
- Connectivity probe: `POST /identity-providers/test` (a candidate, unsaved
  config) and `POST /identity-providers/:idpId/test` (a saved row).
- SCIM tokens: `GET`/`POST`/`DELETE` `/identity-provider/:idpId/scim-tokens`.
- Group mappings: `GET`/`POST`/`DELETE`
  `/identity-provider/:idpId/group-mappings`.

Each route is gated by an IAM action on the `IdentityProvider` resource — read,
create, update, delete, or probe. Generating a SCIM token and editing group
mappings are gated by the **update** verb, because both confer provisioning
authority on the IdP they attach to.

**The local row is platform-owned.** Create rejects `type: "local"`, and update
and delete on the local row return 403. Only `oidc` and `saml` rows are
admin-managed.

**Secret fields never leave the server in cleartext.** `clientSecret` (OIDC) and
`certificatePem` (SAML) are replaced with a fixed mask on read; on write the same
mask means "leave unchanged", restored from the stored value before persisting,
so the admin UI round-trips a provider without ever holding the secret. Create
requires the real secret.

**The probe** (`packages/control-plane/internal/identity/idptest`) checks
reachability without persisting: `ProbeOIDC` fetches the discovery document
and/or JWKS and confirms it parses with at least one key; `ProbeSAML` parses the
certificate PEM, rejects an expired certificate, and validates the SSO URL
shape. Both are bounded by a 10-second timeout.

**Disabling or deleting an IdP invalidates its users' sessions.** On an
enabled→disabled update, and on a forced delete, the handler snapshots the users
linked to that IdP and fans out user-scoped revocations; the revocation
propagates over the message queue to the AI Gateway and Compliance Proxy
verifiers. A delete without `?force=true` is refused with 409 while federated
identities are still linked.

## Interactive login

The login UI — the method picker and the local password form — is served by the
Control Plane SPA. The auth server exposes JSON and redirect endpoints the SPA
drives; it renders no login HTML itself. `/oauth/authorize` mints the pending
authorize handle (`authctx`) and redirects the browser to the SPA's `/login`
page carrying that handle. See
[oauth-pkce-admin-auth-architecture.md](oauth-pkce-admin-auth-architecture.md).

**Method picker.** `GET /authserver/idps` returns the enabled providers
(`id`, `type`, `name`) for a live `authctx`. The SPA renders the local provider
as an inline password form and every non-local provider as an SSO button.

**Local password.** `POST /authserver/password` authenticates against the local
store via the `idp.Local` adapter
(`packages/control-plane/internal/identity/authserver/idp/local.go`): scrypt
verification, constant-time behaviour across user-missing / no-password /
disabled outcomes to block enumeration, rate limiting, and `admin.login.failed`
/ `admin.login.succeeded` audit rows. On success it mints a single-use
authorization code and returns the redirect URI for the SPA to follow.

**Unified external-IdP entry.** For any external provider the SPA navigates the
browser to `GET /authserver/idp/:idpId/start?authctx=<handle>`
(`packages/control-plane/internal/identity/authserver/login/start.go`). One
handler owns the protocol divergence so the front end stays protocol-agnostic:

- `oidc` — builds the authorization URL, stamps the chosen IdP id onto the
  pending entry, and 302-redirects the browser to the provider, carrying the
  `authctx` as `state`.
- `saml` — builds an SP-initiated AuthnRequest, records its ID against the
  `authctx`, and returns an auto-submitting HTML POST form that delivers the
  request to the IdP with `RelayState=<authctx>` (HTTP-POST binding).
- `local` / unknown / disabled / unconfigured — 302 back to the SPA `/login`
  page rather than emitting a server error body, so the user always lands on the
  front-end login UI.

**Return legs.** The external IdP sends the user back to a return endpoint:

- OIDC — `GET /authserver/oidc/callback`
  (`packages/control-plane/internal/identity/authserver/login/oidc.go`):
  exchanges the code at the IdP token endpoint, validates the ID token against
  that IdP's JWKS, and refuses a disabled IdP.
- SAML — `POST /authserver/saml/acs`
  (`packages/control-plane/internal/identity/authserver/login/saml.go`):
  `ServiceProvider.ParseResponse` validates the XML signature against the IdP
  certificate, the audience (the SP entityID), the not-before/not-on-or-after
  window, the destination (the ACS URL), and `InResponseTo` against the
  outstanding single-use AuthnRequest ID bound to the `authctx`.
- SAML metadata — `GET /authserver/saml/metadata` returns the SP descriptor
  (entityID + ACS URL derived from the auth-server issuer) for admins to import
  into their IdP.

Both return legs extract the external subject (and email/groups), run the shared
match-or-provision path, mint a single-use authorization code into the
`AuthCodeStore` bound to the pending request, and redirect to the client's
redirect URI — rejoining the OAuth + PKCE token exchange. The `authctx` is the
join key throughout: it is the OIDC `state` and the SAML `RelayState`, and it
keys the single-use `PendingAuthzStore` entry that carries the client id,
redirect URI, PKCE challenge, scope, and chosen IdP id. The minted code records
the authentication method reference (`pwd` for local, `sso` for federated).

**SP-initiated only.** A SAML response with no outstanding AuthnRequest — an
IdP-initiated response or a replay — is rejected; the ServiceProvider is built
with IdP-initiated SSO disabled. See
[saml-sso-login spec](../../../specs/saml-sso-login.md).

## Federated identity and JIT provisioning

`packages/control-plane/internal/identity/authserver/store/federated_store.go`
manages `UserFederatedIdentity` rows, each a unique `(userId, idpId,
externalSubject)` binding. Both return legs resolve the external subject the same
way:

- `FindByIdPSubject` hit → use the linked user.
- miss and the IdP has JIT enabled → `JITProvisionUser` creates a `NexusUser`
  (`source` `oidc`, `canAccessControlPlane` false), the federated-identity row,
  and zero-or-more group memberships, in one transaction.
- miss and JIT disabled → the login is refused (`user_not_provisioned`).

Group membership is derived from the provider's groups claim/attribute: each
external group is resolved through `IdpGroupMapping` (`identityProviderId`,
`externalGroupId`) to a local IAM group, and a matching `IamGroupMembership` row
(principal type `nexus_user`) is written. External groups with no mapping are
silently skipped — administrators consume only the mappings they opted into. The
OIDC JIT, SAML JIT, and SCIM provisioning paths share this mapping convention so
all three produce identically-shaped membership rows.

## SCIM provisioning and agent enrollment

**SCIM.** `packages/control-plane/internal/identity/scim/handler` mounts SCIM 2.0
under `/scim/v2` (Users and Groups, plus `ServiceProviderConfig`/`Schemas`),
authenticated by a Bearer token looked up by SHA-256 hash. A SCIM token may be
scoped to a specific IdP. This is the push side of provisioning: the external
directory creates and deactivates users and group memberships ahead of (or
instead of) interactive JIT, using the same group-mapping convention.

**Agent SSO enrollment.**
`packages/control-plane/internal/identity/sso/handler` exposes
`POST /api/agent/sso-enroll`, which the desktop agent calls after completing the
browser login flow: it consumes the OAuth authorization code plus the PKCE
verifier, refuses when device authentication is set to mTLS-only, confirms the
user is active, enforces the `device-enrollment.enroll` IAM action with the
auth-code's owning user as the principal, and issues a short-lived enrollment JWT
for the Hub. The agent reaches the same picker → start → return-leg flow by
opening a browser to `/oauth/authorize`; it depends on no SSO-specific path.

## IdP adapter contract

`packages/control-plane/internal/identity/authserver/idp` defines the
`IdP.Authenticate` contract returning a normalized `AuthResult` (user id, IdP id,
email, AMR). The local adapter implements it; OIDC and SAML authenticate through
their dedicated start + return-leg handlers rather than the synchronous
`Authenticate` method, because their flows are redirect-based round trips. In all
cases the adapter only authenticates — it never resolves roles.

## References

- `packages/control-plane/internal/identity/authserver/store/idp_store.go` — runtime IdP store
- `packages/control-plane/internal/identity/authserver/store/idp_oidc_config.go` — OIDC config decode
- `packages/control-plane/internal/identity/authserver/store/idp_saml_config.go` — SAML config decode
- `packages/control-plane/internal/identity/users/handler/identity_provider.go` — admin CRUD, probe, SCIM tokens, group mappings
- `packages/control-plane/internal/identity/idptest` — OIDC/SAML connectivity probes
- `packages/control-plane/internal/identity/authserver/login/start.go` — unified external-IdP SSO entry
- `packages/control-plane/internal/identity/authserver/login/oidc.go` — OIDC callback + token exchange
- `packages/control-plane/internal/identity/authserver/login/saml.go` — SAML ACS + metadata + extraction
- `packages/control-plane/internal/identity/authserver/login/saml_sp.go` — per-IdP ServiceProvider builder
- `packages/control-plane/internal/identity/authserver/login/password.go` — local password login
- `packages/control-plane/internal/identity/authserver/login/idps.go` — method-picker list
- `packages/control-plane/internal/identity/authserver/idp/local.go` — local adapter
- `packages/control-plane/internal/identity/authserver/store/pending.go` — pending authorize handle
- `packages/control-plane/internal/identity/authserver/store/federated_store.go` — federated identity + JIT
- `packages/control-plane/internal/identity/scim/handler` — SCIM 2.0 endpoints
- `packages/control-plane/internal/identity/sso/handler` — agent SSO enrollment
- `packages/control-plane/internal/identity/authserver/mount.go` — route wiring
