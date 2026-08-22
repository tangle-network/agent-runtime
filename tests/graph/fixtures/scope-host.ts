/**
 * A real kernel `Scope` to host node instances exactly as the scheduler (agent-runtime#980) will:
 * one pool, one journal, one blob store, the default executor registry. No supervisor sits in
 * between, so nothing asks a node for an oracle verdict; its settled output is its result.
 */
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../../src/durable/spawn-journal'
import { createBudgetPool } from '../../../src/runtime/supervise/budget'
import { createExecutorRegistry } from '../../../src/runtime/supervise/runtime'
import { createScope } from '../../../src/runtime/supervise/scope'

export async function scopeHost() {
  const pool = createBudgetPool({ maxIterations: 100, maxTokens: 100_000 }, 0)
  const journal = new InMemorySpawnJournal()
  await journal.beginTree('run', new Date(0).toISOString())
  const scope = createScope<unknown>({
    parentId: 'run',
    root: 'run',
    pool,
    journal,
    blobs: new InMemoryResultBlobStore(),
    executors: createExecutorRegistry(),
    seams: {},
    depth: 0,
    signal: new AbortController().signal,
    now: () => 0,
  })
  return { pool, journal, scope }
}
