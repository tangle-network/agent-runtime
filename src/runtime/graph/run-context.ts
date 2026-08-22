/**
 * Opening a graph run: begin or resume the journaled tree, rebuild the pool and the kernel `Scope`
 * on the SAME recipe the kernel supervisor uses for its own resume, and fold the prior journal
 * into scheduler state. Extracted so the restart contract is one readable unit rather than a
 * preamble inside the loop.
 */
import {
  closesCursorSlot,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  materializeTreeView,
  pendingWaits,
  replaySpawnTree,
} from '../../durable/spawn-journal'
import { ValidationError } from '../../errors'
import { createBudgetPool } from '../supervise/budget'
import { createExecutorRegistry } from '../supervise/runtime'
import { createScope } from '../supervise/scope'
import {
  maxSeqOf,
  sumMeasuredSpendFromEvents,
  uncertainSpawnBudgets,
} from '../supervise/supervisor'
import type { Budget, ResultBlobStore, Scope, SpawnEvent, SpawnJournal } from '../supervise/types'
import { addSpend } from '../util'
import type { CompiledGraph } from './compile'
import { applyGraphFoldEvent, emptyFoldState, type GraphFoldState } from './fold'

/** Engine-appended `woken` ordinals start here — far above any kernel cursor counter, so the two
 *  counters can advance independently without ever colliding. */
export const ENGINE_WOKEN_SEQ_BASE = 10_000_000

export interface GraphRunContext {
  readonly runId: string
  readonly journal: SpawnJournal
  readonly blobs: ResultBlobStore
  readonly scope: Scope<unknown>
  readonly abort: AbortController
  readonly state: GraphFoldState
  readonly resuming: boolean
  /** Journal events present before this process started; empty on a fresh run. */
  readonly prior: ReadonlyArray<SpawnEvent>
  /** Next engine fold-event ordinal, and next engine `woken` ordinal. */
  readonly engineSeq: number
  readonly engineWokenSeq: number
  /** Ledger ordinals already used by a prior process. */
  readonly ledgerSeq: number
}

/** Begin or resume a run's journaled tree, pool, scope and folded state. */
export async function openGraphRun(args: {
  readonly compiled: CompiledGraph
  readonly runId: string
  readonly budget: Budget
  readonly journal?: SpawnJournal
  readonly blobs?: ResultBlobStore
  readonly now: () => number
  readonly resume?: boolean
  readonly signal?: AbortSignal
  readonly onAbort: (listener: () => void) => void
}): Promise<GraphRunContext> {
  const journal = args.journal ?? new InMemorySpawnJournal()
  const blobs = args.blobs ?? new InMemoryResultBlobStore()
  const loaded = await journal.loadTree(args.runId)
  if (loaded !== undefined && args.resume !== true) {
    throw new ValidationError(
      `runEngineGraph: runId '${args.runId}' already exists; pass resume: true to continue it or use a new runId`,
    )
  }
  const prior = loaded ?? []
  const resuming = args.resume === true && prior.length > 0
  let runEpochMs = args.now()
  let rootBudget = args.budget
  if (loaded === undefined) {
    await journal.beginTree(args.runId, new Date(runEpochMs).toISOString())
  }
  if (resuming) {
    const root = prior.find((ev) => ev.kind === 'spawned' && ev.id === args.runId)
    if (root?.kind === 'spawned') {
      runEpochMs = Date.parse(root.at)
      rootBudget = root.budget
    }
  } else {
    // The engine's root anchor: what a restart reads its epoch and deadline from, exactly as the
    // kernel supervisor journals its own root. A begun-but-empty journal writes it here too.
    await journal.appendEvent(args.runId, {
      kind: 'spawned',
      id: args.runId,
      label: 'graph-root',
      budget: args.budget,
      runtime: 'inline',
      seq: 0,
      at: new Date(runEpochMs).toISOString(),
    })
  }

  const elapsed = () => args.now() - runEpochMs
  const measured = resuming ? sumMeasuredSpendFromEvents([...prior]) : undefined
  const pool = createBudgetPool(
    rootBudget,
    elapsed,
    measured === undefined
      ? undefined
      : {
          committed: addSpend(measured.childWork, measured.driverInference),
          uncertainReservations: uncertainSpawnBudgets([...prior]),
          ...(rootBudget.deadlineMs !== undefined
            ? { absoluteDeadlineMs: runEpochMs + rootBudget.deadlineMs }
            : {}),
        },
  )
  const abort = new AbortController()
  if (args.signal !== undefined) {
    const forward = () => abort.abort(args.signal?.reason)
    args.signal.addEventListener('abort', forward, { once: true })
    args.onAbort(() => args.signal?.removeEventListener('abort', forward))
    if (args.signal.aborted) abort.abort(args.signal.reason)
  }
  const scope = createScope<unknown>({
    parentId: args.runId,
    root: args.runId,
    pool,
    journal,
    blobs,
    executors: createExecutorRegistry(),
    seams: {},
    depth: 0,
    signal: abort.signal,
    now: args.now,
    ...(resuming
      ? {
          resumeFrom: {
            settled: await replaySpawnTree(journal, blobs, args.runId),
            view: materializeTreeView([...prior]),
            maxSpawnOrdinal: maxSeqOf([...prior], (ev) => ev.kind === 'spawned'),
            maxCursorSeq: maxSeqOf([...prior], closesCursorSlot),
            maxWaitOrdinal: maxSeqOf([...prior], (ev) => ev.kind === 'waiting'),
            waits: pendingWaits([...prior]),
            keys: new Map(),
            priorSpend: sumMeasuredSpendFromEvents([...prior]),
          },
        }
      : {}),
  })

  const state = emptyFoldState(args.compiled)
  if (resuming) for (const ev of prior) applyGraphFoldEvent(state, ev, args.compiled)

  return {
    runId: args.runId,
    journal,
    blobs,
    scope,
    abort,
    state,
    resuming,
    prior,
    engineSeq: resuming ? maxEngineSeq(prior) + 1 : 0,
    engineWokenSeq:
      ENGINE_WOKEN_SEQ_BASE +
      (resuming
        ? prior.filter((ev) => ev.kind === 'woken' && ev.seq >= ENGINE_WOKEN_SEQ_BASE).length
        : 0),
    ledgerSeq: prior.filter((ev) => ev.kind === 'edge').length,
  }
}

function maxEngineSeq(events: ReadonlyArray<SpawnEvent>): number {
  let max = -1
  for (const ev of events) {
    const engineEvent =
      ev.kind === 'node-inputs-resolved' ||
      ev.kind === 'edge-verdict' ||
      ev.kind === 'join-state' ||
      (ev.kind === 'waiting' && ev.spec.kind === 'token')
    if (engineEvent && ev.seq > max) max = ev.seq
  }
  return max
}
