/**
 * Helper script: seeds the prerequisites the demo integration test FK-depends
 * on — Tier-A reference data (IamGroup + IamPolicy the bindings reference) AND
 * the bootstrap tenant (the super-admin that demo VKs / admin keys are owned by,
 * and the org/project the demo rows can attach to). Not included in the npm test
 * glob (starts with '_').
 */
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { seedReference } from '../reference/index.ts'
import { seedBootstrap } from '../bootstrap/index.ts'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

;(async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) })
  await seedReference(prisma)
  await seedBootstrap(prisma)
  await prisma.$disconnect()
  console.log('[preseed] Tier-A reference + bootstrap tenant seeded.')
})()
