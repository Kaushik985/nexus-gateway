# manual-scripts

Out-of-band, **one-off** operational SQL — data backfills, cost recomputes,
watermark resets, and other surgical changes that are run by hand against a
specific environment and are **not** part of the Prisma migration chain or the
seed.

These scripts are applied once for a specific incident or rollout and then are
done. They are intentionally **not** kept in the tree after they have run —
the operation they performed lives on in the data, and the script itself stays
in git history if anyone needs to audit exactly what was executed.

When you add a new one-off script:

- Name it for what it does + the date it was authored (e.g.
  `recompute_traffic_event_costs_2026_05_21.sql`).
- Put a header comment stating the why, the target environment, and whether it
  is idempotent / safe to re-run.
- Remove it once it has been applied everywhere it needed to (git keeps the
  record).

See `docs/developers/architecture/cross-cutting/storage/db-migration-mechanics-architecture.md`
for how this fits alongside the Prisma schema and seed.
