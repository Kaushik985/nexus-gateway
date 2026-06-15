/**
 * Seed entry point — three tiers, applied in order:
 *   Tier A — reference catalog (providers, models, IAM policies/groups, rule
 *            packs, hooks, jobs, …). Always loads.
 *   Bootstrap — the minimal tenant every install needs to be usable: one org,
 *            one project, the super-admin (admin@nexus.ai), its IAM binding, and
 *            the system-assistant VK. Always loads.
 *   Tier B — demo playground (rich multi-org tenant, extra users, demo VKs +
 *            credentials). Loads unless SEED_DEMO=false. The appliance runs with
 *            SEED_DEMO=false so no repo-committed demo credential ships on an
 *            internet-facing deployment.
 * Schema is applied separately via `prisma db push`; this only seeds data.
 */
import 'dotenv/config'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { seedReference } from './reference/index.ts'
import { seedBootstrap } from './bootstrap/index.ts'
import { seedDemo } from './demo/index.ts'

export function shouldSeedDemo(envValue: string | undefined): boolean {
  return envValue !== 'false'
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('seed: DATABASE_URL is required. Set it in tools/db-migrate/.env.')
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  try {
    console.log('[seed] Tier A: reference catalog')
    await seedReference(prisma)
    console.log('[seed] Bootstrap: minimal tenant (org, project, super-admin, system-assistant VK)')
    await seedBootstrap(prisma)
    if (shouldSeedDemo(process.env.SEED_DEMO)) {
      console.log('[seed] Tier B: demo tenant (set SEED_DEMO=false to skip)')
      await seedDemo(prisma)
    } else {
      console.log('[seed] SEED_DEMO=false — skipping demo tenant')
    }
    console.log('[seed] Done.')
  } finally {
    await prisma.$disconnect()
  }
}

// Run only when executed directly (not when imported by tests).
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => { console.error('[seed] FAILED:', err); process.exit(1) })
}
