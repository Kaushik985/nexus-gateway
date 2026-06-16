import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldSeedDemo } from '../seed.ts'

test('demo seeds by default and for any value other than "false"', () => {
  assert.equal(shouldSeedDemo(undefined), true)
  assert.equal(shouldSeedDemo('true'), true)
  assert.equal(shouldSeedDemo('1'), true)
  assert.equal(shouldSeedDemo(''), true)
})

test('demo is skipped only when SEED_DEMO is exactly "false"', () => {
  assert.equal(shouldSeedDemo('false'), false)
})
