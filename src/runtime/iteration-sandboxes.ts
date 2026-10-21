import type { AgentProfile } from '@tangle-network/agent-interface'
import type { PromptOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { ValidationError } from '../errors'
import type { RunAgentRoundsOptions } from './agent-rounds'
import { emitTrace } from './iteration-events'
import { acquireSandbox } from './sandbox-acquire'
import { buildBackendOptions } from './sandbox-backend'
import type { SandboxEvidenceTracker } from './sandbox-evidence-retention'
import {
  createSandboxLineage,
  type SandboxLineage,
  type SandboxLineageHandle,
} from './sandbox-lineage'
import type {
  AgentRunSpec,
  Iteration,
  LoopLineageOptions,
  LoopSandboxPlacement,
  LoopTraceEmitter,
  MountRecorder,
  SandboxClient,
} from './types'
import { deleteBoxSafe, randomUuid, throwAbort, withTimeout } from './util'

/**
 * Per-loop lineage state: the backend-blind lineage, the caller's opt-in flags,
 * and the live handle for each completed iteration so a later round can continue
 * or fork from it. `undefined` ⇒ no lineage; the kernel uses the fresh-box path.
 */
export interface LineageState {
  lineage: SandboxLineage
  options: LoopLineageOptions
  /** `ExecCtx.promptOptions` — forwarded into every turn the lineage streams. */
  promptOptions?: Omit<PromptOptions, 'signal' | 'sessionId'>
  /** iteration index → its live box+session handle (kept alive across rounds). */
  handles: Map<number, SandboxLineageHandle>
  /**
   * Whether the kernel may free non-frontier boxes after each round. Safe only
   * when the driver never authors its own branch point (`describePlan` absent),
   * so the kernel-inferred `branchPoint` — which moves monotonically toward
   * higher-scoring iterations — is the only descent source. A driver that
   * declares `parentIndex` may descend from any prior iteration, so no box can
   * be freed before loop end.
   */
  canPrune: boolean
}

/**
 * Build the lineage when either lineage flag is set. Probes the legacy fork
 * capability once per run (live branching is detected on each box).
 * Rejects the lineage + `onWorkerBox` combination: both claim the same
 * box-ownership channel, and silently honoring one would leak or double-free.
 */
export async function setUpLineage<Task, Output, Decision>(
  options: RunAgentRoundsOptions<Task, Output, Decision>,
  maxConcurrency: number,
  recordMount: MountRecorder,
  promptOptions: Omit<PromptOptions, 'signal' | 'sessionId'> | undefined,
  evidenceTracker?: SandboxEvidenceTracker,
): Promise<LineageState | undefined> {
  const lineageOpts = options.lineage
  if (!lineageOpts || (!lineageOpts.sessionContinuity && !lineageOpts.forkFanout)) return undefined
  if (options.onWorkerBox) {
    throw new ValidationError(
      'runAgentRounds: `lineage` and `onWorkerBox` both own worker boxes — pass only one',
    )
  }
  return {
    lineage: createSandboxLineage(options.ctx.sandboxClient, {
      maxConcurrency,
      streaming: lineageOpts.streaming,
      recordMount,
      ...(evidenceTracker === undefined
        ? {}
        : {
            failOnDestroyError: true,
            onAcquire: (box: SandboxInstance, profile: AgentProfile) =>
              evidenceTracker.register(box, profile),
            beforeDelete: (box: SandboxInstance) => evidenceTracker.destroy(box),
          }),
    }),
    options: lineageOpts,
    ...(promptOptions === undefined ? {} : { promptOptions }),
    handles: new Map(),
    canPrune: typeof options.driver.describePlan !== 'function',
  }
}

/**
 * One iteration's sandbox-stream source for a lineage round. The kernel awaits
 * `acquire()` inside the concurrency-bounded batch (so a fork's per-branch
 * `streamPrompt` and a continue's same-box stream are both rate-limited and
 * abort-checked like a fresh create). Returns the live event stream plus the
 * handle to record for the NEXT round to descend from.
 */
interface LineageStreamSource {
  acquire(): Promise<{
    events: AsyncIterable<SandboxEvent>
    handle: SandboxLineageHandle
    executionId?: string
  }>
}

/** The per-round lineage plan: a stream source per slice offset, or `undefined`
 *  for offsets with no lineage source (defensive — never expected). */
export type LineageRoundPlan = (LineageStreamSource | undefined)[]

/**
 * Decide, for one round, how each iteration acquires its sandbox stream:
 *   - refine (1 task) + `sessionContinuity` + a live parent handle ⇒ continue
 *     the parent session on its box.
 *   - fanout (N tasks) + `forkFanout` + a live parent handle ⇒ branch the parent
 *     box once and stream each branch from a child box (legacy CRIU or fresh-box
 *     fallback is handled inside the lineage).
 *   - otherwise (round 0, no parent, the off flag) ⇒ start a fresh box per
 *     iteration THROUGH the lineage so it's owned + a handle is recorded for a
 *     later round to descend from.
 * Round 0 (parentIndex undefined) always starts fresh — the independence of the
 * first batch is preserved.
 */
export function planLineageRound<Task>(
  state: LineageState,
  specs: AgentRunSpec<Task>[],
  slice: Task[],
  parentIndex: number | undefined,
  signal: AbortSignal,
  retainEvidence: boolean,
): LineageRoundPlan {
  const executionIds = retainEvidence ? slice.map(() => randomUuid()) : []
  const promptForOffset = (offset: number) =>
    retainEvidence
      ? { ...(state.promptOptions ?? {}), executionId: executionIds[offset] }
      : state.promptOptions
  const lineage = state.lineage
  const parent = parentIndex !== undefined ? state.handles.get(parentIndex) : undefined
  const promptFor = (offset: number): string => {
    const spec = specs[offset % specs.length]
    if (!spec)
      throw new ValidationError('runAgentRounds: no AgentRunSpec available for lineage iteration')
    return spec.taskToPrompt(slice[offset] as Task)
  }
  const specAt = (offset: number): AgentRunSpec<unknown> => {
    const spec = specs[offset % specs.length]
    if (!spec)
      throw new ValidationError('runAgentRounds: no AgentRunSpec available for lineage iteration')
    return spec as AgentRunSpec<unknown>
  }

  // Continue the parent session: a single-task round descending from a live
  // handle, with the flag on. Reuses the parent's box + session id.
  if (slice.length === 1 && parent && state.options.sessionContinuity) {
    return [
      {
        async acquire() {
          const events = await lineage.continue(parent, promptFor(0), signal, promptForOffset(0))
          // Continuation threads the SAME handle forward — later rounds keep
          // descending from this box's evolving session.
          return {
            events,
            handle: parent,
            ...(retainEvidence ? { executionId: executionIds[0] } : {}),
          }
        },
      },
    ]
  }

  // Branch the parent box: a multi-task round descending from a live handle,
  // with the flag on. One branch request, N child streams — lazily awaited once
  // and shared across offsets so the batch branches exactly once.
  if (slice.length > 1 && parent && state.options.forkFanout) {
    const prompts = slice.map((_, offset) => promptFor(offset))
    const childSpecs = slice.map((_, offset) => specAt(offset))
    let forked: Promise<{ handle: SandboxLineageHandle; events: AsyncIterable<SandboxEvent> }[]>
    const ensureForked = () => {
      forked ??= lineage.fork(
        parent,
        prompts,
        childSpecs,
        signal,
        state.promptOptions,
        retainEvidence ? executionIds : undefined,
      )
      return forked
    }
    return slice.map((_, offset) => ({
      async acquire() {
        const branches = await ensureForked()
        const branch = branches[offset]
        if (!branch)
          throw new ValidationError('runAgentRounds: lineage fork produced no branch for offset')
        return { ...branch, ...(retainEvidence ? { executionId: executionIds[offset] } : {}) }
      },
    }))
  }

  // Fresh through the lineage (round 0, no parent, or the relevant flag off):
  // start an owned box per iteration and record a handle for later descent.
  return slice.map((_, offset) => ({
    async acquire() {
      const started = await lineage.start(
        specAt(offset),
        promptFor(offset),
        signal,
        promptForOffset(offset),
      )
      return { ...started, ...(retainEvidence ? { executionId: executionIds[offset] } : {}) }
    },
  }))
}

/**
 * After a round, free lineage boxes no future round can descend from. The only
 * descent source for a kernel-inferred topology is `branchPoint`, which moves
 * monotonically toward higher-scoring iterations and never returns to one it has
 * passed — so every box except the current branch point's is unreachable and can
 * be torn down now instead of at loop end. Skipped entirely when the driver
 * authors its own branch point (`canPrune` false): it may descend from any prior
 * iteration. Also skipped when the branch point has no recorded handle (its
 * acquire failed) — that conservative case keeps every box.
 */
export async function pruneLineage<Task, Output>(
  state: LineageState,
  iterations: ReadonlyArray<Iteration<Task, Output>>,
): Promise<void> {
  if (!state.canPrune) return
  const keepIndex = branchPoint(iterations)
  if (keepIndex === undefined) return
  const keep = state.handles.get(keepIndex)
  if (!keep) return
  await state.lineage.prune([keep])
  // Drop handle entries pointing at the now-freed boxes so the map never hands a
  // later round a deleted box. Entries sharing the kept box (a refine chain)
  // stay.
  const stale: number[] = []
  for (const [index, handle] of state.handles) {
    if (handle.box !== keep.box) stale.push(index)
  }
  for (const index of stale) state.handles.delete(index)
}

/**
 * Branch point for a new round — the iteration a later round descends from.
 * Highest-valid-score iteration so far; ties + no-valid fall back to the latest
 * index. Inferred (not driver-declared), so refine renders as a chain and
 * fanout→refine chains off the fanout winner.
 */
export function branchPoint<Task, Output>(
  iterations: ReadonlyArray<Iteration<Task, Output>>,
): number | undefined {
  if (iterations.length === 0) return undefined
  let best = iterations.length - 1
  let bestScore = -Infinity
  for (const iter of iterations) {
    if (iter.verdict?.valid !== true) continue
    const score = iter.verdict.score ?? 0
    if (score > bestScore) {
      bestScore = score
      best = iter.index
    }
  }
  return best
}

const TEARDOWN_TIMEOUT_MS = 15_000

/**
 * Best-effort sandbox teardown. A failed delete must never surface as a loop
 * error, and instances without a `delete` (the loop's test fakes) are skipped.
 * A delete that throws or hangs (bounded by `TEARDOWN_TIMEOUT_MS`) is recorded
 * as a `loop.teardown.failed` trace so a silently-leaking box is observable —
 * distinct from a fake with no `delete`, which is expected and stays silent.
 *
 * The return value names which of those three happened, because the caller pairs the box's
 * lifetime on it: only `'deleted'` closes the lifetime, `'unproven'` leaves it a floor, and
 * `'no-delete-api'` means there was no box lifecycle to time at all.
 */
export async function destroySandboxSafe(
  box: SandboxInstance | undefined,
  trace?: LoopTraceEmitter,
  runId?: string,
  now?: () => number,
): Promise<'deleted' | 'unproven' | 'no-delete-api'> {
  if (!box || typeof (box as { delete?: unknown }).delete !== 'function') return 'no-delete-api'
  const emitFailed = async (reason: string) => {
    if (!trace || !runId) return
    await emitTrace(trace, {
      kind: 'loop.teardown.failed',
      runId,
      timestamp: (now ?? Date.now)(),
      payload: { sandboxId: readSandboxId(box), reason },
    })
  }
  // Bound the delete so a hung platform delete can't wedge loop return after an
  // abort. `undefined` = timed out; `false` = delete threw; `true` = deleted.
  const outcome = await withTimeout(deleteBoxSafe(box), TEARDOWN_TIMEOUT_MS)
  if (outcome === undefined) await emitFailed('timeout')
  else if (outcome === false) await emitFailed('delete threw')
  return outcome === true ? 'deleted' : 'unproven'
}

export function describeSandboxPlacement(
  client: SandboxClient,
  box: SandboxInstance,
): LoopSandboxPlacement {
  if (typeof client.describePlacement === 'function') {
    try {
      const result = client.describePlacement(box)
      if (
        result &&
        typeof result === 'object' &&
        (result.kind === 'sibling' || result.kind === 'fleet')
      ) {
        return {
          kind: result.kind,
          sandboxId: result.sandboxId ?? readSandboxId(box),
          fleetId: result.fleetId,
          machineId: result.machineId,
        }
      }
    } catch {
      // Adapter bug must not corrupt the iteration; fall through to default.
    }
  }
  return { kind: 'sibling', sandboxId: readSandboxId(box) }
}

function readSandboxId(box: SandboxInstance): string | undefined {
  const raw = (box as unknown as { id?: unknown }).id
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

/**
 * Instantiate a sandbox for an `AgentRunSpec`: sets `backend.profile` to the
 * spec's profile (inferring the backend type when the spec doesn't override
 * it) and merges `sandboxOverrides`. Shared by the loop kernel and the
 * `AgentRuntime.act` sandbox bridge so both boot the sandbox identically.
 *
 * `recordMount`, when supplied, is forwarded to `prepareBox` so the caller can
 * declare what it mounted into the box for the run's provenance manifest. The
 * loop kernel passes its per-run recorder; other callers (which have no
 * `LoopResult` to attach to) omit it and the prepareBox recorder is a no-op.
 */
export async function createSandboxForSpec<Task>(
  client: SandboxClient,
  spec: AgentRunSpec<Task>,
  signal: AbortSignal,
  recordMount?: MountRecorder,
  evidenceTracker?: SandboxEvidenceTracker,
): Promise<SandboxInstance> {
  const opts = buildBackendOptions(spec.profile, spec.sandboxOverrides)
  // Cold-start-resilient acquire: a slow scale-from-zero create (node boot +
  // host-agent registration) can't surface as a failure — readiness is observed
  // from sandbox status, and a gateway-timed-out create is recovered by lookup.
  if (signal.aborted) throwAbort()
  const box = await acquireSandbox(client, opts, {
    signal,
    ...(evidenceTracker === undefined
      ? {}
      : {
          onAcquire: (source: SandboxInstance) => evidenceTracker.register(source, spec.profile),
          beforeDelete: (source: SandboxInstance) => evidenceTracker.destroy(source),
        }),
  })
  evidenceTracker?.register(box, spec.profile)
  try {
    await invokePrepareBox(spec, box, signal, recordMount)
  } catch (error) {
    if (evidenceTracker === undefined) await deleteBoxSafe(box)
    else await evidenceTracker.destroy(box)
    throw error
  }
  return box
}

/**
 * Invoke a spec's `prepareBox` with a complete ctx. `recordMount` is the run's
 * provenance recorder when one is threaded down; absent, a no-op stands in so
 * the ctx shape is always satisfied and a caller that records mounts on a path
 * with no manifest (e.g. the `AgentRuntime.act` bridge) silently drops nothing
 * it cares about — it simply has nowhere to surface a manifest.
 */
async function invokePrepareBox<Task>(
  spec: AgentRunSpec<Task>,
  box: SandboxInstance,
  signal: AbortSignal,
  recordMount?: MountRecorder,
): Promise<void> {
  if (!spec.prepareBox) return
  await spec.prepareBox(box, { signal, recordMount: recordMount ?? noopMountRecorder })
}

/** Shared no-op recorder for box-preparation paths that have no run manifest. */
const noopMountRecorder: MountRecorder = () => {}
