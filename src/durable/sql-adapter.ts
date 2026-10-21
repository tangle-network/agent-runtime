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
