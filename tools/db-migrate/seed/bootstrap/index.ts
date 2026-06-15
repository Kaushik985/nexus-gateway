/**
 * Bootstrap tier — the minimal tenant every install needs to be usable.
 *
 * One organization, one project, the super-admin (admin@nexus.ai), the
 * super-admin's IAM binding (membership + direct policy attachment; the group
 * and policy themselves are Tier-A reference data), and a dedicated
 * system-assistant Virtual Key that powers Chat-with-Nexus. Always seeded —
 * unlike the demo playground (Tier B) this is NOT gated by SEED_DEMO, because
 * without it there would be no admin to log in as.
 *
 * Secrets ship NULLED in the fixtures and are re-stamped here under the LOCAL
 * keys so a developer can log in immediately:
 *   - super-admin password  → BOOTSTRAP_PASSWORD
 *   - system-assistant VK    → deterministic local plaintext
 * On the appliance these deterministic values are OVERWRITTEN with per-instance
 * random secrets at first boot (set-admin-password.js + mint-assistant-vk.js),
 * so no repo-committed credential is ever usable on an internet-facing
 * deployment. That is why this module ships no live secret of its own.
 */
import type { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { hashPassword, hashVirtualKey } from '../lib.ts'
import { upsertRows } from '../reference/loadFixture.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_BOOTSTRAP = resolve(__dirname, '../fixtures/bootstrap')

/** Password stamped on the bootstrap super-admin for local logins. */
export const BOOTSTRAP_PASSWORD = 'nexus-demo'

/** The dedicated system-assistant Virtual Key id (fixed in the fixture). */
export const ASSISTANT_VK_ID = 'b0075000-0000-4000-8000-0000000000a2'

// Deterministic local plaintext for the system-assistant VK. The "nvk_" prefix
// is REQUIRED — vkauth rejects keys without it that are also ≤20 chars. The
// "local" segment signals this value is only the dev-default; the appliance
// mints a per-instance random replacement at first boot.
export const assistantVkKey = (id: string): string => `nvk_local_${id.slice(0, 8)}`

/**
 * Re-stamp a single bootstrap row's secret column under the local keys.
 * Exported for unit testing — pure logic, no DB dependency.
 */
export function restampBootstrapRow(
  table: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  switch (table) {
    case 'NexusUser':
      return { ...row, passwordHash: hashPassword(BOOTSTRAP_PASSWORD) }

    case 'VirtualKey': {
      const out = { ...row }
      // VirtualKey.keyVersion is @map("key_version"); the fixture carries the
      // snake_case column name, so rename before upsert.
      if ('key_version' in out) {
        out.keyVersion = out.key_version
        delete out.key_version
      }
      const plaintext = assistantVkKey(out.id as string)
      return {
        ...out,
        keyHash: hashVirtualKey(plaintext),
        keyPrefix: plaintext.slice(0, 12),
      }
    }

    default:
      return row
  }
}

// FK-safe order: org → project → user → IAM bindings → VK.
const BOOTSTRAP_ORDER: { fixture: string; delegate: string }[] = [
  { fixture: 'Organization', delegate: 'organization' },
  { fixture: 'Project', delegate: 'project' },
  { fixture: 'NexusUser', delegate: 'nexusUser' },
  { fixture: 'IamGroupMembership', delegate: 'iamGroupMembership' },
  { fixture: 'IamPolicyAttachment', delegate: 'iamPolicyAttachment' },
  { fixture: 'VirtualKey', delegate: 'virtualKey' },
]

/**
 * Seed the bootstrap tenant. Idempotent (Prisma upserts keyed on `id`).
 *
 * Prerequisite: Tier-A reference data must already be seeded (the super-admin's
 * IAM group + policy are reference rows this module's bindings reference), and
 * ADMIN_KEY_HMAC_SECRET must be set so the system-assistant VK hash matches the
 * running services' verifier.
 */
export async function seedBootstrap(prisma: PrismaClient): Promise<void> {
  if (!process.env.ADMIN_KEY_HMAC_SECRET) {
    throw new Error(
      'seedBootstrap requires ADMIN_KEY_HMAC_SECRET to hash the system-assistant VK ' +
        '(it must match the value used by the Control Plane and AI Gateway).',
    )
  }

  for (const { fixture, delegate } of BOOTSTRAP_ORDER) {
    const rawRows = JSON.parse(
      readFileSync(resolve(FIXTURES_BOOTSTRAP, `${fixture}.json`), 'utf8'),
    ) as Record<string, unknown>[]

    const rows = rawRows.map((row) => restampBootstrapRow(fixture, row))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const del = (prisma as any)[delegate] as {
      upsert: (args: { where: unknown; create: unknown; update: unknown }) => Promise<unknown>
    }
    const n = await upsertRows(del, rows, 'id')
    console.log(`[seed:bootstrap] ${fixture}: ${n} rows`)
  }

  console.log(
    `[seed:bootstrap] system-assistant VK plaintext (local default): ${assistantVkKey(ASSISTANT_VK_ID)}`,
  )
}
