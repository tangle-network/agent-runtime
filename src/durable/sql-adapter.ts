/**
 * SQL seam for Runtime's shared-SQL run persistence (`openSqlRunStore`,
 * `createFencedSqlRunContext`). Callers wire a `SqlAdapter` against the driver
 * their deployment already uses (D1, postgres, sqlite, libSQL); Runtime takes
 * no native database dependency.
 *
 * @stable
 */

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
