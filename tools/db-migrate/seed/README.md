# Seed

The seed brings a freshly-pushed database (`prisma db push` + `schema-extras.sql`)
to a usable state. It runs through the Prisma Client (`@prisma/adapter-pg`) and is
**idempotent** — every write is an `upsert` keyed on the row's unique key, so a
re-run converges and never duplicates.

Two tiers, orchestrated by `seed/seed.ts`:

- **Tier A — reference catalog (always).** Product reference data every install
  needs: providers, the model catalog (with pricing + capability columns), the
  interception domain/path catalog, compliance rules + rule-packs, config
  templates, the managed IAM policies + the standard IAM groups and their policy
  attachments, `system_metadata` defaults, the cache-config singletons, and
  `semantic_cache_config`. Loaded from `seed/fixtures/<table>.json` by
  `seed/reference/`. Rule-pack definitions are the YAMLs in `seed/rule-packs/`.
- **Tier B — demo tenant (opt-out).** A complete, navigable demo: org/project,
  users (incl. a documented super-admin), IAM memberships, a demo provider +
  credential, models, quota policies, and virtual keys. Loaded from
  `seed/fixtures/demo/<table>.json` by `seed/demo/`. All secret columns are
  **null in the committed fixtures**; `seedDemo` re-stamps them at seed time under
  the local keys (passwords via scrypt `hashPassword`, VK/admin key hashes via
  HMAC `hashApiKey` under `ADMIN_KEY_HMAC_SECRET`, credential ciphertext via
  AES-256-GCM `fakeEncrypt` under `CREDENTIAL_ENCRYPTION_KEY`) and prints the
  documented demo credentials in a banner. Skipped when `SEED_DEMO=false`.

## Commands

- `npm run seed` — Tier A + Tier B (local / CI). Needs `CREDENTIAL_ENCRYPTION_KEY`
  and `ADMIN_KEY_HMAC_SECRET` for the demo re-stamp.
- `npm run seed:prod` — `SEED_DEMO=false`; Tier A only, zero demo rows (production
  / clean install). Needs no secrets.

## Regenerating the fixtures (maintainer task)

The fixtures are produced by `scripts/extract-reference-fixtures.ts`, which selects
each table from a source database with `row_to_json` (lossless — captures every
column) and writes `seed/fixtures/*.json` (Tier A) + `seed/fixtures/demo/*.json`
(Tier B). It curates as it extracts: it excludes operational/secret
`system_metadata` rows, normalizes captured-drift values to product defaults, nulls
the demo secret columns, and drops principal-orphan membership rows. To regenerate:

```bash
# Point DATABASE_URL at a scratch DB loaded with the full intended state
# (schema push + the reference + demo data), then:
npx tsx scripts/extract-reference-fixtures.ts
```

No real API-key ciphertext, password hash, or VK/admin key hash is ever committed —
secret columns are nulled at extraction and re-stamped at seed time.
