import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

type UpsertDelegate = {
  upsert: (args: {
    where: Record<string, unknown>
    create: Record<string, unknown>
    update: Record<string, unknown>
  }) => Promise<unknown>
}

/** Upsert every row keyed by `key`. Idempotent: re-running converges. */
export async function upsertRows(
  delegate: UpsertDelegate,
  rows: Record<string, unknown>[],
  key: string,
): Promise<number> {
  for (const row of rows) {
    if (!(key in row)) {
      throw new Error(
        `loadFixture: row missing key field "${key}": ${JSON.stringify(row)}`,
      )
    }
    await delegate.upsert({ where: { [key]: row[key] }, create: row, update: row })
  }
  return rows.length
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(__dirname, '../fixtures')

export function readFixture(table: string): Record<string, unknown>[] {
  return JSON.parse(
    readFileSync(resolve(FIXTURES, `${table}.json`), 'utf8'),
  ) as Record<string, unknown>[]
}
