/**
 *
 * Durable conversation journal backed by any SQL store. Adapter-agnostic by
 * design: callers wire a `SqlAdapter` against their driver of choice (D1,
 * postgres, sqlite, libSQL…) and the same journal implementation persists
 * conversation runs durably across process restarts. The schema is two
 * tables — runs (latest state) + events (append-only log) — so a partial
 * crash in the middle of a turn leaves an unambiguous "last committed turn"
 * to resume from.
 *
 * Why not bake in a specific driver? agent-runtime ships against multiple
 * runtimes (Cloudflare Workers, Node, Bun, Deno) and consumers' fleets have
 * already standardized on one of D1 / postgres / sqlite / libSQL. Adapter
 * indirection costs ~5 lines per driver in the consumer's code and keeps the
 * SDK free of native deps.
 *
 * @example D1 (Cloudflare Workers)
 *   import { SqlConversationJournal, d1ToSqlAdapter } from '@tangle-network/agent-runtime'
 *   const journal = new SqlConversationJournal(d1ToSqlAdapter(env.DB))
 *   await journal.migrate()                     // once at deploy
 *   await runConversation(conv, { seed, journal, runId: 'run_abc' })
 *
 * @example node-postgres
 *   import { Pool } from 'pg'
 *   const pool = new Pool({ connectionString: process.env.DATABASE_URL })
 *   const pg: SqlAdapter = {
 *     exec: async (sql, params = []) => {
 *       const r = await pool.query(sql, params as never)
 *       return { rowsAffected: r.rowCount ?? 0 }
 *     },
 *     query: async (sql, params = []) => (await pool.query(sql, params as never)).rows,
 *   }
 *   const journal = new SqlConversationJournal(pg)
 *   await journal.migrate()
 *
 * @stable
 */

import type { ConversationJournal, ConversationJournalEntry } from './journal'
import type { ConversationTurn, HaltReason } from './types'

/**
 * Minimal SQL driver shape. Implementations forward to whichever client the
 * deployment already uses; agent-runtime takes no opinion on which.
 *
 * Parameter placeholders MUST be `?` (positional). All adapters listed in the
 * file header accept this convention.
 */
export interface SqlAdapter {
  /** Execute a write statement (INSERT/UPDATE/DELETE/DDL). */
  exec(sql: string, params?: readonly unknown[]): Promise<{ rowsAffected: number }>
  /** Execute a read statement (SELECT). Returns rows as plain objects. */
  query<TRow = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<TRow[]>
}

/**
 * Adapt a Cloudflare D1 binding to the SqlAdapter shape. Lives here so D1
 * consumers don't have to write the wrapper themselves; the runtime never
 * imports `@cloudflare/workers-types` directly (peer-style typing).
 */
export function d1ToSqlAdapter(db: D1DatabaseLike): SqlAdapter {
  return {
    async exec(sql, params = []) {
      const stmt = db.prepare(sql)
      const bound = params.length > 0 ? stmt.bind(...params) : stmt
      const result = await bound.run()
      const meta = (result as { meta?: { rows_written?: number; changes?: number } }).meta
      return { rowsAffected: meta?.rows_written ?? meta?.changes ?? 0 }
    },
    async query<TRow>(sql: string, params: readonly unknown[] = []): Promise<TRow[]> {
      const stmt = db.prepare(sql)
      const bound = params.length > 0 ? stmt.bind(...params) : stmt
      const result = await bound.all<TRow>()
      return result.results ?? []
    },
  }
}

/**
 * Structural type matching the surface of `D1Database` we depend on, so the
 * SDK never imports `@cloudflare/workers-types`. Consumers pass their real
 * `D1Database` from `env.DB` and TS structural compatibility lines it up.
 */
export interface D1DatabaseLike {
  prepare(sql: string): D1StmtLike
}
export interface D1StmtLike {
  bind(...params: unknown[]): D1StmtLike
  run(): Promise<unknown>
  all<TRow = unknown>(): Promise<{ results?: TRow[] }>
}

const RUNS_TABLE_DDL = (table: string) => `
  CREATE TABLE IF NOT EXISTS ${table}_runs (
    run_id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    halted_kind TEXT,
    halted_payload TEXT,
    ended_at TEXT
  )
`
const TURNS_TABLE_DDL = (table: string) => `
  CREATE TABLE IF NOT EXISTS ${table}_turns (
    run_id TEXT NOT NULL,
    turn_index INTEGER NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (run_id, turn_index)
  )
`
const TURNS_INDEX_DDL = (table: string) => `
  CREATE INDEX IF NOT EXISTS idx_${table}_turns_run ON ${table}_turns (run_id, turn_index)
`

