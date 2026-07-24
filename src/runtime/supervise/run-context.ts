/**
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
 * `driverAgent` LLM-driver brain AND it may spawn DRIVER children (agents
 * driving agents), the registry MUST be wrapped with `withDriverExecutor` so a
 * `role: 'driver'` child resolves to the nested-scope executor — and that SAME blob
 * store MUST be the one passed to `driverAgent({ blobs })`, or the driver
 * reads from a different store than the scope writes to. Pass `{ withDriver: true }`
 * and reuse the returned `blobs` for both.
 *
 * The spread shape matches `SupervisorOpts` exactly, so the call site reads:
 *   const run = createInMemoryRunContext()
 *   await createSupervisor().run(root, task, { budget, runId, ...run })
 *
 * @experimental
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
}

/**
 * The bundle of stores a supervised run needs, shaped to spread into `SupervisorOpts`.
 * The fields are exactly `SupervisorOpts`' `journal` / `blobs` / `executors`.
 */
export interface InMemoryRunContext {
  readonly journal: SpawnJournal
  readonly blobs: ResultBlobStore
  readonly executors: ExecutorRegistry
  /**
   * Present (and `true`) only on a DURABLE context (`createFileRunContext`), so spreading the
   * context into `SupervisorOpts` also opts the run into resume-first. An in-memory context
   * leaves it undefined: there is never a prior tree to resume, and the default stays fresh-run.
   */
  readonly resume?: boolean
}

/** The stores a supervised run needs, in-memory or file-backed. `InMemoryRunContext` is the
 *  historical name for the same shape. */
export type RunContext = InMemoryRunContext

/**
 * Build a fresh in-memory run context. Every call returns NEW stores (no shared global
 * state between runs), so two runs never cross-contaminate their journals/blobs.
 */
export function createInMemoryRunContext(opts: InMemoryRunContextOptions = {}): InMemoryRunContext {
  const base = createExecutorRegistry()
  return {
    journal: new InMemorySpawnJournal(),
    blobs: new InMemoryResultBlobStore(),
    executors: opts.withDriver ? withDriverExecutor(base) : base,
  }
}

/**
 * Build a DURABLE run context: the spawn journal and the result blobs are file-backed (fsynced
 * per append/write) under `dir`, and the context carries `resume: true` so spreading it into
 * `SupervisorOpts` makes the supervisor `loadTree`-first. A run that dies mid-flight therefore
 * resumes when it is re-run with the SAME `runId` and the SAME `dir`: the committed children come
 * back on `Scope.resume` (rehydrated by `replaySpawnTree`) instead of being re-executed.
 *
 * Layout: `${dir}/spawn-journal.jsonl` (one JSONL record per event) and `${dir}/blobs/` (one
 * content-addressed JSON file per settled result). The directory is created on first write.
 *
 * Opt-in by construction — `createInMemoryRunContext()` is unchanged and stays the default, so no
 * existing consumer writes to disk or resumes unless it asks for this.
 */
export function createFileRunContext(
  dir: string,
  opts: InMemoryRunContextOptions = {},
): RunContext {
  const base = createExecutorRegistry()
  return {
    journal: new FileSpawnJournal(`${dir}/spawn-journal.jsonl`),
    blobs: new FileResultBlobStore(`${dir}/blobs`),
    executors: opts.withDriver ? withDriverExecutor(base) : base,
    resume: true,
  }
}
