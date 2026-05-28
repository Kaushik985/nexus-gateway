# Control Plane — AI providers & virtual keys admin

This doc covers the Control Plane's admin surface for the AI Gateway data
plane — the CRUD that shapes how the gateway authenticates, routes, prices,
caches, and rate-limits traffic. The Control Plane owns the source-of-truth
tables under `internal/ai/`; the gateway reads and enforces them. Admin writes
propagate to the AI Gateway Things through the Hub shadow. Each concern below
is the admin side only; the enforcement detail lives in the linked data-plane
and cross-cutting docs.

## Config propagation pattern

Every domain here changes a row the AI Gateway depends on, so every mutation
ends with a propagation step. Two Hub primitives are used, chosen by what the
gateway needs:

- **`NotifyConfigChange(thingType, configKey, state)`** pushes an assembled
  payload into the Thing's shadow and returns the Hub response. Used where the
  gateway needs the value itself delivered: the prompt-cache three-tier blob
  (shadow key `cache`) and the targeted virtual-key invalidate-by-hash (shadow
  key `virtual_keys`).
- **`InvalidateConfig(thingType, configKey)`** is a fire-and-forget reload
  signal; the gateway re-reads the changed rows from its own database
  connection on the next request. Used for providers, models, credentials,
  routing rules, quota policies and overrides, and the virtual-key
  approve / renew / revoke transitions that carry no per-hash payload.

Each domain talks to Hub through a narrow interface that exposes only the
primitives it needs — `HubInvalidator`, `HubVKInvalidator`, `HubConfigChanger`,
or `HubAPI`. Where the value is pushed rather than re-read (the cache blob), a
Hub failure after a successful database write returns HTTP 502 with a
`propagation_error` body; the config-reconcile loop heals the divergence within
its cycle. The propagation model and the reconcile loop are in
[control-plane-architecture.md](control-plane-architecture.md),
[configuration-architecture.md](../../cross-cutting/foundation/configuration-architecture.md),
and
[thing-config-sync-architecture.md](../../cross-cutting/foundation/thing-config-sync-architecture.md).

## Providers, models, credentials

`internal/ai/providers/` owns provider CRUD, model CRUD, credential CRUD and
rotation, connectivity testing, the embedding probe, pricing, and reliability
configuration. The handler persists through `providerstore`, `modelstore`, and
`credstore`, and fires `InvalidateConfig` on every create/update/delete so the
gateway drops its provider, model, and credential caches.

Credential secrets are encrypted before they are persisted. The handler prefers
the multi-key vault (`MultiVault`) and falls back to the single-key vault
(`Vault`); the ciphertext, IV, auth tag, and key id are stored in the
`EncryptedKey`, `EncryptionIV`, `EncryptionTag`, and `EncryptionKeyID` columns.
When no vault is configured the credential write returns 503. The ciphertext is
never returned by the API — the `EncryptedKey` column carries a `json:"-"` tag —
and the credential and provider read endpoints are gated on the ordinary
credential and provider read IAM actions. The encryption scheme and the
gateway-side decrypt path are in
[credentials-architecture.md](../../cross-cutting/safety/credentials-architecture.md).

Reliability configuration has two scopes: per-credential threshold overrides and
a gateway-wide default (`/settings/credential-reliability`), both governing the
credential health circuit (open / half-open / closed). Connectivity tests, the
embedding probe, and reliability probes are BFF calls forwarded to the AI
Gateway using the configured gateway URL. Per-model pricing feeds the gateway's
cost stamping — see
[cost-estimation-architecture.md](../ai-gateway/cost-estimation-architecture.md).

## Virtual keys and the approval workflow

`internal/ai/virtualkeys/` owns virtual-key CRUD (`/virtual-keys`) and the
approval workflow (`/virtual-keys/:id/{approve,reject,renew,revoke}` plus
`/regenerate`), persisting through `vkstore`. A new key is minted as the prefix
`nvk_` followed by 256 random bits in hex; only its hash and a twelve-character
display prefix are stored, and the raw key is returned to the caller once at
creation. A key moves from pending to approved or rejected; renewal requires a
future `expiresAt` no more than three months out; revoke and regenerate act on
an active key.

