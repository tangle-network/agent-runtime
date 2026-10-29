import { appendSpawnEvents } from '../../durable/spawn-journal/journal-store'
import { RuntimeRunStateError } from '../../errors'
import { RunCancellationReason } from './abortable'
import { type BudgetPool, createBudgetPool } from './budget'
import { newExecutionAttemptId } from './materialization'
import { prepareScopeResume, type ScopeResumeState } from './recover-executors'
import {
  assertResumeContract,
  changesRootProfile,
  recordRootReentered,
  recordRootSegment,
  rootExecutionBindingReceipt,
  rootMaterializationReceipt,
  rootStartedAtMs,
} from './supervisor-root-contract'
import type { SpawnEvent, SupervisorOpts } from './types'

/** The run's durable tree as this process opened it: resumed from its journal, or begun fresh. */
export interface OpenedRunTree {
  readonly rootAttemptId: string
  readonly runStartedAt: string
  /** The prior journal events; on a resume, the events the recovered scope starts from. */
  readonly prior: SpawnEvent[] | undefined
  readonly resumeFrom: ScopeResumeState | undefined
  readonly pool: BudgetPool
  /** The instant terminal wall-clock `ms` measures from. A resumed run anchors to the ORIGINAL
   *  root instant (the same anchor the absolute deadline uses), so its duration spans processes. */
  readonly runEpochMs: number
}

export async function openRunTree(opts: SupervisorOpts, now: () => number): Promise<OpenedRunTree> {
  const rootAttemptId = newExecutionAttemptId(opts.runId)
  // One instant owns the pool's absolute deadline and the durable root records, captured before
  // any async journal work so a slow begin cannot extend the run on restart.
  const runStartedAtMs = now()
  const runStartedAt = new Date(runStartedAtMs).toISOString()

  // RESUME-FIRST (opt-in via `opts.resume`): read any prior journal tree for this runId BEFORE
  // beginning a fresh one. A non-empty tree means a prior run committed work, so rehydrate it
  // (`replaySpawnTree`/`materializeTreeView`) instead of starting over; an empty tree, and every
  // run that did NOT opt in, takes the fresh path unchanged.
  const existing = await opts.journal.loadTree(opts.runId)
  if (opts.resume !== true && existing !== undefined) {
    throw new RuntimeRunStateError(
      `supervisor: runId '${opts.runId}' already exists; pass resume: true to continue it or use a new runId`,
    )
  }
  const prior = opts.resume === true ? existing : undefined
  const resuming = prior !== undefined && prior.length > 0
  const opened =
    resuming && prior !== undefined
      ? await resumeRunTree(opts, prior, now, runStartedAt, rootAttemptId)
      : await beginRunTree(opts, existing, prior, runStartedAtMs, runStartedAt, rootAttemptId)
  const stableRootReceipt = resuming
    ? opened.prior?.find(
        (event): event is Extract<SpawnEvent, { kind: 'materialized' }> =>
          event.kind === 'materialized' && event.id === opts.runId,
      )?.receipt
    : rootMaterializationReceipt(opts)
  if (stableRootReceipt !== undefined) {
    const rootBinding = rootExecutionBindingReceipt(opts, stableRootReceipt, rootAttemptId)
    if (rootBinding !== undefined) {
      await opts.journal.appendEvent(opts.runId, {
        kind: 'execution-bound',
        id: opts.runId,
        binding: rootBinding,
        seq: 0,
        at: runStartedAt,
      })
    }
  }
  return opened
}

async function resumeRunTree(
  opts: SupervisorOpts,
  prior: SpawnEvent[],
  now: () => number,
  runStartedAt: string,
  rootAttemptId: string,
): Promise<OpenedRunTree> {
  const rootEvent = assertResumeContract(prior, opts)
  const runEpochMs = rootStartedAtMs(rootEvent)
  // Restore committed evidence even after the execution deadline; a named terminal cancel
  // prepares cleanup descriptors without permitting a new executor invocation.
  const cancelledAtEntry =
    opts.signal?.aborted === true && opts.signal.reason instanceof RunCancellationReason
  const { resumeFrom, poolRestore } = await prepareScopeResume(
    opts,
    prior,
    opts.signal ?? new AbortController().signal,
    now,
    opts.runId,
    cancelledAtEntry,
  )
  const events = [...resumeFrom.events]
  const pool = createBudgetPool(opts.budget, runEpochMs, poolRestore)
  await recordRootSegment(opts, events, runStartedAt, false)
  await recordRootReentered(opts, resumeFrom, runStartedAt)
  return { rootAttemptId, runStartedAt, prior: events, resumeFrom, pool, runEpochMs }
}

async function beginRunTree(
  opts: SupervisorOpts,
  existing: SpawnEvent[] | undefined,
  prior: SpawnEvent[] | undefined,
  runStartedAtMs: number,
  runStartedAt: string,
  rootAttemptId: string,
): Promise<OpenedRunTree> {
  if (opts.rootSegment !== undefined && changesRootProfile(opts.rootSegment)) {
    throw new RuntimeRunStateError(
      `supervisor: run '${opts.runId}' has no recorded root to change the model or harness of; a new run takes them from its profile`,
    )
  }
  const pool = createBudgetPool(opts.budget, runStartedAtMs)
  // Fresh run: begin the tree and journal the root as its own parent-less `spawned` node (ordinal 0),
  // so journal readers (`trajectoryReport`, `replaySpawnTree`, `materializeTreeView`) can rebuild
  // the WHOLE tree; the root is never `scope.spawn`ed, and without this `trajectoryReport` fails its
  // `nodes.has(root)` invariant. The uniqueness guard skips `spawned` events, so sharing ordinal 0
  // with the first child is no collision, and replay ignores them for settlement reconstruction.
  // A crash may have committed only beginTree; beginning it again with a new timestamp would
  // reject a valid empty durable run.
  if (existing === undefined) await opts.journal.beginTree(opts.runId, runStartedAt)
  const rootReceipt = rootMaterializationReceipt(opts)
  const rootRuntime = opts.rootMaterialization?.runtime ?? 'inline'
  // The root records publish as ONE grouped record where the store supports it, so a SQL
  // context's fenced head advances once for the whole initialization.
  const rootEvents: SpawnEvent[] = [
    {
      kind: 'spawned',
      id: opts.runId,
      label: 'root',
      budget: opts.budget,
      runtime: rootRuntime,
      ...(opts.reservationPolicy ? { recursiveAdmission: { policy: opts.reservationPolicy } } : {}),
      ...(opts.rootIdentity ? { identity: opts.rootIdentity } : {}),
      seq: 0,
      at: runStartedAt,
    },
  ]
  if (rootReceipt !== undefined) {
    rootEvents.push({
      kind: 'materialized',
      id: opts.runId,
      receipt: rootReceipt,
      seq: 0,
      at: runStartedAt,
    })
  }
  await appendSpawnEvents(opts.journal, opts.runId, rootEvents)
  await recordRootSegment(opts, [], runStartedAt, true)
  return {
    rootAttemptId,
    runStartedAt,
    prior,
    resumeFrom: undefined,
    pool,
    runEpochMs: runStartedAtMs,
  }
}
