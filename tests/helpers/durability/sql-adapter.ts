import { DatabaseSync } from 'node:sqlite'
import type { SqlAdapter } from '../../../src/durable/sql-adapter'
import { SqlRunOwnershipError } from '../../../src/runtime/supervise/sql-run-context'

export type SqlBoundary = (
  when: 'before' | 'after',
  sql: string,
  params: readonly unknown[],
) => void | Promise<void>

/**
 * The run-context lease the SQL durability tests hold. The heartbeat must land within the lease
 * even when the test host stalls the event loop: at 400 ms a loaded CI runner let a live owner's
 * lease expire mid-run. A takeover after a SIGKILL waits out at most one lease.
 */
export const TEST_LEASE = { leaseMs: 2_000, heartbeatMs: 250 } as const

/** Preserve unrelated driver failures; SQLite BUSY is a real competing-writer denial. */
export function assertSqlOwnershipDenial(error: unknown): asserts error is Error {
  if (
    error instanceof SqlRunOwnershipError ||
    (error instanceof Error &&
      'code' in error &&
      error.code === 'ERR_SQLITE_ERROR' &&
      'errcode' in error &&
      error.errcode === 5)
  )
    return
  throw error
}

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
