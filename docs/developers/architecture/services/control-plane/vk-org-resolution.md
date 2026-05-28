# Virtual Key → Organization Resolution

Every AI Gateway request authenticates with a virtual key (VK). For attribution
(the `org_id` / `org_name` columns on `traffic_event`), for org-level quota and
its period windows, and for analytics that group by organization, each VK must
resolve to exactly one organization. VKs reach their org by two different paths;
a single query resolves both.

## Two virtual-key shapes

- **Application VK** — bound to a `Project` (`projectId`). Its org is the
  project's `organizationId`.
- **Personal VK** — bound to an owner (`ownerId` → `NexusUser`). Its org is the
  user's `organizationId`.

The `vkType` column (`personal` | `application`) records which shape a key is.

## The dual-join resolution (binding)

`vkSelectSQL` in `packages/ai-gateway/internal/platform/store/virtualkey.go`
`LEFT JOIN`s `Organization` **twice** — once per chain — and `COALESCE`s the two
results, with the application path taking precedence and the personal path as
the fallback:

```sql
COALESCE(p."organizationId", u."organizationId") AS organization_id,
COALESCE(org.name,           u_org.name)         AS organization_name,
COALESCE(org.timezone,       u_org.timezone)     AS organization_timezone
FROM "VirtualKey" vk
LEFT JOIN "Project"      p     ON vk."projectId"      = p.id
LEFT JOIN "Organization" org   ON p."organizationId"  = org.id
LEFT JOIN "NexusUser"    u     ON vk."ownerId"        = u.id
LEFT JOIN "Organization" u_org ON u."organizationId"  = u_org.id
```

So the org id, name, and timezone all resolve through whichever chain is
populated: `VK → Project → Organization` for an application key, or
`VK → Owner (NexusUser) → Organization` for a personal key.

## Why both chains are mandatory

If only the application chain existed, a personal VK — which has no `projectId` —
would always resolve `organization_id = NULL`. That empties the `org_id` /
`org_name` columns on `traffic_event` and silently breaks every analytics
aggregation and quota check that groups by organization. The personal fallback
(`Owner → Organization`) closes that gap.

The invariant for anyone editing this query: **any new VK-derived column that
needs an organization value must `COALESCE` both chains**, or personal VKs go
silently `NULL` while application VKs look fine.

## Where it runs, where it is consumed

- **Resolved** in the AI Gateway at request-auth time: `GetVirtualKeyByHash`
  runs `vkSelectSQL`, and the returned record carries `OrganizationID`,
  `OrganizationName`, and `OrganizationTimezone`.
- **Consumed** downstream: `org_id` / `org_name` are stamped onto
  `traffic_event` for attribution and analytics; `OrganizationTimezone` (carried
  on the event as `OriginTZ`) sets the org-local calendar boundaries for
  analytics windows such as "yesterday" and "this month" — quota-enforcement
  period keys themselves are computed in UTC; `OrganizationID` feeds the
  hierarchical quota check chain (see
  [organization-hierarchy-architecture.md](organization-hierarchy-architecture.md)
  and [quota-architecture.md](../../cross-cutting/safety/quota-architecture.md)).
- **Managed** in the Control Plane: VK lifecycle — create, approve/reject a
  pending key, revoke — lives in
  `packages/control-plane/internal/ai/virtualkeys/vkstore`, with `vkStatus`
  (`active` / `pending` / `expired` / `rejected` / `revoked`) covered in
  [cp-ai-providers-virtualkeys-architecture.md](cp-ai-providers-virtualkeys-architecture.md).

## References

- `packages/ai-gateway/internal/platform/store/virtualkey.go` — `vkSelectSQL` + scan
- `packages/control-plane/internal/ai/virtualkeys/vkstore` — VK CRUD + approval workflow
- `tools/db-migrate/schema.prisma` — `VirtualKey`, `Project`, `Organization`, `NexusUser` models
- `docs/developers/architecture/services/control-plane/organization-hierarchy-architecture.md`
- `docs/developers/architecture/cross-cutting/safety/quota-architecture.md`
- `docs/developers/architecture/services/control-plane/cp-ai-providers-virtualkeys-architecture.md`
