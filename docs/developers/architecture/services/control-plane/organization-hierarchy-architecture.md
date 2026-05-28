# Organization & Project Hierarchy

How Nexus groups users, projects, and virtual keys into an organization tree,
and the two distinct ways that tree is consumed: subtree data queries and quota
policy cascade.

## Single-tenant model

Nexus is **single-tenant**: one deployment serves one tenant. There is no
`tenant_id` column and no row-level security — `Organization`, `Project`,
`VirtualKey`, and `NexusUser` all live in one shared schema. Organizations are
an intra-deployment grouping for attribution, quota scoping, and admin
visibility, **not** a tenant-isolation boundary. "Org hierarchy" therefore means
a structural tree inside the single tenant, never multi-tenant separation.

## The organization tree

`Organization` is a self-referential tree: `parentId` points at the parent
(relation `OrgTree`; root orgs have `parentId = NULL`), and a **materialized
`path`** encodes the position — root orgs are `/{id}/`, children are
`{parent.path}{id}/`, and `path` is unique. The materialized path lets subtree
scans run as a single `LIKE` prefix match instead of a recursive CTE.

Path maintenance lives in `packages/control-plane/internal/identity/users/orgstore`:

- `CreateOrganization` computes the path after insert — `/{id}/` for a root, or
  `{parent.path}{id}/` when a `parentId` is supplied.
- `UpdateOrganization`, when `parentId` changes, recomputes the path for the org
  **and all its descendants atomically** in one transaction, by replacing the
  old path prefix: `SET path = $newPrefix || SUBSTRING(path FROM LENGTH($oldPrefix)+1) WHERE path LIKE $oldPrefix || '%'`.

Each org also carries a unique `code`, an `enabled` flag, a `timezone` (which
drives business-rule boundaries such as quota-period resets and analytics
windows), and a provisioning `source` (`local` or `idp`, with `externalGroupId`
set when an external IdP group maps to the org — see
[idp-sso-architecture.md](idp-sso-architecture.md)).

## Projects

A `Project` belongs to exactly one organization via the `organizationId` foreign
key; projects do not nest (there is no project parent). A project carries a
unique `code` and a `status`. Virtual keys attach either to a project
(application keys) or to a user (personal keys); how a key resolves to an org is
covered in [vk-org-resolution.md](vk-org-resolution.md).

## Two consumers of the tree

The hierarchy is read two different ways, through two different fields. Keeping
them distinct matters: a change to one does not automatically affect the other.

### Materialized `path` → subtree data queries

The `path` answers "this org and everything beneath it" in one indexed prefix
scan. The user listing uses it for its `IncludeSubOrgs` filter
(`packages/control-plane/internal/identity/users/userstore/nexus_user_crud.go`):

```sql
... AND u."organizationId" IN (
  SELECT id FROM "Organization"
  WHERE path LIKE (SELECT path FROM "Organization" WHERE id = $N) || '%'
)
```

This is a forward (descendant) scan: given an org, find rows belonging to it or
any sub-org.

### `parentId` → quota policy cascade

Quota enforcement walks the tree the other direction — **upward**, from a key's
org to the root. The AI Gateway quota engine loads the whole tree as an
`orgParents` map (`orgID → parentOrgID`) in
`packages/ai-gateway/internal/policy/quota/policy_cache.go`, and
`BuildCheckChain` (`packages/ai-gateway/internal/policy/quota/chain.go`) produces
the ordered check chain for a request:

- virtual key →
- user (personal key) **or** project (application key) →
- the key's organization → its parent → … → root.

A quota policy or override attached at **any** level in that chain applies, so a
limit set on a parent org governs every descendant org, project, and key beneath
it — this is the org-tree policy cascade. The walk carries a visited-set guard so
a malformed tree cannot loop. The chain is built per request on the gateway
forward path; the resolution and enforcement semantics are in
[quota-architecture.md](../../cross-cutting/safety/quota-architecture.md).

## Relationship to IAM scoping

The org-tree cascade above governs **quota**. IAM permission scoping is a
separate mechanism and is **not** driven by `Organization.parentId`: IAM policy
scopes are strings (organization / project naming) matched hierarchically by
prefix — a scope of `org-acme` matches `org-acme` and `org-acme/engineering`
through `matchScope`. That is string-prefix scope matching, independent of the
materialized-path tree. See
[iam-identity-architecture.md](iam-identity-architecture.md).

## References

- `tools/db-migrate/schema.prisma` — `Organization`, `Project`, `VirtualKey`, `NexusUser` models
- `packages/control-plane/internal/identity/users/orgstore` — org CRUD + path materialization
- `packages/control-plane/internal/identity/users/userstore/nexus_user_crud.go` — `IncludeSubOrgs` subtree query
- `packages/ai-gateway/internal/policy/quota/policy_cache.go` — org-tree load (`orgParents`)
- `packages/ai-gateway/internal/policy/quota/chain.go` — `BuildCheckChain` hierarchy walk
- `packages/control-plane/internal/identity/iam/nrn.go` — `matchScope` prefix scope matching
- `docs/developers/architecture/cross-cutting/safety/quota-architecture.md`
- `docs/developers/architecture/services/control-plane/iam-identity-architecture.md`
- `docs/developers/architecture/services/control-plane/vk-org-resolution.md`
