/**
 *
 * `createSqlRunContext` — the SQL-backed durable bundle a `createSupervisor().run` (or a
 * `runGraph`/`supervise` call that accepts injected stores) needs: a `SqlSpawnJournal`, a
 * `SqlResultBlobStore` (both over one `SqlStatements` seam — the same adapter shape
 * `SqlConversationJournal` takes), and a fresh `createExecutorRegistry()`, with `resume: true`
 * so spreading the context makes the run loadTree-first.
 *
 * The SQL analogue of `createFileRunContext`: where that bundle owns a directory, this one owns
 * tables in a database the caller already operates. The durable coordination side-log and
 * cancellation observers remain file-based behind `runDir`; a SQL coordination log is follow-up.
 *
 * @experimental
 */

import {
  SqlResultBlobStore,
  SqlSpawnJournal,
  type SqlStatements,
} from '../../durable/spawn-journal-sql'
import { createExecutorRegistry } from './runtime'
import type { ExecutorRegistry, ResultBlobStore, SpawnJournal } from './types'

export interface SqlRunContext {
  readonly journal: SpawnJournal
  readonly blobs: ResultBlobStore
  readonly executors: ExecutorRegistry
  /** Always `true` — a SQL context is durable by construction, so runs resume-first. */
  readonly resume: true
}

/** Build a durable run context over one SQL statement seam. Tables are created on first use. */
export function createSqlRunContext(db: SqlStatements): SqlRunContext {
  return {
    journal: new SqlSpawnJournal(db),
    blobs: new SqlResultBlobStore(db),
    executors: createExecutorRegistry(),
    resume: true,
  }
}
