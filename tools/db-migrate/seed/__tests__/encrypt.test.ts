import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDecipheriv } from 'crypto'
import { fakeEncrypt } from '../lib.ts'

test('fakeEncrypt round-trips under the configured 64-hex key', () => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = '0'.repeat(64)
  const { ciphertext, iv, tag } = fakeEncrypt('sk-demo-123')
  const key = Buffer.from('0'.repeat(64), 'hex')
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'), { authTagLength: 16 })
  d.setAuthTag(Buffer.from(tag, 'hex'))
  const out = Buffer.concat([d.update(Buffer.from(ciphertext, 'hex')), d.final()]).toString('utf8')
  assert.equal(out, 'sk-demo-123')
})

test('fakeEncrypt rejects a non-64-char key', () => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = 'short'
  assert.throws(() => fakeEncrypt('x'), /64-char hex/)
})

test('fakeEncrypt produces a fresh random IV each call (not deterministic)', () => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = '0'.repeat(64)
  const a = fakeEncrypt('same-input')
  const b = fakeEncrypt('same-input')
  assert.notEqual(a.iv, b.iv)
  assert.notEqual(a.ciphertext, b.ciphertext)
})