Propagation splits by transition. Update, delete, and regenerate push a targeted
invalidate-by-hash through `NotifyConfigChange` under the `virtual_keys` shadow
key — an `invalidate` op carrying the affected key hash — so the gateway evicts
just that LRU entry rather than its whole virtual-key cache. Approve, renew, and
revoke carry no per-hash payload and use `InvalidateConfig`. How the gateway
resolves a virtual key to its owning organisation for traffic attribution is in
[vk-org-resolution.md](vk-org-resolution.md).

## Routing rules

`internal/ai/routing/` owns routing-rule CRUD (`/routing-rules`) and a
simulate endpoint (`/routing-rules/simulate`) that BFF-forwards to the AI
Gateway's internal routing-simulate endpoint so an admin can preview which rule
and target a request would resolve to. Create, update, and delete fire
`InvalidateConfig` for the gateway's `routing_rules` config; the gateway reads
rules from the database on each request, so invalidation only wakes its
short-TTL cache. Rule matching, the canonical-payload resolution, and the
LLM-dispatch strategy are in
[routing-architecture.md](../ai-gateway/routing-architecture.md) and
[smart-routing-architecture.md](../ai-gateway/smart-routing-architecture.md).

## Quota

`internal/ai/quota/` owns quota policies (`/quota-policies`), per-target
overrides (`/quota-overrides`), and quota analytics (`/quota-analytics/*`),
persisting through `quotastore`. Analytics reads the metric rollup tables and
joins user, organisation, and virtual-key lookups. Create, update, and delete
fire `InvalidateConfig` for the gateway's `quota_policies` or `quota_overrides`
config. How the gateway enforces quotas — the counters, tiers, and reset
windows — is in
[quota-architecture.md](../../cross-cutting/safety/quota-architecture.md).

## Cache configuration

`internal/ai/cache/` owns the prompt-cache configuration surface and the
adjacent cache config surfaces, all gated on the prompt-cache or semantic-cache
IAM resource.

The prompt cache is configured in three tiers — global, per-adapter, and
per-provider — with `/cache/effective` and `/cache/overrides` views over the
resolved result (`/cache/*`). A PUT assembles the full three-tier blob and
pushes it under the `cache` shadow key through `NotifyConfigChange`; a Hub
failure after the database write returns the 502 `propagation_error` described
above. The same package owns the semantic-cache singleton configuration (with
feedback-poisoning and prewarm endpoints), the extract (exact-match) cache
configuration, and the time-sensitive freshness rules. How the gateway applies
these tiers and serves cache hits is in
[prompt-cache-architecture.md](../ai-gateway/prompt-cache-architecture.md) and
[response-cache-architecture.md](../ai-gateway/response-cache-architecture.md).

## Gateway simulator

`internal/ai/simulator/` serves `/api/admin/ai-gateway-simulator/forward`. This
route is mounted outside the admin auth group: the virtual key carried in the
request is itself the credential boundary, so the handler validates the key and
forwards the request to the AI Gateway rather than relying on an admin session.
It is the operator probe for replaying a request against the gateway.

## References

- `packages/control-plane/internal/ai/providers/` — provider / model / credential admin
- `packages/control-plane/internal/ai/providers/credstore/` — credential store + encryption columns
- `packages/control-plane/internal/ai/virtualkeys/` — virtual-key CRUD + approval workflow
- `packages/control-plane/internal/ai/routing/` — routing-rule admin + simulate proxy
- `packages/control-plane/internal/ai/quota/` — quota policy / override / analytics admin
- `packages/control-plane/internal/ai/cache/` — prompt / semantic / extract cache config
- `packages/control-plane/internal/ai/simulator/` — gateway simulator forward
- `packages/control-plane/internal/platform/hub/` — `NotifyConfigChange` / `InvalidateConfig`
- `packages/control-plane/internal/platform/crypto/` — credential vault
- `packages/shared/schemas/configkey/` — shadow config key constants
