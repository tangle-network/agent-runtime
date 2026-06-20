/**
 * @experimental
 *
 * `createInMemoryRunContext` — the one-call bundle of the in-memory stores a
 * `createSupervisor().run(root, task, opts)` needs: a fresh `InMemorySpawnJournal`
 * (the event-sourced spawn log), a fresh `InMemoryResultBlobStore` (the
 * content-addressed `outRef` payload store the driver's `observe`/`finalize` reads
 * settled outputs through), and a fresh `createExecutorRegistry()` (the open
 * `AgentSpec → Executor` resolver).
 *
 * It exists to kill the boilerplate every offline/local supervised run repeats by
 * hand — three constructors threaded into `SupervisorOpts` — and to single-source the
 * ONE wiring invariant that is easy to get wrong: when the root is the recursive
 * `coordinationDriverAgent` LLM-driver brain AND it may spawn DRIVER children (agents
 * driving agents), the registry MUST be wrapped with `withDriverExecutor` so a
 * `role: 'driver'` child resolves to the nested-scope executor — and that SAME blob
 * store MUST be the one passed to `coordinationDriverAgent({ blobs })`, or the driver
 * reads from a different store than the scope writes to. Pass `{ withDriver: true }`
 * and reuse the returned `blobs` for both.
 *
 * The spread shape matches `SupervisorOpts` exactly, so the call site reads:
 *   const run = createInMemoryRunContext()
 *   await createSupervisor().run(root, task, { budget, runId, ...run })
 */

import {
  FileResultBlobStore,
  FileSpawnJournal,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
} from '../../durable/spawn-journal'
import { withDriverExecutor } from './driver-executor'
import { createExecutorRegistry } from './runtime'
import type { ExecutorRegistry, ResultBlobStore, SpawnJournal } from './types'

/** Options for a supervised run context. */
export interface InMemoryRunContextOptions {
  /**
   * Wrap the executor registry with `withDriverExecutor` so a spawned child marked
   * `role: 'driver'` resolves to the recursive driver-executor (agents driving agents
   * over a nested `Scope` on the same conserved pool). Leave `false` for a flat tree of
   * leaf workers. Default `false`.
   */
  readonly withDriver?: boolean
  /**
   * Persist the spawn journal + result blobs under this directory instead of in memory. When
   * set, the run survives a process crash: a later `run` with the SAME `runId` against the SAME
   * `dir` resumes from the last committed settlement (the supervisor `loadTree`s it first). The
   * journal is `${dir}/spawn-journal.jsonl` (fsynced per append) and the blobs live under
   * `${dir}/blobs/` (one fsynced file per `outRef`). Unset ⇒ in-memory (tests / scratch).
   */
  readonly dir?: string
}

/**
 * The bundle of stores a supervised run needs, shaped to spread into `SupervisorOpts`.
 * The fields are exactly `SupervisorOpts`' `journal` / `blobs` / `executors`.
 */
export interface InMemoryRunContext {
  readonly journal: SpawnJournal
  readonly blobs: ResultBlobStore
  readonly executors: ExecutorRegistry
}

/**
 * Build a fresh run context. With no `dir` it is in-memory (every call returns NEW stores, so
 * two runs never cross-contaminate). With `dir` set it is durable: the spawn journal + result
 * blobs are file-backed (fsynced), so a run that dies mid-flight resumes from the last
 * committed settlement when re-run with the same `runId` and `dir`.
 */
export function createInMemoryRunContext(opts: InMemoryRunContextOptions = {}): InMemoryRunContext {
  const base = createExecutorRegistry()
  const durable = opts.dir !== undefined
  return {
    journal: durable
      ? new FileSpawnJournal(`${opts.dir}/spawn-journal.jsonl`)
      : new InMemorySpawnJournal(),
    blobs: durable ? new FileResultBlobStore(`${opts.dir}/blobs`) : new InMemoryResultBlobStore(),
    executors: opts.withDriver ? withDriverExecutor(base) : base,
  }
}

/**
 * Durable run context — the file-backed default for a real (non-test) supervised run. Equivalent
 * to `createInMemoryRunContext({ dir, ...opts })`; named so a caller's intent ("this run must
 * survive a crash") reads at the call site. Re-running with the same `runId` + `dir` resumes.
 */
export function createFileRunContext(
  dir: string,
  opts: Omit<InMemoryRunContextOptions, 'dir'> = {},
): InMemoryRunContext {
  return createInMemoryRunContext({ ...opts, dir })
}
