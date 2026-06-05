/**
 * @experimental
 *
 * `runLoop` — the topology-agnostic kernel built atop the sandbox SDK.
 *
 * Each iteration:
 *   1. `driver.plan(task, history)` → N tasks (1 = refine, N = fanout, 0 = stop)
 *   2. For each task (parallel, bounded by `maxConcurrency`):
 *        a. round-robin an `AgentRunSpec` from `agentRuns`
 *        b. `sandboxClient.create({ backend: { profile }, ...overrides })`
 *        c. emit `loop.iteration.dispatch` with the placement
 *           (`{ sibling, sandboxId }` or `{ fleet, fleetId, machineId, sandboxId }`)
 *        d. iterate `box.streamPrompt(taskToPrompt(task))` and collect events
 *   3. `output.parse(events)` → typed `Output`
 *   4. `validator?.validate(output)` → `DefaultVerdict`
 *   5. Append `Iteration` to history; emit `loop.iteration.ended`
 *   6. `driver.decide(history)` → if terminal, return result + winner
 *
 * The kernel owns: iteration accounting, per-iteration timing, error
 * capture, abort propagation, concurrency cap, cost aggregation, and trace
 * emission. The kernel does NOT own: what the agent runs (sandbox SDK +
 * profile), how outputs are decoded (output adapter), how outputs are
 * scored (validator), or topology (driver).
 */

