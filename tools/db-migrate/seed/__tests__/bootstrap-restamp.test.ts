/**
 * Unit tests for the bootstrap seeder's pure re-stamp logic (no database).
 *
 * Verify that restampBootstrapRow():
 *  1. Hashes the super-admin password into the loginable salt:hash format.
 *  2. Hashes the system-assistant VK under the documented deterministic key
 *     using the same HKDF→HMAC derivation the gateway verifier uses.
 *  3. Renames the VirtualKey key_version column to its Prisma camelCase name.
 *  4. Leaves secret-free tables untouched.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, hkdfSync } from 'crypto'

const BOOT_CEK = '0'.repeat(64) // 64 hex chars = 32-byte AES-256 key
const BOOT_HMAC = 'bootstrap-test-secret'

// Mirror lib.ts: HKDF-SHA256 a per-domain sub-key from the raw secret bytes,
// then HMAC the key under it (matches the gateway / CP key-admission path).
function expectKeyHash(classInfo: string, key: string): string {
  const sub = Buffer.from(
    hkdfSync('sha256', Buffer.from(BOOT_HMAC, 'utf8'), Buffer.alloc(0), Buffer.from(classInfo, 'utf8'), 32),
  )
  return createHmac('sha256', sub).update(key).digest('hex')
}

let restampBootstrapRow: (table: string, row: Record<string, unknown>) => Record<string, unknown>
let BOOTSTRAP_PASSWORD: string
let assistantVkKey: (id: string) => string
let ASSISTANT_VK_ID: string

before(async () => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = BOOT_CEK
  process.env.ADMIN_KEY_HMAC_SECRET = BOOT_HMAC
  const mod = await import('../bootstrap/index.ts')
  restampBootstrapRow = mod.restampBootstrapRow
  BOOTSTRAP_PASSWORD = mod.BOOTSTRAP_PASSWORD
  assistantVkKey = mod.assistantVkKey
  ASSISTANT_VK_ID = mod.ASSISTANT_VK_ID
})

after(() => {
  delete process.env.CREDENTIAL_ENCRYPTION_KEY
  delete process.env.ADMIN_KEY_HMAC_SECRET
})

test('BOOTSTRAP_PASSWORD is the documented constant', () => {
  assert.equal(BOOTSTRAP_PASSWORD, 'nexus-demo')
})

test('assistantVkKey is deterministic, carries the nvk_ prefix, and encodes the id prefix', () => {
  const id = 'b0075000-0000-4000-8000-0000000000a2'
  assert.equal(assistantVkKey(id), assistantVkKey(id), 'deterministic')
  assert.equal(assistantVkKey(id), `nvk_local_${id.slice(0, 8)}`)
  assert.ok(assistantVkKey(id).startsWith('nvk_'), 'VK key must carry the nvk_ prefix vkauth requires')
})

test('restampBootstrapRow NexusUser: sets a loginable salt:hash passwordHash distinct from plaintext', () => {
  const out = restampBootstrapRow('NexusUser', {
    id: 'nexus-user-super-admin',
    source: 'local',
    passwordHash: null,
    email: 'admin@nexus.ai',
  })
  assert.ok(typeof out.passwordHash === 'string' && out.passwordHash.length > 0, 'passwordHash must be a non-empty string')
  assert.notEqual(out.passwordHash, BOOTSTRAP_PASSWORD, 'hash must differ from plaintext')
  assert.ok((out.passwordHash as string).includes(':'), 'must be salt:hash format')
})

test('restampBootstrapRow VirtualKey: hashes the assistant key, sets keyPrefix, renames key_version → keyVersion', () => {
  const out = restampBootstrapRow('VirtualKey', {
    id: ASSISTANT_VK_ID,
    keyHash: null,
    keyPrefix: null,
    key_version: 'v1',
    name: 'system-assistant',
  })
  const expectedPlaintext = assistantVkKey(ASSISTANT_VK_ID)
  assert.equal(
    out.keyHash,
    expectKeyHash('nexus/apikey/virtual-key/v1', expectedPlaintext),
    'keyHash must equal HKDF-derived HMAC of the documented assistant key',
  )
  assert.equal(out.keyPrefix, expectedPlaintext.slice(0, 12), 'keyPrefix must be first 12 chars')
  assert.ok(!('key_version' in out), 'key_version (snake_case) must not appear in output')
  assert.equal(out.keyVersion, 'v1', 'keyVersion must carry the original value')
})

test('restampBootstrapRow Organization: passes through unchanged (no secret columns)', () => {
  const row = { id: 'b0075000-0000-4000-8000-0000000000a0', name: 'Default Organization', code: 'DEFAULT' }
  const out = restampBootstrapRow('Organization', row)
  assert.deepEqual(out, row)
})

test('restampBootstrapRow VirtualKey throws when ADMIN_KEY_HMAC_SECRET is absent', () => {
  const saved = process.env.ADMIN_KEY_HMAC_SECRET
  delete process.env.ADMIN_KEY_HMAC_SECRET
  try {
    assert.throws(
      () =>
        restampBootstrapRow('VirtualKey', {
          id: ASSISTANT_VK_ID,
          keyHash: null,
          keyPrefix: null,
          key_version: 'v1',
          name: 'system-assistant',
        }),
      /ADMIN_KEY_HMAC_SECRET/,
    )
  } finally {
    process.env.ADMIN_KEY_HMAC_SECRET = saved
  }
})
