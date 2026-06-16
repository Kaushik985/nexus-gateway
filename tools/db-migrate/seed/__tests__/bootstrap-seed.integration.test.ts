/**
 * Integration test for the bootstrap seeder.
 *
 * Requires a scratch database with the schema applied and DATABASE_URL set.
 * Seeds Tier-A reference (the super-admin's IAM group + policy are reference
 * rows the bootstrap bindings FK-depend on) then the bootstrap tenant. Skips
 * when DATABASE_URL is absent (CI / pure-unit runs).
 *
 * Run manually:
 *   docker exec nexus-postgres dropdb -U postgres --if-exists nexus_scratch
 *   docker exec nexus-postgres createdb -U postgres nexus_scratch
 *   DATABASE_URL='postgresql://postgres:postgres@localhost:55532/nexus_scratch?sslmode=disable' \
 *     npx prisma db push
 *   CREDENTIAL_ENCRYPTION_KEY=$(printf '0%.0s' {1..64}) \
 *   ADMIN_KEY_HMAC_SECRET=bootstrap-secret \
 *   DATABASE_URL='postgresql://...' \
 *     npx tsx --test seed/__tests__/bootstrap-seed.integration.test.ts
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { scryptSync } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { seedReference } from '../reference/index.ts'
import { seedBootstrap, BOOTSTRAP_PASSWORD, assistantVkKey, ASSISTANT_VK_ID } from '../bootstrap/index.ts'
import { hashVirtualKey } from '../lib.ts'

const url = process.env.DATABASE_URL
const adapter = url ? new PrismaPg({ connectionString: url }) : null
const prisma = adapter ? new PrismaClient({ adapter }) : null
const SKIP = !url ? 'DATABASE_URL unset — skipping integration test' : false

before(async () => {
  if (prisma) {
    await seedReference(prisma)
    await seedBootstrap(prisma)
  }
})
after(async () => {
  await prisma?.$disconnect()
})

// ─── Business outcome: super-admin password verifies ─────────────────────────

test('bootstrap super-admin passwordHash verifies against BOOTSTRAP_PASSWORD', { skip: SKIP }, async () => {
  assert.ok(prisma)
  const user = await prisma.nexusUser.findUnique({ where: { id: 'nexus-user-super-admin' } })
  assert.ok(user, 'super-admin user must exist')
  assert.equal(user.email, 'admin@nexus.ai', 'super-admin email')
  assert.ok(user.canAccessControlPlane, 'super-admin must be able to access the control plane')
  assert.ok(user.passwordHash, 'super-admin must have a non-null passwordHash after seeding')

  const [saltHex, hashHex] = user.passwordHash.split(':')
  assert.ok(saltHex && hashHex, 'passwordHash must be in "saltHex:hashHex" format')
  const derivedHash = scryptSync(
    BOOTSTRAP_PASSWORD,
    Buffer.from(saltHex, 'hex'),
    64,
    { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
  ).toString('hex')
  assert.equal(derivedHash, hashHex, 'derived hash must match stored hash — password is loginable')
})

// ─── Business outcome: super-admin holds the super-admin policy ──────────────

test('bootstrap super-admin is bound to its IAM group and policy', { skip: SKIP }, async () => {
  assert.ok(prisma)
  const membership = await prisma.iamGroupMembership.findFirst({
    where: { principalType: 'nexus_user', principalId: 'nexus-user-super-admin' },
  })
  assert.ok(membership, 'super-admin must have an IAM group membership')

  const attachment = await prisma.iamPolicyAttachment.findFirst({
    where: { principalType: 'nexus_user', principalId: 'nexus-user-super-admin' },
  })
  assert.ok(attachment, 'super-admin must have a direct IAM policy attachment')
})

// ─── Business outcome: system-assistant VK resolves and is unrestricted ──────

test('bootstrap system-assistant VK keyHash equals hashVirtualKey(assistantVkKey(id)) and is unrestricted', { skip: SKIP }, async () => {
  assert.ok(prisma)
  const vk = await prisma.virtualKey.findUnique({ where: { id: ASSISTANT_VK_ID } })
  assert.ok(vk, 'system-assistant VK must exist')
  assert.ok(vk.keyHash, 'keyHash must be non-null after seeding')

  const documentedPlaintext = assistantVkKey(ASSISTANT_VK_ID)
  assert.equal(vk.keyHash, hashVirtualKey(documentedPlaintext), 'keyHash must resolve the documented plaintext')
  assert.equal(vk.keyPrefix, documentedPlaintext.slice(0, 12), 'keyPrefix must be first 12 chars')
  assert.equal(vk.enabled, true, 'assistant VK must be enabled')
  assert.equal(vk.vkStatus, 'active', 'assistant VK must be active')
  assert.equal(vk.expiresAt, null, 'assistant VK must not expire')
  assert.deepEqual(vk.allowedModels, [], 'empty allowedModels = unrestricted, required for model:"auto" routing')
})

// ─── Idempotency ──────────────────────────────────────────────────────────────

test('seedBootstrap is idempotent: running twice yields stable row counts', { skip: SKIP }, async () => {
  assert.ok(prisma)
  const users = await prisma.nexusUser.count()
  const vks = await prisma.virtualKey.count()
  const orgs = await prisma.organization.count()
  await seedBootstrap(prisma)
  assert.equal(await prisma.nexusUser.count(), users, 'NexusUser count must be stable')
  assert.equal(await prisma.virtualKey.count(), vks, 'VirtualKey count must be stable')
  assert.equal(await prisma.organization.count(), orgs, 'Organization count must be stable')
})

// ─── Env guard ──────────────────────────────────────────────────────────────

test('seedBootstrap throws when ADMIN_KEY_HMAC_SECRET is absent', { skip: SKIP }, async () => {
  assert.ok(prisma)
  const saved = process.env.ADMIN_KEY_HMAC_SECRET
  delete process.env.ADMIN_KEY_HMAC_SECRET
  try {
    await assert.rejects(() => seedBootstrap(prisma!), /ADMIN_KEY_HMAC_SECRET/)
  } finally {
    process.env.ADMIN_KEY_HMAC_SECRET = saved
  }
})