import type { SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { ValidationError } from '../errors'
import { notifyRuntimeHookEvent } from '../runtime-hooks'
import { acquireSandbox } from './sandbox-acquire'
import { buildBackendOptions } from './sandbox-backend'
import { probeSandboxCapabilities } from './sandbox-capabilities'
import { extractLlmCallEvent } from './sandbox-events'
import {
  createSandboxLineage,
  type SandboxLineage,
  type SandboxLineageHandle,
} from './sandbox-lineage'
import type {
  AgentRunSpec,
  Driver,
  ExecCtx,
  Iteration,
  LoopLineageOptions,
  LoopResult,
  LoopSandboxClient,
  LoopSandboxPlacement,
  LoopTokenUsage,
  LoopTraceEmitter,
  LoopTraceEvent,
  LoopWinner,
  OutputAdapter,
  Validator,
} from './types'
import {
  addTokenUsage,
  deleteBoxSafe,
  randomSuffix,
  stringifySafe,
  throwAbort,
  withTimeout,
  zeroTokenUsage,
} from './util'

const DEFAULT_MAX_ITERATIONS = 10
const DEFAULT_MAX_CONCURRENCY = 4

/** @experimental */
export interface RunLoopOptions<Task, Output, Decision> {
  driver: Driver<Task, Output, Decision>
  /**
   * Single agent spec — every iteration uses this profile. Mutually
   * exclusive with `agentRuns`.
   */
  agentRun?: AgentRunSpec<Task>
  /**
   * Multiple specs for heterogeneous fanout. The kernel round-robins
   * through them when the driver plans N tasks. Mutually exclusive with
   * `agentRun`.
   */
  agentRuns?: AgentRunSpec<Task>[]
  output: OutputAdapter<Output>
  validator?: Validator<Output>
  task: Task
  ctx: ExecCtx
  /** Default 10. Hard cap on total iterations across all `plan()` rounds. */
  maxIterations?: number
  /** Default 4. In-flight worker cap within a single `plan()` batch. */
  maxConcurrency?: number
  /**
   * Pre-allocated id for trace correlation. Default = `loop-${random}`.
   * Surfaces as `runId` on every emitted `LoopTraceEvent`.
   */
  runId?: string
  /**
   * Clock override; default `Date.now`. Deterministic tests pass a
   * monotonic counter to stabilize iteration timing fields.
   */
  now?: () => number
  /**
   * Override the default winner selector (highest-valid-score, ties broken
   * by earliest iteration).
   */
  selectWinner?: (iterations: Iteration<Task, Output>[]) => LoopWinner<Task, Output> | undefined
  /**
   * Same-sandbox driver mode — a kernel→caller out-channel, not a value handed
   * in. When set, the kernel keeps each finished worker box alive across the
   * `plan()` boundary and hands it here, so a same-sandbox planner
   * (`createSandboxPlanner` with `reuseBox`) can stream its move INTO the
   * worker's live box — steering from the worker's real filesystem and state,
   * not just a history summary. The kernel owns teardown: every box kept alive
   * this way is destroyed at loop end (and the callback is invoked with
   * `undefined` then as a teardown sentinel). Without it, worker boxes are torn
   * down per-iteration (default) and a same-sandbox planner has nothing to
   * reuse. Intended for single-worker (refine) loops: under fanout every box is
   * still kept for teardown, but only the last-finishing box is handed here, so
   * a planner sees an arbitrary branch's filesystem — pair it with refine.
   */
  onWorkerBox?: (box: SandboxInstance | undefined) => void
  /**
   * Opt-in box-lineage controls. Default OFF — unset means every iteration
   * acquires a fresh box, streams once, and tears it down (today's behavior,
   * byte-identical). With `sessionContinuity` on, a refine round continues the
   * parent iteration's session on its live box; with `forkFanout` on (and a
   * fork-capable platform), a fanout round forks the parent's checkpoint so the
   * branches share a context prefix. The lineage owns every box it starts or
   * forks and tears them all down at loop end — so these paths are mutually
   * exclusive with `onWorkerBox`, which claims the same box-ownership channel.
   * @experimental
   */
  lineage?: LoopLineageOptions
}

/** @experimental */
export async function runLoop<Task, Output, Decision>(
  options: RunLoopOptions<Task, Output, Decision>,
): Promise<LoopResult<Task, Output, Decision>> {
  const specs = resolveAgentRuns(options)
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS
  if (!Number.isFinite(maxIterations) || maxIterations <= 0) {
    throw new ValidationError('runLoop: maxIterations must be > 0')
  }
  const maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY
  if (!Number.isFinite(maxConcurrency) || maxConcurrency <= 0) {
    throw new ValidationError('runLoop: maxConcurrency must be > 0')
  }
  if (!options.ctx?.sandboxClient || typeof options.ctx.sandboxClient.create !== 'function') {
    throw new ValidationError('runLoop: ctx.sandboxClient.create is required')
  }
  const now = options.now ?? Date.now
  const runId = options.runId ?? `loop-${randomSuffix()}`
  const loopStart = now()
  const driverName = options.driver.name ?? 'driver'
  const iterations: Iteration<Task, Output>[] = []
  let round = 0
  // Same-sandbox mode: worker boxes are kept alive (not torn down per-iteration)
  // so the planner can stream into the latest; the kernel destroys them at loop end.
  const ownedBoxes: SandboxInstance[] = []
  const collectBox = options.onWorkerBox
    ? (box: SandboxInstance) => {
        ownedBoxes.push(box)
        options.onWorkerBox?.(box)
      }
    : undefined

  // Opt-in box lineage: when either flag is set, a backend-blind lineage owns
  // box+session handles so a refine continues the parent session and a fanout
  // forks the parent checkpoint. Both flags off ⇒ lineage stays undefined and
  // the per-iteration acquire/stream/teardown path is byte-identical to today.
  const lineageState = await setUpLineage(options, maxConcurrency)

  emitRunLoopHook(options, {
    target: 'agent.run',
    phase: 'before',
    runId,
    timestamp: now(),
    payload: {
      driver: driverName,
      agentRunNames: specs.map((spec) => spec.name ?? spec.profile.name ?? 'agent'),
      maxIterations,
      maxConcurrency,
    },
  })

  await emitTrace(options.ctx.traceEmitter, {
    kind: 'loop.started',
    runId,
    timestamp: now(),
    payload: {
      driver: driverName,
      agentRunNames: specs.map((spec) => spec.name ?? spec.profile.name ?? 'agent'),
      maxIterations,
      maxConcurrency,
    },
  })

  const controller = new AbortController()
  const onOuterAbort = () => controller.abort()
  if (options.ctx.signal) {
    if (options.ctx.signal.aborted) controller.abort()
    else options.ctx.signal.addEventListener('abort', onOuterAbort, { once: true })
  }

  try {
    while (iterations.length < maxIterations) {
      if (controller.signal.aborted) throwAbort()
      emitRunLoopHook(options, {
        target: 'agent.plan',
        phase: 'before',
        runId,
        timestamp: now(),
        stepIndex: round,
        payload: { roundIndex: round, historyLength: iterations.length },
      })
      const planned = await options.driver.plan(options.task, iterations)
      // plan() may be a long LLM call (sandbox planner); an abort during it must
      // not launch a fresh batch of workers on an already-cancelled loop.
      if (controller.signal.aborted) throwAbort()
      const planDesc = options.driver.describePlan?.()
      const roundIndex = round
      const baseIndex = iterations.length
      const remaining = maxIterations - iterations.length
      const slice = planned.slice(0, remaining)
      // Edge lineage: a driver may DECLARE the branch source (planner-authored
      // topology); otherwise the kernel infers it — round 0 branches from root
      // (undefined), later rounds from the best-valid (else latest) iteration so
      // far. Either way it's emitted, not guessed by the viewer.
      const parentIndex =
        planDesc?.parentIndex ?? (roundIndex === 0 ? undefined : branchPoint(iterations))
      const childIndices = slice.map((_, i) => baseIndex + i)
      const moveKind =
        planDesc?.kind ??
        (planned.length === 0 ? 'stop' : planned.length === 1 ? 'refine' : 'fanout')
      emitRunLoopHook(options, {
        target: 'agent.plan',
        phase: 'after',
        runId,
        timestamp: now(),
        stepIndex: roundIndex,
        payload: {
          roundIndex,
          plannedCount: planned.length,
          moveKind,
          parentIndex,
          childIndices,
        },
      })
      await emitTrace(options.ctx.traceEmitter, {
        kind: 'loop.plan',
        runId,
        timestamp: now(),
        payload: {
          roundIndex,
          plannedCount: planned.length,
          moveKind,
          rationale: planDesc?.rationale,
          parentIndex,
          childIndices,
        },
      })
      round += 1
      if (planned.length === 0) break

      // Reserve slots up front so concurrent workers may mutate by index.
      for (let i = 0; i < slice.length; i += 1) {
        const spec = specs[(baseIndex + i) % specs.length]!
        iterations.push({
          index: baseIndex + i,
          task: slice[i] as Task,
          agentRunName: spec.name ?? spec.profile.name ?? 'agent',
          events: [],
          startedAt: now(),
          endedAt: 0,
          costUsd: 0,
          tokenUsage: zeroTokenUsage(),
        })
      }

      // Decide how this round acquires its sandbox streams. Without lineage it's
      // a fresh box per iteration (today's path). With lineage it may continue
      // the parent session (refine) or fork the parent checkpoint (fanout).
      const lineagePlan = lineageState
        ? planLineageRound(lineageState, specs, slice, parentIndex, controller.signal)
        : undefined

      await runBatch({
        slice,
        baseIndex,
        iterations,
        specs,
        output: options.output,
        validator: options.validator,
        maxConcurrency,
        signal: controller.signal,
        ctx: options.ctx,
        runId,
        now,
        roundIndex,
        parentIndex,
        collectBox,
        lineagePlan,
        lineageState,
      })

      if (controller.signal.aborted) throwAbort()

      emitRunLoopHook(options, {
        target: 'agent.decision',
        phase: 'before',
        runId,
        timestamp: now(),
        stepIndex: roundIndex,
        payload: { historyLength: iterations.length },
      })
      const decision = await options.driver.decide(iterations)
      emitRunLoopHook(options, {
        target: 'agent.decision',
        phase: 'after',
        runId,
        timestamp: now(),
        stepIndex: roundIndex,
        payload: { decision: stringifySafe(decision), historyLength: iterations.length },
      })
      await emitTrace(options.ctx.traceEmitter, {
        kind: 'loop.decision',
        runId,
        timestamp: now(),
        payload: { decision: stringifySafe(decision), historyLength: iterations.length },
      })
      // Terminal decision ends the loop; a non-terminal one falls through to the
      // next plan() round, so this must return rather than continue.
      if (isTerminalDecision(decision)) {
        return await finalizeAndEmitEnded(options, decision, iterations, loopStart, now, runId)
      }
      // The loop continues: free any lineage boxes no future round can descend
      // from, so the live-box set tracks the active frontier instead of growing
      // with every round. No-op unless pruning is provably safe (see canPrune).
      if (lineageState) await pruneLineage(lineageState, iterations)
    }

    // Either the cap was reached without a terminal decision, or plan() returned
    // [] first — both ask the driver for its final state and close out identically.
    return await decideAndFinalize(options, iterations, loopStart, now, runId)
  } finally {
    if (options.ctx.signal) options.ctx.signal.removeEventListener('abort', onOuterAbort)
    // Same-sandbox mode kept worker boxes alive across plan() so the planner could
    // stream into them — the kernel owns their teardown. Destroy in parallel so a
    // large fanout's deletes don't serialize, and bound each so a hung platform
    // delete cannot wedge loop return after the caller aborted.
    await Promise.allSettled(
      ownedBoxes.map((b) => destroySandboxSafe(b, options.ctx.traceEmitter, runId, now)),
    )
    if (options.onWorkerBox) options.onWorkerBox(undefined)
    // The lineage owns every box it started or forked across all rounds; it tears
    // them down at loop end (kept alive between rounds so a later round can
    // continue/fork them).
    if (lineageState) await lineageState.lineage.teardown()
  }
}

/**
 * Per-loop lineage state: the backend-blind lineage, the caller's opt-in flags,
 * and the live handle for each completed iteration so a later round can continue
 * or fork from it. `undefined` ⇒ no lineage; the kernel uses the fresh-box path.
 */
interface LineageState {
  lineage: SandboxLineage
  options: LoopLineageOptions
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
 * Build the lineage when either lineage flag is set. Probes the platform's fork
 * capability once per run (the lineage degrades gracefully when it's absent).
 * Rejects the lineage + `onWorkerBox` combination: both claim the same
 * box-ownership channel, and silently honoring one would leak or double-free.
 */
async function setUpLineage<Task, Output, Decision>(
  options: RunLoopOptions<Task, Output, Decision>,
  maxConcurrency: number,
): Promise<LineageState | undefined> {
  const lineageOpts = options.lineage
  if (!lineageOpts || (!lineageOpts.sessionContinuity && !lineageOpts.forkFanout)) return undefined
  if (options.onWorkerBox) {
    throw new ValidationError(
      'runLoop: `lineage` and `onWorkerBox` both own worker boxes — pass only one',
    )
  }
  const capabilities = await probeSandboxCapabilities(options.ctx.sandboxClient)
  return {
    lineage: createSandboxLineage(options.ctx.sandboxClient, capabilities, { maxConcurrency }),
    options: lineageOpts,
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
  acquire(): Promise<{ events: AsyncIterable<SandboxEvent>; handle: SandboxLineageHandle }>
}

/** The per-round lineage plan: a stream source per slice offset, or `undefined`
 *  for offsets with no lineage source (defensive — never expected). */
type LineageRoundPlan = (LineageStreamSource | undefined)[]

/**
 * Decide, for one round, how each iteration acquires its sandbox stream:
 *   - refine (1 task) + `sessionContinuity` + a live parent handle ⇒ continue
 *     the parent session on its box.
 *   - fanout (N tasks) + `forkFanout` + a live parent handle ⇒ fork the parent
 *     checkpoint once and stream each branch from a child box (degrades to fresh
 *     boxes inside the lineage when the platform can't fork).
 *   - otherwise (round 0, no parent, the off flag) ⇒ start a fresh box per
 *     iteration THROUGH the lineage so it's owned + a handle is recorded for a
 *     later round to descend from.
 * Round 0 (parentIndex undefined) always starts fresh — the independence of the
 * first batch is preserved.
 */
function planLineageRound<Task>(
  state: LineageState,
  specs: AgentRunSpec<Task>[],
  slice: Task[],
  parentIndex: number | undefined,
  signal: AbortSignal,
): LineageRoundPlan {
  const lineage = state.lineage
  const parent = parentIndex !== undefined ? state.handles.get(parentIndex) : undefined
  const promptFor = (offset: number): string => {
    const spec = specs[offset % specs.length]
    if (!spec) throw new ValidationError('runLoop: no AgentRunSpec available for lineage iteration')
    return spec.taskToPrompt(slice[offset] as Task)
  }
  const specAt = (offset: number): AgentRunSpec<unknown> => {
    const spec = specs[offset % specs.length]
    if (!spec) throw new ValidationError('runLoop: no AgentRunSpec available for lineage iteration')
    return spec as AgentRunSpec<unknown>
  }

  // Continue the parent session: a single-task round descending from a live
  // handle, with the flag on. Reuses the parent's box + session id.
  if (slice.length === 1 && parent && state.options.sessionContinuity) {
    return [
      {
        async acquire() {
          const events = await lineage.continue(parent, promptFor(0), signal)
          // Continuation threads the SAME handle forward — later rounds keep
          // descending from this box's evolving session.
          return { events, handle: parent }
        },
      },
    ]
  }

  // Fork the parent checkpoint: a multi-task round descending from a live handle,
  // with the flag on. One checkpoint, N child streams — lazily awaited once and
  // shared across the offsets so the batch checkpoints exactly once.
  if (slice.length > 1 && parent && state.options.forkFanout) {
    const prompts = slice.map((_, offset) => promptFor(offset))
    const childSpecs = slice.map((_, offset) => specAt(offset))
    let forked: Promise<{ handle: SandboxLineageHandle; events: AsyncIterable<SandboxEvent> }[]>
    const ensureForked = () => {
      forked ??= lineage.fork(parent, prompts, childSpecs, signal)
      return forked
    }
    return slice.map((_, offset) => ({
      async acquire() {
        const branches = await ensureForked()
        const branch = branches[offset]
        if (!branch)
          throw new ValidationError('runLoop: lineage fork produced no branch for offset')
        return branch
      },
    }))
  }

  // Fresh through the lineage (round 0, no parent, or the relevant flag off):
  // start an owned box per iteration and record a handle for later descent.
  return slice.map((_, offset) => ({
    async acquire() {
      return lineage.start(specAt(offset), promptFor(offset), signal)
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
async function pruneLineage<Task, Output>(
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

interface RunBatchArgs<Task, Output> {
  slice: Task[]
  baseIndex: number
  iterations: Iteration<Task, Output>[]
  specs: AgentRunSpec<Task>[]
  output: OutputAdapter<Output>
  validator: Validator<Output> | undefined
  maxConcurrency: number
  signal: AbortSignal
  ctx: ExecCtx
  runId: string
  now: () => number
  /** Plan round these iterations belong to — stamped as `groupId`. */
  roundIndex: number
  /** Iteration this round branched from — stamped as `parentIndex`. */
  parentIndex?: number
  /**
   * Same-sandbox mode: when set, a finished iteration's box is handed here
   * (kept alive for the planner) instead of being torn down. `undefined` =
   * default per-iteration teardown.
   */
  collectBox?: (box: SandboxInstance) => void
  /**
   * Lineage mode: per-offset stream sources for this round. When set, an
   * iteration acquires its sandbox stream through the lineage (continue / fork /
   * fresh) instead of `createSandboxForSpec`, and the lineage — not the
   * iteration — owns box teardown (deferred to loop end).
   */
  lineagePlan?: LineageRoundPlan
  /** The loop's lineage state; iterations record their handle here for the next
   *  round to descend from. Set iff `lineagePlan` is. */
  lineageState?: LineageState
}

async function runBatch<Task, Output>(args: RunBatchArgs<Task, Output>) {
  const queue = args.slice.map((task, offset) => ({ task, index: args.baseIndex + offset }))
  const inflight = new Set<Promise<void>>()
  // Every started worker, so a rejecting iteration (abort short-circuit, or a
  // throwing trace emitter) cannot orphan its still-running siblings: we always
  // drain ALL of them before propagating the first error.
  const started: Promise<void>[] = []
  let firstError: unknown
  try {
    while (queue.length > 0 || inflight.size > 0) {
      while (inflight.size < args.maxConcurrency && queue.length > 0) {
        const item = queue.shift()!
        const p = executeIteration({ ...args, item }).finally(() => inflight.delete(p))
        started.push(p)
        inflight.add(p)
      }
      if (inflight.size === 0) break
      try {
        await Promise.race(inflight)
      } catch (err) {
        if (firstError === undefined) firstError = err
        // Stop scheduling new work; drain the rest in the finally below.
        queue.length = 0
        break
      }
    }
  } finally {
    const settled = await Promise.allSettled(started)
    if (firstError === undefined) {
      const rejected = settled.find((s) => s.status === 'rejected')
      if (rejected && rejected.status === 'rejected') firstError = rejected.reason
    }
  }
  if (firstError !== undefined) throw firstError
}

interface ExecuteIterationArgs<Task, Output> extends RunBatchArgs<Task, Output> {
  item: { task: Task; index: number }
}

async function executeIteration<Task, Output>(args: ExecuteIterationArgs<Task, Output>) {
  const slot = args.iterations[args.item.index]
  if (!slot)
    throw new ValidationError(`runLoop: missing iteration slot at index ${args.item.index}`)
  const spec = args.specs[args.item.index % args.specs.length]
  if (!spec) throw new ValidationError('runLoop: no AgentRunSpec available for iteration')
  slot.startedAt = args.now()
  slot.agentRunName = spec.name ?? spec.profile.name ?? 'agent'

  await emitTrace(args.ctx.traceEmitter, {
    kind: 'loop.iteration.started',
    runId: args.runId,
    timestamp: args.now(),
    payload: {
      iterationIndex: args.item.index,
      agentRunName: slot.agentRunName,
      taskHash: hashJson(args.item.task),
      groupId: args.roundIndex,
      parentIndex: args.parentIndex,
    },
  })

  let box: SandboxInstance | undefined
  // Lineage-owned boxes are torn down by the lineage at loop end, not here. The
  // flag tracks whether THIS iteration's box came from the lineage so the
  // teardown branch below skips it.
  let lineageOwned = false
  try {
    // Stream source: the lineage (continue / fork / fresh) when this round runs
    // under lineage, else a fresh box + a single `streamPrompt` (today's path,
    // byte-identical when no lineage). The lineage path supplies a session id on
    // the stream; the fresh path passes none — preserving N-independent-boxes.
    let stream: AsyncIterable<SandboxEvent>
    const source = args.lineagePlan?.[args.item.index - args.baseIndex]
    if (source) {
      const acquired = await source.acquire()
      box = acquired.handle.box
      lineageOwned = true
      args.lineageState?.handles.set(args.item.index, acquired.handle)
      stream = acquired.events
    } else {
      box = await createSandboxForSpec(args.ctx.sandboxClient, spec, args.signal)
      stream = box.streamPrompt(spec.taskToPrompt(args.item.task), { signal: args.signal })
    }
    const placement = describeSandboxPlacement(args.ctx.sandboxClient, box)
    await emitTrace(args.ctx.traceEmitter, {
      kind: 'loop.iteration.dispatch',
      runId: args.runId,
      timestamp: args.now(),
      payload: {
        iterationIndex: args.item.index,
        agentRunName: slot.agentRunName,
        placement: placement.kind,
        sandboxId: placement.sandboxId,
        fleetId: placement.fleetId,
        machineId: placement.machineId,
        groupId: args.roundIndex,
        parentIndex: args.parentIndex,
      },
    })
    const events: SandboxEvent[] = []
    for await (const event of stream) {
      events.push(event)
      const llmCall = extractLlmCallEvent(event, slot.agentRunName)
      if (llmCall) {
        slot.costUsd += llmCall.costUsd ?? 0
        addTokenUsage(slot.tokenUsage, { input: llmCall.tokensIn, output: llmCall.tokensOut })
        args.ctx.runHandle?.observe(llmCall)
      }
    }
    slot.events = events
    slot.output = args.output.parse(events)
    if (args.validator) {
      slot.verdict = await args.validator.validate(slot.output, {
        iteration: args.item.index,
        signal: args.signal,
        traceEmitter: args.ctx.traceEmitter,
      })
    }
  } catch (err) {
    slot.error = err instanceof Error ? err : new Error(String(err))
  } finally {
    slot.endedAt = args.now()
    await emitTrace(args.ctx.traceEmitter, {
      kind: 'loop.iteration.ended',
      runId: args.runId,
      timestamp: args.now(),
      payload: {
        iterationIndex: args.item.index,
        agentRunName: slot.agentRunName,
        outputHash: slot.output !== undefined ? hashJson(slot.output) : undefined,
        verdict: slot.verdict,
        error: slot.error?.message,
        costUsd: slot.costUsd,
        durationMs: slot.endedAt - slot.startedAt,
        tokenUsage:
          slot.tokenUsage.input || slot.tokenUsage.output ? { ...slot.tokenUsage } : undefined,
        groupId: args.roundIndex,
        parentIndex: args.parentIndex,
        outputPreview:
          slot.output !== undefined ? stringifySafe(slot.output, { max: 280 }) : undefined,
      },
    })
    // The loop owns the per-shot box lifecycle. Default: tear it down now so
    // sandboxes don't leak. Same-sandbox mode: hand it to the kernel to keep
    // alive for the planner. Lineage mode: the lineage owns the box and keeps it
    // alive across rounds (a later round may continue/fork it), tearing it down
    // at loop end — so skip per-iteration teardown here.
    if (lineageOwned) {
      // no-op: lineage.teardown() reaps this box at loop end
    } else if (args.collectBox && box) {
      args.collectBox(box)
    } else {
      await destroySandboxSafe(box, args.ctx.traceEmitter, args.runId, args.now)
    }
  }
  // An abort caught above is NOT a soft per-iteration failure — it must
  // short-circuit the batch, not degrade to a recorded empty iteration. The
  // trace was already emitted in the finally, so re-throw it now.
  if (isAbortError(slot.error) || args.signal.aborted) {
    if (slot.error) throw slot.error
    throwAbort()
  }
  // A structural lineage error (a dropped session, a fork-capability contract
  // violation, a missing spec) is likewise not a soft worker failure: it
  // invalidates the run's continuity/branching guarantee, so propagate it
  // instead of degrading to a recorded empty iteration the driver might ignore.
  if (slot.error instanceof ValidationError) throw slot.error
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

const TEARDOWN_TIMEOUT_MS = 15_000

/**
 * Best-effort sandbox teardown. A failed delete must never surface as a loop
 * error, and instances without a `delete` (the loop's test fakes) are skipped.
 * A delete that throws or hangs (bounded by `TEARDOWN_TIMEOUT_MS`) is recorded
 * as a `loop.teardown.failed` trace so a silently-leaking box is observable —
 * distinct from a fake with no `delete`, which is expected and stays silent.
 */
async function destroySandboxSafe(
  box: SandboxInstance | undefined,
  trace?: LoopTraceEmitter,
  runId?: string,
  now?: () => number,
): Promise<void> {
  if (!box || typeof (box as { delete?: unknown }).delete !== 'function') return
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
}

/**
 * Branch point for a new round — the iteration a later round descends from.
 * Highest-valid-score iteration so far; ties + no-valid fall back to the latest
 * index. Inferred (not driver-declared), so refine renders as a chain and
 * fanout→refine chains off the fanout winner.
 */
function branchPoint<Task, Output>(
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

export function describeSandboxPlacement(
  client: LoopSandboxClient,
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
 */
export async function createSandboxForSpec<Task>(
  client: LoopSandboxClient,
  spec: AgentRunSpec<Task>,
  signal: AbortSignal,
): Promise<SandboxInstance> {
  const opts = buildBackendOptions(spec.profile, spec.sandboxOverrides)
  // Cold-start-resilient acquire: a slow scale-from-zero create (node boot +
  // host-agent registration) can't surface as a failure — readiness is observed
  // from sandbox status, and a gateway-timed-out create is recovered by lookup.
  if (signal.aborted) throwAbort()
  return acquireSandbox(client, opts, { signal })
}

interface FinalizeArgs<Task, Output, Decision> {
  options: RunLoopOptions<Task, Output, Decision>
  decision: Decision
  iterations: Iteration<Task, Output>[]
  startMs: number
  now: () => number
  runId: string
}

function finalize<Task, Output, Decision>(
  args: FinalizeArgs<Task, Output, Decision>,
): LoopResult<Task, Output, Decision> {
  // Precedence: an explicit caller `selectWinner` wins; else a driver-AUTHORED
  // winner (a `select` topology move); else the default argmax. A driver that
  // declares nothing returns undefined and falls through — existing behavior.
  const winner = args.options.selectWinner
    ? args.options.selectWinner(args.iterations)
    : (args.options.driver.selectWinner?.(args.iterations) ?? defaultSelectWinner(args.iterations))
  const costUsd = args.iterations.reduce((sum, iter) => sum + (iter.costUsd || 0), 0)
  const tokenUsage = args.iterations.reduce((acc: LoopTokenUsage, iter) => {
    addTokenUsage(acc, iter.tokenUsage)
    return acc
  }, zeroTokenUsage())
  const result: LoopResult<Task, Output, Decision> = {
    decision: args.decision,
    iterations: args.iterations,
    winner,
    durationMs: args.now() - args.startMs,
    costUsd,
    tokenUsage,
  }
  return result
}

/**
 * Run `decide`, emit the `loop.decision` trace, then finalize and emit
 * `loop.ended`. The two post-while exits (cap reached / `plan()` returned `[]`)
 * share this exact sequence.
 */
async function decideAndFinalize<Task, Output, Decision>(
  options: RunLoopOptions<Task, Output, Decision>,
  iterations: Iteration<Task, Output>[],
  startMs: number,
  now: () => number,
  runId: string,
): Promise<LoopResult<Task, Output, Decision>> {
  emitRunLoopHook(options, {
    target: 'agent.decision',
    phase: 'before',
    runId,
    timestamp: now(),
    payload: { historyLength: iterations.length },
  })
  const decision = await options.driver.decide(iterations)
  emitRunLoopHook(options, {
    target: 'agent.decision',
    phase: 'after',
    runId,
    timestamp: now(),
    payload: { decision: stringifySafe(decision), historyLength: iterations.length },
  })
  await emitTrace(options.ctx.traceEmitter, {
    kind: 'loop.decision',
    runId,
    timestamp: now(),
    payload: { decision: stringifySafe(decision), historyLength: iterations.length },
  })
  return finalizeAndEmitEnded(options, decision, iterations, startMs, now, runId)
}

/** Finalize the loop and emit the terminal `loop.ended` span. Used by the
 *  in-loop terminal path (decision trace already emitted) and decideAndFinalize. */
async function finalizeAndEmitEnded<Task, Output, Decision>(
  options: RunLoopOptions<Task, Output, Decision>,
  decision: Decision,
  iterations: Iteration<Task, Output>[],
  startMs: number,
  now: () => number,
  runId: string,
): Promise<LoopResult<Task, Output, Decision>> {
  const result = finalize({ options, decision, iterations, startMs, now, runId })
  emitRunLoopHook(options, {
    target: 'agent.run',
    phase: 'after',
    runId,
    timestamp: now(),
    payload: {
      decision: stringifySafe(decision),
      winnerIterationIndex: result.winner?.iterationIndex,
      totalCostUsd: result.costUsd,
      durationMs: result.durationMs,
      iterations: iterations.length,
    },
  })
  // Await the terminal span (unlike a fire-and-forget) so a process exiting
  // right after runLoop resolves (MCP subprocess / CLI dispatch) can't drop it.
  await emitTrace(options.ctx.traceEmitter, {
    kind: 'loop.ended',
    runId,
    timestamp: now(),
    payload: {
      winnerIterationIndex: result.winner?.iterationIndex,
      totalCostUsd: result.costUsd,
      durationMs: result.durationMs,
      iterations: iterations.length,
    },
  })
  return result
}

/**
 * The kernel's winner argmax — best-valid-score, ties broken by earliest index,
 * falling back to the best-scoring non-errored output when none is valid. Exported
 * so the `runProgram` tree executor selects across merged sub-loop iterations with
 * the SAME semantics the kernel uses at a single loop's finalize (one selector, not
 * a forked copy).
 */
export function defaultSelectWinner<Task, Output>(
  iterations: Iteration<Task, Output>[],
): LoopWinner<Task, Output> | undefined {
  const candidates = iterations.filter((iter) => iter.output !== undefined && !iter.error)
  if (candidates.length === 0) return undefined
  const valid = candidates.filter((iter) => iter.verdict?.valid === true)
  const pool = valid.length > 0 ? valid : candidates
  const sorted = [...pool].sort(
    (a, b) => (b.verdict?.score ?? 0) - (a.verdict?.score ?? 0) || a.index - b.index,
  )
  const top = sorted[0]
  if (!top || top.output === undefined) return undefined
  return {
    task: top.task,
    output: top.output,
    verdict: top.verdict,
    iterationIndex: top.index,
    agentRunName: top.agentRunName,
  }
}

function resolveAgentRuns<Task, Output, Decision>(
  options: RunLoopOptions<Task, Output, Decision>,
): AgentRunSpec<Task>[] {
  if (options.agentRun && options.agentRuns) {
    throw new ValidationError('runLoop: pass exactly one of `agentRun` or `agentRuns`')
  }
  if (options.agentRun) return [options.agentRun]
  if (options.agentRuns && options.agentRuns.length > 0) return options.agentRuns
  throw new ValidationError('runLoop: `agentRun` or non-empty `agentRuns` is required')
}

function isTerminalDecision(decision: unknown): boolean {
  return (
    decision === 'stop' || decision === 'pick-winner' || decision === 'fail' || decision === 'done'
  )
}

function emitRunLoopHook<Task, Output, Decision>(
  options: RunLoopOptions<Task, Output, Decision>,
  event: {
    target: 'agent.run' | 'agent.plan' | 'agent.decision'
    phase: 'before' | 'after' | 'error' | 'event'
    runId: string
    timestamp: number
    stepIndex?: number
    payload?: Record<string, unknown>
  },
): void {
  notifyRuntimeHookEvent(
    options.ctx.hooks,
    {
      id: `${event.runId}:${event.target}:${event.phase}${
        event.stepIndex === undefined ? '' : `:${event.stepIndex}`
      }`,
      runId: event.runId,
      target: event.target,
      phase: event.phase,
      timestamp: event.timestamp,
      stepIndex: event.stepIndex,
      payload: event.payload,
      metadata: { producer: 'run-loop' },
    },
    { signal: options.ctx.signal },
  )
}

async function emitTrace(
  emitter: LoopTraceEmitter | undefined,
  event: LoopTraceEvent,
): Promise<void> {
  if (!emitter) return
  await emitter.emit(event)
}

/**
 * Stable hash for the trace payload. Not cryptographic — only used so
 * downstream eval pipelines can group iterations whose task / output is the
 * same. Bare structural hash; non-JSON values stringify via their `toString`.
 */
function hashJson(value: unknown): string {
  let str: string
  try {
    str = JSON.stringify(value) ?? String(value)
  } catch {
    str = String(value)
  }
  // FNV-1a 32-bit — branch-free, dependency-free, good enough for grouping.
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
