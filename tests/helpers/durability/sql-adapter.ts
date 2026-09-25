import { DatabaseSync } from 'node:sqlite'
import type { SqlAdapter } from '../../../src/conversation/journal-sql'

export type SqlBoundary = (
  when: 'before' | 'after',
  sql: string,
  params: readonly unknown[],
) => void | Promise<void>

/** Real independent sqlite connections, not a SQL interpreter mock. */
export function openSql(path: string, boundary?: SqlBoundary) {
  const database = new DatabaseSync(path)
  database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 10000')
  const adapter: SqlAdapter = {
    async exec(sql, params = []) {
      await boundary?.('before', sql, params)
      const result = database.prepare(sql).run(...(params as never[]))
      await boundary?.('after', sql, params)
      return { rowsAffected: Number(result.changes) }
    },
    async query<Row>(sql: string, params: readonly unknown[] = []): Promise<Row[]> {
      return database.prepare(sql).all(...(params as never[])) as Row[]
    },
  }
  return { database, adapter }
}
