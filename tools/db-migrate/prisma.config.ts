import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  schema: 'schema',
  migrations: {
    // No migration files in 1.0 — schema is applied with `prisma db push`.
    // `seed` is still consumed by `prisma db seed`. Delegated to the npm
    // script so the shell evaluates `&&` (Prisma 7 token-splits the string
    // and would otherwise drop everything after `&&`).
    seed: 'npm run seed',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