/**
 * SQL-backed ConversationJournal. Two tables — runs (one row per runId, holds
 * start/halt timestamps + halt reason) and turns (one row per committed turn,
 * payload is the ConversationTurn JSON). Replays the turns table on
 * `loadRun` and writes append-only per `appendTurn`.
 */
export class SqlConversationJournal implements ConversationJournal {
  /**
   * @param db    SQL adapter (D1, postgres, sqlite, libSQL — all work)
   * @param table Table-name prefix; the journal creates `${table}_runs` and
   *              `${table}_turns`. Lets multiple journals share a database
   *              without colliding (e.g. one per product surface).
   */
  constructor(
    private readonly db: SqlAdapter,
    private readonly table: string = 'agent_runtime_journal',
  ) {}

  /**
   * Create the journal's tables if absent. Idempotent. Call once at deploy
   * (or at app boot) — running on every request is harmless but adds latency.
   */
  async migrate(): Promise<void> {
    await this.db.exec(RUNS_TABLE_DDL(this.table))
    await this.db.exec(TURNS_TABLE_DDL(this.table))
    await this.db.exec(TURNS_INDEX_DDL(this.table))
  }

  async loadRun(runId: string): Promise<ConversationJournalEntry | undefined> {
    const runs = await this.db.query<{
      run_id: string
      started_at: string
      halted_kind: string | null
      halted_payload: string | null
      ended_at: string | null
    }>(
      `SELECT run_id, started_at, halted_kind, halted_payload, ended_at FROM ${this.table}_runs WHERE run_id = ?`,
      [runId],
    )
    const row = runs[0]
    if (!row) return undefined
    const turns = await this.db.query<{ payload: string; turn_index: number }>(
      `SELECT payload, turn_index FROM ${this.table}_turns WHERE run_id = ? ORDER BY turn_index ASC`,
      [runId],
    )
    return {
      runId: row.run_id,
      startedAt: row.started_at,
      halted: row.halted_payload ? (JSON.parse(row.halted_payload) as HaltReason) : undefined,
      endedAt: row.ended_at ?? undefined,
      turns: turns.map((t) => JSON.parse(t.payload) as ConversationTurn),
    }
  }

  async beginRun(runId: string, startedAt: string): Promise<void> {
    const existing = await this.db.query<{ started_at: string }>(
      `SELECT started_at FROM ${this.table}_runs WHERE run_id = ?`,
      [runId],
    )
    if (existing.length > 0) {
      if (existing[0]?.started_at !== startedAt) {
        throw new Error(
          `runId '${runId}' already exists with startedAt=${existing[0]?.started_at}; refusing to overwrite with ${startedAt}`,
        )
      }
      return
    }
    await this.db.exec(`INSERT INTO ${this.table}_runs (run_id, started_at) VALUES (?, ?)`, [
      runId,
      startedAt,
    ])
  }

  async appendTurn(runId: string, turn: ConversationTurn): Promise<void> {
    const halted = await this.db.query<{ halted_kind: string | null }>(
      `SELECT halted_kind FROM ${this.table}_runs WHERE run_id = ?`,
      [runId],
    )
    if (halted.length === 0) {
      throw new Error(
        `appendTurn called for unknown runId '${runId}'; call beginRun first or use the runner which handles it`,
      )
    }
    if (halted[0]?.halted_kind) {
      throw new Error(
        `cannot append turn to halted run '${runId}' (halt kind: ${halted[0]?.halted_kind})`,
      )
    }
    await this.db.exec(
      `INSERT INTO ${this.table}_turns (run_id, turn_index, payload) VALUES (?, ?, ?)`,
      [runId, turn.index, JSON.stringify(turn)],
    )
  }

  async recordHalt(runId: string, halt: HaltReason, endedAt: string): Promise<void> {
    const rs = await this.db.exec(
      `UPDATE ${this.table}_runs SET halted_kind = ?, halted_payload = ?, ended_at = ? WHERE run_id = ?`,
      [halt.kind, JSON.stringify(halt), endedAt, runId],
    )
    if (rs.rowsAffected === 0) {
      throw new Error(`recordHalt called for unknown runId '${runId}'`)
    }
  }
}
