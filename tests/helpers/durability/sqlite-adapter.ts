import { DatabaseSync } from 'node:sqlite'
import type { SqlAdapter } from '../../../src/conversation/journal-sql'

/** Real SQL, never a statement-matching mock; separate processes open separate connections. */
export function openSqlite(path: string): { db: SqlAdapter; close(): void } {
  const connection = new DatabaseSync(path)
  connection.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000')
  return {
    db: {
      async exec(sql, params = []) {
        return { rowsAffected: Number(connection.prepare(sql).run(...params as never[]).changes) }
      },
      async query<TRow>(sql: string, params: readonly unknown[] = []): Promise<TRow[]> {
        return connection.prepare(sql).all(...params as never[]) as TRow[]
      },
    },
    close: () => connection.close(),
  }
}
