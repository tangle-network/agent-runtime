/**
 * Wrap better-sqlite3 in the D1DatabaseLike surface so the durable-runs
 * test matrix exercises the D1DurableRunStore against a real SQLite engine.
 * Catches actual SQL semantics — unique constraints, CASE expressions,
 * conditional UPDATEs — instead of a hand-rolled parser stub.
 */

import type { Database as SqliteDatabase, Statement as SqliteStatement } from 'better-sqlite3'
import Database from 'better-sqlite3'

import type { D1DatabaseLike, D1PreparedStatementLike } from '../d1-store'

export interface SqliteD1Handle {
  db: D1DatabaseLike
  raw: SqliteDatabase
  close(): void
}

export function createSqliteD1(): SqliteD1Handle {
  const raw = new Database(':memory:')
  raw.pragma('journal_mode = WAL')
  raw.pragma('foreign_keys = ON')
  const adapter: D1DatabaseLike = {
    prepare(query: string): D1PreparedStatementLike {
      // D1's ISO-8601 millis: `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` is
      // SQLite-native; keep as-is.
      return new SqliteAdaptedStatement(raw.prepare(query))
    },
    async batch(statements: D1PreparedStatementLike[]): Promise<unknown[]> {
      const results: unknown[] = []
      for (const s of statements) results.push(await s.run())
      return results
    },
  }
  return { db: adapter, raw, close: () => raw.close() }
}

class SqliteAdaptedStatement implements D1PreparedStatementLike {
  private bound: unknown[] = []

  constructor(private readonly stmt: SqliteStatement) {}

  bind(...values: unknown[]): D1PreparedStatementLike {
    this.bound = values.map(coerceBindValue)
    return this
  }

  async first<T = unknown>(): Promise<T | null> {
    const row = this.stmt.get(...this.bound)
    return (row as T | undefined) ?? null
  }

  async all<T = unknown>(): Promise<{ results: T[] }> {
    const rows = this.stmt.all(...this.bound) as T[]
    return { results: rows }
  }

  async run(): Promise<{ success: boolean; meta?: { changes?: number } }> {
    const info = this.stmt.run(...this.bound)
    return { success: true, meta: { changes: info.changes } }
  }
}

/** better-sqlite3 rejects raw `undefined`; map to null. */
function coerceBindValue(v: unknown): unknown {
  if (v === undefined) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  return v
}
