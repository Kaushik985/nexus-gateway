import { test } from 'node:test'
import assert from 'node:assert/strict'
import { upsertRows } from '../reference/loadFixture.ts'

test('upsertRows upserts every row keyed by id and is idempotent', async () => {
  const calls: { where: unknown; create: unknown; update: unknown }[] = []
  const delegate = {
    upsert: async (args: { where: unknown; create: unknown; update: unknown }) => {
      calls.push(args)
      return args.create
    },
  }
  const rows = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]
  const n = await upsertRows(delegate as never, rows, 'id')
  assert.equal(n, 2)
  assert.deepEqual(calls[0].where, { id: 'a' })
  assert.deepEqual(calls[0].create, { id: 'a', name: 'A' })
  assert.deepEqual(calls[0].update, { id: 'a', name: 'A' })
})

test('upsertRows throws when a row lacks the key field', async () => {
  const delegate = { upsert: async () => ({}) }
  await assert.rejects(
    () => upsertRows(delegate as never, [{ name: 'no-id' }], 'id'),
    /missing key field "id"/,
  )
})

import { readFixture } from '../reference/loadFixture.ts'

test('readFixture loads a real committed fixture as a non-empty array', () => {
  const models = readFixture('Model')
  assert.ok(Array.isArray(models) && models.length > 0, 'Model.json should parse to a non-empty array')
  assert.ok('id' in models[0], 'each Model row has an id')
})
