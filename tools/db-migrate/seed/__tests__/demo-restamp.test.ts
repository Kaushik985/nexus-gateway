/**
 * Unit tests for the demo seeder's pure re-stamp logic.
 *
 * These tests do NOT require a database — they verify that:
 *  1. restampRow() produces correct Prisma-ready field names and non-null secrets.
 *  2. The documented key derivation helpers are deterministic.
 *  3. The env guard throws loudly when secrets are absent.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, createDecipheriv, hkdfSync } from 'crypto'

// ─── helpers captured before env mutations ───────────────────────────────────
const DEMO_CEK = '0'.repeat(64) // 64 hex chars = 32-byte AES-256 key
const DEMO_HMAC = 'demo-test-secret'

// Mirror lib.ts: HKDF-SHA256 a per-domain sub-key from the raw secret bytes,
// then HMAC the key under it (matches the gateway / CP key-admission path).
function expectKeyHash(classInfo: string, key: string): string {
  const sub = Buffer.from(hkdfSync('sha256', Buffer.from(DEMO_HMAC, 'utf8'), Buffer.alloc(0), Buffer.from(classInfo, 'utf8'), 32))
  return createHmac('sha256', sub).update(key).digest('hex')
}

let restampRow: (table: string, row: Record<string, unknown>) => Record<string, unknown>
let DEMO_PASSWORD: string
let demoVkKey: (id: string) => string
let demoAdminKey: (id: string) => string

before(async () => {
  // Set env before importing the module so hashVirtualKey / fakeEncrypt see them.
  process.env.CREDENTIAL_ENCRYPTION_KEY = DEMO_CEK
  process.env.ADMIN_KEY_HMAC_SECRET = DEMO_HMAC

  const mod = await import('../demo/index.ts')
  restampRow = mod.restampRow
  DEMO_PASSWORD = mod.DEMO_PASSWORD
  demoVkKey = mod.demoVkKey
  demoAdminKey = mod.demoAdminKey
})

after(() => {
  delete process.env.CREDENTIAL_ENCRYPTION_KEY
  delete process.env.ADMIN_KEY_HMAC_SECRET
})

// ─── helper derivation ────────────────────────────────────────────────────────

test('DEMO_PASSWORD is the documented constant', () => {
  assert.equal(DEMO_PASSWORD, 'nexus-demo')
})

test('demoVkKey is deterministic and encodes the id prefix', () => {
  const id = 'abcdef12-3456-7890-abcd-ef1234567890'
  const key1 = demoVkKey(id)
  const key2 = demoVkKey(id)
  assert.equal(key1, key2, 'deterministic')
  assert.equal(key1, `nvk_demo_${id.slice(0, 8)}`)
  assert.ok(key1.startsWith('nvk_'), 'VK key must carry the nvk_ prefix vkauth requires')
})

test('demoAdminKey is deterministic and encodes the id prefix', () => {
  const id = 'abcdef12-3456-7890-abcd-ef1234567890'
  const key = demoAdminKey(id)
  assert.equal(key, `nak_demo_${id.slice(0, 8)}`)
})

// ─── NexusUser re-stamp ───────────────────────────────────────────────────────

test('restampRow NexusUser local: sets a non-null passwordHash that differs from plaintext', () => {
  const row: Record<string, unknown> = {
    id: 'nexus-user-super-admin',
    source: 'local',
    passwordHash: null,
    email: 'admin@nexus.ai',
  }
  const out = restampRow('NexusUser', row)
  assert.ok(out.passwordHash !== null, 'passwordHash must be non-null')
  assert.ok(typeof out.passwordHash === 'string', 'passwordHash must be a string')
  assert.notEqual(out.passwordHash, DEMO_PASSWORD, 'hash must differ from plaintext')
  // salt:hash format — contains a colon separator
  assert.ok((out.passwordHash as string).includes(':'), 'must be salt:hash format')
})

test('restampRow NexusUser sso: leaves passwordHash null', () => {
  const row: Record<string, unknown> = {
    id: 'nexus-user-sso',
    source: 'sso',
    passwordHash: null,
  }
  const out = restampRow('NexusUser', row)
  assert.equal(out.passwordHash, null, 'SSO user passwordHash must remain null')
})

// ─── AdminApiKey re-stamp ─────────────────────────────────────────────────────

test('restampRow AdminApiKey: sets keyHash (HMAC) and keyPrefix, renames key_version → keyVersion', () => {
  const id = '40228302-4977-4dad-b8f4-faeaa76bf635'
  const row: Record<string, unknown> = {
    id,
    keyHash: null,
    keyPrefix: null,
    key_version: 'v1',
    name: 'dashboard-readonly',
    createdBy: 'seed-script',
  }
  const out = restampRow('AdminApiKey', row)

  // keyHash must be the HMAC of the documented plaintext key
  const expectedPlaintext = demoAdminKey(id)
  const expectedHash = expectKeyHash('nexus/apikey/admin/v1', expectedPlaintext)
  assert.equal(out.keyHash, expectedHash, 'keyHash must equal HKDF-derived HMAC of documented admin key')
  assert.notEqual(out.keyHash, expectedPlaintext, 'keyHash must differ from plaintext')

  // keyPrefix must be the first 12 chars of the plaintext key
  assert.equal(out.keyPrefix, expectedPlaintext.slice(0, 12), 'keyPrefix must be first 12 chars')

  // key_version snake_case must be renamed to keyVersion camelCase
  assert.ok(!('key_version' in out), 'key_version (snake_case) must not appear in output')
  assert.equal(out.keyVersion, 'v1', 'keyVersion must carry the original value')
})

// ─── VirtualKey re-stamp ──────────────────────────────────────────────────────

test('restampRow VirtualKey: sets keyHash, keyPrefix, renames key_version → keyVersion', () => {
  const id = 'a5e8d4b2-d8fd-487f-a830-6a3437c715d0'
  const row: Record<string, unknown> = {
    id,
    keyHash: null,
    keyPrefix: null,
    key_version: 'v1',
    name: 'super-admin',
  }
  const out = restampRow('VirtualKey', row)

  const expectedPlaintext = demoVkKey(id)
  const expectedHash = expectKeyHash('nexus/apikey/virtual-key/v1', expectedPlaintext)
  assert.equal(out.keyHash, expectedHash)
  assert.equal(out.keyPrefix, expectedPlaintext.slice(0, 12))
  assert.ok(!('key_version' in out), 'key_version must be renamed')
  assert.equal(out.keyVersion, 'v1')
})

// ─── Credential re-stamp ──────────────────────────────────────────────────────

test('restampRow Credential: sets encryptedKey/Iv/Tag and renames encryption_key_id → encryptionKeyId', () => {
  const id = 'abff2f77-5506-4d73-99a3-6b60ed756bac'
  const row: Record<string, unknown> = {
    id,
    name: 'openai-prod',
    providerId: '6b6d307f-a80b-4dcb-801b-1ffa07e25cab',
    encryptedKey: null,
    encryptionIv: null,
    encryptionTag: null,
    encryption_key_id: 'v1',
  }
  const out = restampRow('Credential', row)

  // ciphertext must be non-null and decrypt to the expected sk-demo-<id-prefix>
  assert.ok(typeof out.encryptedKey === 'string' && out.encryptedKey.length > 0)
  assert.ok(typeof out.encryptionIv === 'string' && out.encryptionIv.length > 0)
  assert.ok(typeof out.encryptionTag === 'string' && out.encryptionTag.length > 0)

  // Decrypt and verify the plaintext
  const key = Buffer.from(DEMO_CEK, 'hex')
  const iv = Buffer.from(out.encryptionIv as string, 'hex')
  const tag = Buffer.from(out.encryptionTag as string, 'hex')
  const d = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
  d.setAuthTag(tag)
  const plaintext = Buffer.concat([
    d.update(Buffer.from(out.encryptedKey as string, 'hex')),
    d.final(),
  ]).toString('utf8')
  assert.equal(plaintext, `sk-demo-${id.slice(0, 8)}`, 'decrypted value must match documented format')

  // encryption_key_id must be renamed to encryptionKeyId
  assert.ok(!('encryption_key_id' in out), 'encryption_key_id (snake_case) must not appear in output')
  assert.equal(out.encryptionKeyId, 'v1')
})

// ─── IamPolicyAttachment pass-through ────────────────────────────────────────
// The Prisma model declares the field as `expires_at` (not renamed via @map),
// so the fixture's snake_case `expires_at` key is the correct Prisma field name
// and must NOT be renamed.

test('restampRow IamPolicyAttachment: passes through expires_at unchanged (Prisma field is expires_at)', () => {
  const row: Record<string, unknown> = {
    id: '6aaf9dfe-efc7-436f-afae-3a783899754d',
    principalType: 'nexus_user',
    principalId: 'nexus-user-super-admin',
    policyId: '39397464-ea15-4041-8029-482f7ad2b7f3',
    createdAt: '2026-05-08T14:49:17.317+00:00',
    expires_at: null,
  }
  const out = restampRow('IamPolicyAttachment', row)
  // expires_at is the correct Prisma field name — it must be preserved, not renamed
  assert.ok('expires_at' in out, 'expires_at must be preserved (it is the Prisma field name)')
  assert.equal(out.expires_at, null, 'expires_at value must be preserved')
  assert.ok(!('expiresAt' in out), 'expiresAt (camelCase) must NOT appear — wrong field name for Prisma')
})

// ─── Pass-through tables ──────────────────────────────────────────────────────

test('restampRow Organization: passes through unchanged (no secret columns)', () => {
  const row: Record<string, unknown> = {
    id: '10000000-0000-0000-0000-000000000001',
    name: 'Apex Financial Group',
    code: 'APX',
  }
  const out = restampRow('Organization', row)
  assert.equal(out.id, row.id)
  assert.equal(out.name, row.name)
  assert.equal(out.code, row.code)
  assert.equal(Object.keys(out).length, Object.keys(row).length)
})

// ─── Env guard ────────────────────────────────────────────────────────────────

test('restampRow Credential throws when CREDENTIAL_ENCRYPTION_KEY is absent', () => {
  const saved = process.env.CREDENTIAL_ENCRYPTION_KEY
  delete process.env.CREDENTIAL_ENCRYPTION_KEY
  try {
    assert.throws(
      () =>
        restampRow('Credential', {
          id: 'test-id',
          name: 'test',
          providerId: 'test',
          encryptedKey: null,
          encryptionIv: null,
          encryptionTag: null,
          encryption_key_id: 'v1',
        }),
      /CREDENTIAL_ENCRYPTION_KEY/,
    )
  } finally {
    process.env.CREDENTIAL_ENCRYPTION_KEY = saved
  }
})

test('restampRow AdminApiKey throws when ADMIN_KEY_HMAC_SECRET is absent', () => {
  const saved = process.env.ADMIN_KEY_HMAC_SECRET
  delete process.env.ADMIN_KEY_HMAC_SECRET
  try {
    assert.throws(
      () =>
        restampRow('AdminApiKey', {
          id: 'test-id',
          keyHash: null,
          keyPrefix: null,
          key_version: 'v1',
          name: 'test',
          createdBy: 'test',
        }),
      /ADMIN_KEY_HMAC_SECRET/,
    )
  } finally {
    process.env.ADMIN_KEY_HMAC_SECRET = saved
  }
})
