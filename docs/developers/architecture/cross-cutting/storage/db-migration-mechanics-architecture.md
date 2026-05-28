# DB migration mechanics architecture

PostgreSQL is the system of record. Its schema is defined and versioned with
Prisma; its rows are accessed at runtime by hand-written SQL over `pgx`. The two
roles are deliberately split: **Prisma owns schema authoring and migration**,
while **the Go services own the request path** with no ORM in it. This doc covers
how a schema change becomes a migration, how migrations are ordered and applied,
how a fresh database is seeded, and where out-of-band data fixes live.

Everything migration-related lives under `tools/db-migrate/`.

## 1. Schema authoring

`tools/db-migrate/schema.prisma` is the single schema source. It declares a
PostgreSQL datasource and carries every model. Model and field doc-comments are
load-bearing documentation in their own right — they record intent that the SQL
alone can't, for example that `Provider.adapterType` is validated as an enum in
the Control Plane handler and the OpenAPI spec rather than by a SQL `CHECK`, so
the value set can evolve without a migration.

Prisma configuration lives in `tools/db-migrate/prisma.config.ts`: it points at
the schema, the `migrations/` directory, and the seed command, and reads the
database URL from the `DATABASE_URL` environment variable. The seed entry is
expressed as `npm run seed` so a real shell evaluates the chained command; Prisma
otherwise token-splits the string and would drop everything after the `&&`.

## 2. Migrations

Each migration is a directory under `tools/db-migrate/migrations/` named
`<YYYYMMDDHHMMSS>_<description>/` containing a single `migration.sql`. Prisma
applies migrations in lexical order of that timestamp prefix and records each
applied one in the `_prisma_migrations` table, so an environment only ever runs
the migrations it has not seen.

The npm scripts in `tools/db-migrate/package.json` wrap the Prisma commands:
`migrate:dev` authors and applies a new migration against a development database,
`migrate:deploy` applies pending migrations non-interactively (the production
path), `migrate:status` reports drift, and `migrate:reset` drops and rebuilds from
scratch.

### The baseline

The first migration, `00000000000000_baseline_…/migration.sql`, uses an all-zero
prefix so it sorts ahead of every dated migration. It is a full schema snapshot —
a `pg_dump` of the schema — that collapses the schema's history into one starting
point. Every later dated migration layers its change on top of that baseline.

### Timestamp uniqueness (binding)

Two migration directories that share the same `YYYYMMDDHHMMSS` prefix cause Prisma
to silently apply only one of them and skip the other, with no error. To prevent
that, `scripts/check-migration-timestamps.sh` extracts the 14-character prefix of
every migration directory and fails if any prefix repeats. It runs in pre-commit
and CI. When two migrations would collide, the fix is to bump one prefix by a
second or a minute and rebase any references to it.

## 3. Seeding a fresh database

`tools/db-migrate/seed/seed.ts` brings a freshly-migrated database up to a usable
state. It connects directly with `pg` and runs three steps:

1. **Apply the baseline data snapshot.** `seed/data/seed-baseline.sql` is a
   `pg_dump --data-only --column-inserts --disable-triggers` snapshot of an
   operational source database, applied as one multi-statement query. Ciphertext
   columns are redacted in the snapshot, and high-cardinality event tables —
   traffic events, metric rollups, ops metrics, job runs, admin audit log, tokens,
   diagnostic events — are excluded, so the snapshot stays a configuration
   fixture rather than a copy of operational history.
2. **Re-encrypt credentials.** Every `Credential` row's encrypted key material is
   overwritten with a fresh AES-256-GCM encryption of a fake plaintext using the
   local `CREDENTIAL_ENCRYPTION_KEY`. Real provider keys are never committed to
   the snapshot, and the re-encryption makes the ciphertext decryptable with the
   local key.
3. **Reset ephemeral state.** Every `Thing` row is marked offline; the real
   services flip themselves back to online on their first heartbeat after boot.

The seed runs through `npm run seed`, which `prisma migrate reset` and the seed
command invoke. The regeneration procedure for the snapshot is documented in
`seed/data/README.md`.

## 4. Out-of-band scripts

`tools/db-migrate/manual-scripts/` holds one-off SQL — data backfills, cost
recomputes, and baseline-sync scripts — that an operator runs by hand against a
specific environment. These are distinct from versioned migrations: a migration is
schema change that `migrate:deploy` applies automatically and `_prisma_migrations`
tracks, whereas a manual script is a data operation run deliberately, once, with
operator judgment. Keeping data backfills out of the migration sequence keeps the
migration history a pure schema timeline.

## 5. Runtime access and the Go config mirrors

At runtime the Go services read and write through `pgx` with hand-written SQL —
there is no ORM in the request path (for example
`packages/ai-gateway/internal/platform/store/pgx.go` and the cache layer's
loaders). Prisma is a build- and deploy-time tool, not a runtime dependency of the
services.

The schema carries several JSON columns whose shapes are configuration domains
(the `thing_config_template` config-key payloads). Go consumers need typed access
to those shapes, so `packages/shared/schemas/configtypes/` hand-maintains the
mirror — five sub-packages (`enums`, `identity`, `interception`, `observability`,
`policy`) of Go structs matching the JSON shapes. There is no code generator from
the schema to these structs; they are kept in step by hand, and the configuration
architecture's per-key catalog is the registry that keeps the two sides aligned.

## 6. Renames

A rename that touches a schema-adjacent identifier (a column, a config key, an env
variable) has to be swept across far more than the schema. `scripts/check-rename.sh`
is the sweep gate that verifies a rename reached every layer — Go source and
tests, YAML and env examples, the SQL seed, migrations, UI source and i18n,
production systemd and database rows, docs, skills, and the agent rule files. The
binding rule and the full layer list live in
[configuration-architecture.md](../foundation/configuration-architecture.md).

## References

- `tools/db-migrate/schema.prisma` — schema source
- `tools/db-migrate/prisma.config.ts` — Prisma configuration
- `tools/db-migrate/package.json` — migrate / seed npm scripts
- `tools/db-migrate/migrations/` — versioned migrations + the all-zero baseline
- `tools/db-migrate/seed/seed.ts` — fresh-database seed
- `tools/db-migrate/manual-scripts/` — out-of-band data scripts
- `scripts/check-migration-timestamps.sh` — timestamp-uniqueness guard
- `scripts/check-rename.sh` — rename sweep gate
- `packages/shared/schemas/configtypes/` — hand-maintained Go config-shape mirrors
