/**
 *
 * `runAgentRounds` drives provider-neutral agent environments.
 *
 * Each iteration:
 *   1. `driver.plan(task, history)` → N tasks (1 = refine, N = fanout, 0 = stop)
 *   2. For each task (parallel, bounded by `maxConcurrency`):
 *        a. round-robin an `AgentRunSpec` from `agentRuns`
 *        b. `environmentProvider.create({ profile, ...environment })`
 *        c. emit `loop.iteration.dispatch` with provider placement
 *        d. iterate `environment.stream({ prompt })` and collect events
 *   3. `output.parse(events)` → typed `Output`
 *   4. `validator?.validate(output)` → `DefaultVerdict`
 *   5. Append `Iteration` to history; emit `loop.iteration.ended`
 *   6. `driver.decide(history)` → if terminal, return result + winner
 *
 * The kernel owns: iteration accounting, per-iteration timing, error
 * capture, abort propagation, concurrency cap, cost aggregation, and trace
 * emission. The provider owns execution; the output adapter owns decoding;
 * the validator owns scoring; the driver owns the round policy.
 *
 * @experimental
 */

import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  PlacementInfo,
} from '@tangle-network/agent-interface/environment-provider'
import { ValidationError } from '../errors'
import { notifyRuntimeHookEvent } from '../runtime-hooks'
import { createEnvironmentForSpec } from './environment-create'
import { extractLlmCallEvent, notifyAgentEnvironmentEventObserver } from './environment-events'
import {
  createEnvironmentLineage,
  type EnvironmentLineage,
  type EnvironmentLineageHandle,
  turnEvents,
} from './environment-lineage'
import type {
  AgentRunSpec,
  Driver,
  ExecCtx,
  Iteration,
  LoopLineageOptions,
  LoopResult,
  LoopTokenUsage,
  LoopTraceEmitter,
  LoopTraceEvent,
  LoopWinner,
  MountManifestEntry,
  MountRecorder,
  OutputAdapter,
  SelectionReceipt,
  Validator,
} from './types'
import {
  addTokenUsage,
  destroyEnvironmentSafe,
  randomSuffix,
  stringifySafe,
  throwAbort,
  withTimeout,
  zeroTokenUsage,
} from './util'

const DEFAULT_MAX_ITERATIONS = 10
const DEFAULT_MAX_CONCURRENCY = 4

/** @experimental */
export interface RunAgentRoundsOptions<Task, Output, Decision> {
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
  /** Keep completed workers alive for a driver that runs in their environment. */
  onWorkerEnvironment?: (environment: AgentEnvironment | undefined) => void
  /**
   * Opt-in environment lineage. With `sessionContinuity`, a refine round
   * continues the parent session; with `forkFanout` on (and a
   * fork-capable platform), a fanout round forks the parent's checkpoint so the
   * branches share a context prefix. The lineage owns every environment it
   * creates and destroys them at loop end.
   * @experimental
   */
  lineage?: LoopLineageOptions
}

/**
 * The round-synchronous MULTI-AGENT kernel: each round `driver.plan()` fans N tasks
 * out to N environments (bounded concurrency), parses + validates each output, and folds
 * the round's results through `driver.decide` — fanout → validate → vote/select →
 * refine, repeated until the driver says stop. One call spans many agent sessions.
 *
 * Not to be confused with `runToolLoop` / `streamToolLoop` (package root entry): those
 * run ONE chat turn against ONE model, dispatching the tool calls that turn emits and
 * folding the results back in until the model stops calling tools. No environments, no
 * rounds, no winner selection.
 *
 * @experimental
 */
export async function runAgentRounds<Task, Output, Decision>(
  options: RunAgentRoundsOptions<Task, Output, Decision>,
): Promise<LoopResult<Task, Output, Decision>> {
  const specs = resolveAgentRuns(options)
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS
  if (!Number.isFinite(maxIterations) || maxIterations <= 0) {
    throw new ValidationError('runAgentRounds: maxIterations must be > 0')
  }
  const maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY
  if (!Number.isFinite(maxConcurrency) || maxConcurrency <= 0) {
    throw new ValidationError('runAgentRounds: maxConcurrency must be > 0')
  }
  const environmentStreaming = options.lineage?.streaming ?? 'sse'
  if (
    !options.ctx?.environmentProvider ||
    typeof options.ctx.environmentProvider.create !== 'function'
  ) {
    throw new ValidationError('runAgentRounds: ctx.environmentProvider.create is required')
  }
  const now = options.now ?? Date.now
  const runId = options.runId ?? `loop-${randomSuffix()}`
  const loopStart = now()
  const driverName = options.driver.name ?? 'driver'
  const iterations: Iteration<Task, Output>[] = []
  // The caller records mounted resources during environment preparation.
  const mounts: MountManifestEntry[] = []
  const recordMount: MountRecorder = (entry) => {
    mounts.push(entry)
  }
  let round = 0
  const ownedEnvironments: AgentEnvironment[] = []
  const collectEnvironment = options.onWorkerEnvironment
    ? (environment: AgentEnvironment) => {
        ownedEnvironments.push(environment)
        options.onWorkerEnvironment?.(environment)
      }
    : undefined

  const lineageState = await setUpLineage(options, maxConcurrency, recordMount)

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

      // Decide how this round acquires its environment streams. Without lineage
      // it creates one environment per iteration. With lineage it may continue
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
        streaming: environmentStreaming,
        signal: controller.signal,
        ctx: options.ctx,
        runId,
        now,
        roundIndex,
        parentIndex,
        collectEnvironment,
        lineagePlan,
        lineageState,
        recordMount,
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
        return await finalizeAndEmitEnded(
          options,
          decision,
          iterations,
          loopStart,
          now,
          runId,
          mounts,
        )
      }
      // The loop continues: free any lineage environments no future round can
      // descend from, so the live set tracks the active frontier instead of growing
      // with every round. No-op unless pruning is provably safe (see canPrune).
      if (lineageState) await pruneLineage(lineageState, iterations)
    }

    // Either the cap was reached without a terminal decision, or plan() returned
    // [] first — both ask the driver for its final state and close out identically.
    return await decideAndFinalize(options, iterations, loopStart, now, runId, mounts)
  } finally {
    if (options.ctx.signal) options.ctx.signal.removeEventListener('abort', onOuterAbort)
    // A caller may retain completed worker environments across plan() calls.
    // The kernel still owns their teardown. Destroy them concurrently and bound
    // each operation so a stalled provider cannot block loop completion.
    await Promise.allSettled(
      ownedEnvironments.map((environment) =>
        destroyEnvironmentWithTrace(environment, options.ctx.traceEmitter, runId, now),
      ),
    )
    if (options.onWorkerEnvironment) options.onWorkerEnvironment(undefined)
    // The lineage owns every environment it started or forked across all rounds.
    // They stay alive between rounds so later work can continue or fork them.
    if (lineageState) await lineageState.lineage.teardown()
  }
}

/**
 * Per-loop lineage state: the backend-blind lineage, the caller's opt-in flags,
 * and the live handle for each completed iteration so a later round can continue
 * or fork from it. `undefined` ⇒ no lineage; the kernel uses the fresh-box path.
 */
interface LineageState {
  lineage: EnvironmentLineage
  options: LoopLineageOptions
  /** iteration index to its live environment and session handle. */
  handles: Map<number, EnvironmentLineageHandle>
  /**
   * Whether the kernel may free non-frontier boxes after each round. Safe only
   * when the driver never authors its own branch point (`describePlan` absent),
   * so the kernel-inferred `branchPoint` — which moves monotonically toward
   * higher-scoring iterations — is the only descent source. A driver that
   * declares `parentIndex` may descend from any prior iteration, so no environment can
   * be freed before loop end.
   */
  canPrune: boolean
}

/**
 * Build the lineage when either lineage flag is set. Probes the platform's fork
 * capability once per run (the lineage degrades gracefully when it's absent).
 * Rejects the lineage + `onWorkerEnvironment` combination: both claim the same
 * environment-ownership channel, and silently honoring one would leak or double-free.
 */
async function setUpLineage<Task, Output, Decision>(
  options: RunAgentRoundsOptions<Task, Output, Decision>,
  maxConcurrency: number,
  recordMount: MountRecorder,
): Promise<LineageState | undefined> {
  const lineageOpts = options.lineage
  if (!lineageOpts || (!lineageOpts.sessionContinuity && !lineageOpts.forkFanout)) return undefined
  if (options.onWorkerEnvironment) {
    throw new ValidationError(
      'runAgentRounds: `lineage` and `onWorkerEnvironment` both own worker environments; pass only one',
    )
  }
  const capabilities = await options.ctx.environmentProvider.capabilities()
  if (lineageOpts.sessionContinuity && !capabilities.sessions.continue) {
    throw new ValidationError(
      `runAgentRounds: provider "${options.ctx.environmentProvider.name}" does not support session continuation`,
    )
  }
  return {
    lineage: createEnvironmentLineage(options.ctx.environmentProvider, capabilities, {
      maxConcurrency,
      streaming: lineageOpts.streaming,
      recordMount,
    }),
    options: lineageOpts,
    handles: new Map(),
    canPrune: typeof options.driver.describePlan !== 'function',
  }
}

/**
 * One iteration's event source for a lineage round. The kernel awaits
 * `acquire()` inside the concurrency-bounded batch so forks, continuation, and
 * fresh creation all share the same concurrency and cancellation rules.
 */
interface LineageStreamSource {
  acquire(): Promise<{
    events: AsyncIterable<AgentEnvironmentEvent>
    handle: EnvironmentLineageHandle
  }>
}

/** The per-round lineage plan: a stream source per slice offset, or `undefined`
 *  for offsets with no lineage source (defensive — never expected). */
type LineageRoundPlan = (LineageStreamSource | undefined)[]

/**
 * Decide, for one round, how each iteration acquires its environment stream:
 *   - refine (1 task) + `sessionContinuity` + a live parent handle ⇒ continue
 *     the parent session in its environment.
 *   - fanout (N tasks) + `forkFanout` + a live parent handle ⇒ fork the parent
 *     checkpoint once and stream each branch from a child box (degrades to fresh
 *     environments inside the lineage when the provider cannot fork).
 *   - otherwise (round 0, no parent, the off flag) ⇒ start a fresh environment per
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
  // handle, with the flag on. Reuses the parent environment and session id.
  if (slice.length === 1 && parent && state.options.sessionContinuity) {
    return [
      {
        async acquire() {
          const events = await lineage.continue(parent, promptFor(0), signal)
          // Continuation threads the SAME handle forward — later rounds keep
          // descending from this environment's evolving session.
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
    let forked: Promise<
      { handle: EnvironmentLineageHandle; events: AsyncIterable<AgentEnvironmentEvent> }[]
    >
    const ensureForked = () => {
      forked ??= lineage.fork(parent, prompts, childSpecs, signal)
      return forked
    }
    return slice.map((_, offset) => ({
      async acquire() {
        const branches = await ensureForked()
        const branch = branches[offset]
        if (!branch)
          throw new ValidationError('runAgentRounds: lineage fork produced no branch for offset')
        return branch
      },
    }))
  }

  // Fresh through the lineage (round 0, no parent, or the relevant flag off):
  // start an owned environment per iteration and record a handle for later descent.
  return slice.map((_, offset) => ({
    async acquire() {
      return lineage.start(specAt(offset), promptFor(offset), signal)
    },
  }))
}

/**
 * After a round, free lineage environments no future round can descend from. The only
 * descent source for a kernel-inferred topology is `branchPoint`, which moves
 * monotonically toward higher-scoring iterations and never returns to one it has
 * passed — so every box except the current branch point's is unreachable and can
 * be torn down now instead of at loop end. Skipped entirely when the driver
 * authors its own branch point (`canPrune` false): it may descend from any prior
 * iteration. Also skipped when the branch point has no recorded handle because
 * acquisition failed; that conservative case keeps every environment.
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
  // Drop entries for environments destroyed by pruning.
  const stale: number[] = []
  for (const [index, handle] of state.handles) {
    if (handle.environment !== keep.environment) stale.push(index)
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
   * Retained-environment mode: when set, a finished iteration's environment is handed here
   * (kept alive for the planner) instead of being torn down. `undefined` =
   * default per-iteration teardown.
   */
  collectEnvironment?: (environment: AgentEnvironment) => void
  /**
   * Lineage mode: per-offset stream sources for this round. When set, an
   * iteration acquires its environment stream through the lineage (continue / fork /
   * fresh) instead of `createEnvironmentForSpec`, and the lineage — not the
   * iteration — owns environment teardown (deferred to loop end).
   */
  lineagePlan?: LineageRoundPlan
  /** The loop's lineage state; iterations record their handle here for the next
   *  round to descend from. Set iff `lineagePlan` is. */
  lineageState?: LineageState
  /** Streaming mode for the default fresh-environment path. 'poll' fire-and-
   *  detaches + status-polls the terminal result (drop-resilient for long batch
   *  turns); 'sse' streams live (default). */
  streaming: 'sse' | 'poll'
  /** The run's provenance recorder, forwarded to `prepareEnvironment` on the default
   *  fresh-environment path so a mount declares itself into the manifest. (The lineage
   *  path carries its own recorder from `createEnvironmentLineage`.) */
  recordMount: MountRecorder
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
    throw new ValidationError(`runAgentRounds: missing iteration slot at index ${args.item.index}`)
  const spec = args.specs[args.item.index % args.specs.length]
  if (!spec) throw new ValidationError('runAgentRounds: no AgentRunSpec available for iteration')
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

  let environment: AgentEnvironment | undefined
  // Lineage-owned environments are torn down by the lineage at loop end, not here. The
  // flag tracks whether this iteration's environment came from the lineage so the
  // teardown branch below skips it.
  let lineageOwned = false
  try {
    // Stream source: the lineage (continue / fork / fresh) when enabled, or a
    // fresh provider environment for an independent iteration.
    let stream: AsyncIterable<AgentEnvironmentEvent>
    const source = args.lineagePlan?.[args.item.index - args.baseIndex]
    if (source) {
      const acquired = await source.acquire()
      environment = acquired.handle.environment
      lineageOwned = true
      args.lineageState?.handles.set(args.item.index, acquired.handle)
      stream = acquired.events
    } else {
      environment = await createEnvironmentForSpec(
        args.ctx.environmentProvider,
        spec,
        args.signal,
        args.recordMount,
      )
      const prompt = spec.taskToPrompt(args.item.task)
      stream = turnEvents(
        args.streaming,
        environment,
        prompt,
        `${args.runId}-i${args.item.index}`,
        args.signal,
      )
    }
    const placement = await describeEnvironmentPlacement(environment)
    await emitTrace(args.ctx.traceEmitter, {
      kind: 'loop.iteration.dispatch',
      runId: args.runId,
      timestamp: args.now(),
      payload: {
        iterationIndex: args.item.index,
        agentRunName: slot.agentRunName,
        placement: placement.kind,
        environmentId: environment.id,
        provider: environment.provider,
        fleetId: placement.fleetId,
        machineId: placement.machineId,
        region: placement.region,
        providerMetadata: placement.providerMetadata,
        groupId: args.roundIndex,
        parentIndex: args.parentIndex,
      },
    })
    const events: AgentEnvironmentEvent[] = []
    for await (const event of stream) {
      events.push(event)
      // Tee each raw event to an optional host observer so a caller can stream
      // the agent's live output. Best-effort + isolated: the observer gets a
      // defensive copy (mutating it cannot corrupt the event the run itself
      // consumes for cost accounting + output parsing below), and a sync throw
      // or a rejected async result is swallowed — it can never break the run.
      notifyAgentEnvironmentEventObserver(event, args.ctx.onEnvironmentEvent, {
        iterationIndex: args.item.index,
        agentRunName: slot.agentRunName,
      })
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
        ...(environment ? { environment } : {}),
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
    // The loop owns the per-iteration environment lifecycle. By default it
    // destroys the environment now. Retained-environment mode hands it to the
    // kernel to keep alive for the planner. Lineage mode keeps it
    // alive across rounds (a later round may continue/fork it), tearing it down
    // at loop end — so skip per-iteration teardown here.
    if (lineageOwned) {
      // no-op: lineage.teardown() destroys this environment at loop end
    } else if (args.collectEnvironment && environment) {
      args.collectEnvironment(environment)
    } else {
      await destroyEnvironmentWithTrace(environment, args.ctx.traceEmitter, args.runId, args.now)
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
 * Best-effort environment teardown. A failed destroy must never surface as a
 * loop error. A destroy that fails or exceeds `TEARDOWN_TIMEOUT_MS` is recorded
 * as `loop.teardown.failed`.
 */
async function destroyEnvironmentWithTrace(
  environment: AgentEnvironment | undefined,
  trace?: LoopTraceEmitter,
  runId?: string,
  now?: () => number,
): Promise<void> {
  if (!environment?.destroy) return
  const emitFailed = async (reason: string) => {
    if (!trace || !runId) return
    await emitTrace(trace, {
      kind: 'loop.teardown.failed',
      runId,
      timestamp: (now ?? Date.now)(),
      payload: { environmentId: environment.id, reason },
    })
  }
  const outcome = await withTimeout(destroyEnvironmentSafe(environment), TEARDOWN_TIMEOUT_MS)
  if (outcome === undefined) await emitFailed('timeout')
  else if (outcome === false) await emitFailed('destroy failed')
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

async function describeEnvironmentPlacement(environment: AgentEnvironment): Promise<PlacementInfo> {
  if (environment.placement) {
    try {
      return await environment.placement()
    } catch {
      // Placement metadata is optional and must not fail an otherwise valid run.
    }
  }
  return { kind: 'provider' }
}

interface FinalizeArgs<Task, Output, Decision> {
  options: RunAgentRoundsOptions<Task, Output, Decision>
  decision: Decision
  iterations: Iteration<Task, Output>[]
  startMs: number
  now: () => number
  runId: string
  /** Provenance mounts recorded across the run's box preparations. */
  mounts: MountManifestEntry[]
}

function finalize<Task, Output, Decision>(
  args: FinalizeArgs<Task, Output, Decision>,
): LoopResult<Task, Output, Decision> {
  // Precedence: an explicit caller `selectWinner` wins; else a driver-AUTHORED
  // winner (a `select` topology move); else the default argmax. A driver that
  // declares nothing returns undefined and falls through — existing behavior.
  // Track which selector produced the winner so the receipts attribute it.
  let selector: SelectionReceipt['selector']
  let winner: LoopWinner<Task, Output> | undefined
  if (args.options.selectWinner) {
    selector = 'caller'
    winner = args.options.selectWinner(args.iterations)
  } else {
    const authored = args.options.driver.selectWinner?.(args.iterations)
    if (authored) {
      selector = 'driver'
      winner = authored
    } else {
      selector = 'default'
      winner = defaultSelectWinner(args.iterations)
    }
  }
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
    provenance: {
      mounts: args.mounts,
      selectionReceipts: buildSelectionReceipts(args.iterations, winner, selector),
    },
  }
  return result
}

/**
 * One receipt per scored candidate — a candidate being an iteration that
 * produced an output without erroring (an errored or output-less iteration was
 * never selectable, so it gets no receipt). The receipt records the candidate's
 * score and whether the selector chose it as the winner, attributed to the
 * selector identity that ran. Domain-free: it states WHAT was selected and its
 * score, never anything about the task or output content.
 */
function buildSelectionReceipts<Task, Output>(
  iterations: Iteration<Task, Output>[],
  winner: LoopWinner<Task, Output> | undefined,
  selector: SelectionReceipt['selector'],
): SelectionReceipt[] {
  const receipts: SelectionReceipt[] = []
  for (const iter of iterations) {
    if (iter.output === undefined || iter.error) continue
    const selected = winner?.iterationIndex === iter.index
    const receipt: SelectionReceipt = {
      candidateIndex: iter.index,
      selected,
      selector,
    }
    if (iter.verdict?.score !== undefined) receipt.score = iter.verdict.score
    // The kernel can only speak to its OWN selection logic. A caller- or
    // driver-authored winner runs by its own rationale, so the kernel leaves
    // `reason` unset rather than inventing one.
    if (selector === 'default') receipt.reason = defaultSelectorReason(iter, selected)
    receipts.push(receipt)
  }
  return receipts
}

/** Plain-language reason for the default selector's decision (best-valid-score,
 *  earliest-index tiebreak, falling back to best non-errored when none valid). */
function defaultSelectorReason<Task, Output>(
  iter: Iteration<Task, Output>,
  selected: boolean,
): string {
  const valid = iter.verdict?.valid === true
  if (selected) return valid ? 'best valid score' : 'best non-errored score (no valid candidate)'
  return valid ? 'valid but not top score' : 'not selected'
}

/**
 * Run `decide`, emit the `loop.decision` trace, then finalize and emit
 * `loop.ended`. The two post-while exits (cap reached / `plan()` returned `[]`)
 * share this exact sequence.
 */
async function decideAndFinalize<Task, Output, Decision>(
  options: RunAgentRoundsOptions<Task, Output, Decision>,
  iterations: Iteration<Task, Output>[],
  startMs: number,
  now: () => number,
  runId: string,
  mounts: MountManifestEntry[],
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
  return finalizeAndEmitEnded(options, decision, iterations, startMs, now, runId, mounts)
}

/** Finalize the loop and emit the terminal `loop.ended` span. Used by the
 *  in-loop terminal path (decision trace already emitted) and decideAndFinalize. */
async function finalizeAndEmitEnded<Task, Output, Decision>(
  options: RunAgentRoundsOptions<Task, Output, Decision>,
  decision: Decision,
  iterations: Iteration<Task, Output>[],
  startMs: number,
  now: () => number,
  runId: string,
  mounts: MountManifestEntry[],
): Promise<LoopResult<Task, Output, Decision>> {
  const result = finalize({ options, decision, iterations, startMs, now, runId, mounts })
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
  // right after runAgentRounds resolves (MCP subprocess / CLI dispatch) can't drop it.
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
  options: RunAgentRoundsOptions<Task, Output, Decision>,
): AgentRunSpec<Task>[] {
  if (options.agentRun && options.agentRuns) {
    throw new ValidationError('runAgentRounds: pass exactly one of `agentRun` or `agentRuns`')
  }
  if (options.agentRun) return [options.agentRun]
  if (options.agentRuns && options.agentRuns.length > 0) return options.agentRuns
  throw new ValidationError('runAgentRounds: `agentRun` or non-empty `agentRuns` is required')
}

function isTerminalDecision(decision: unknown): boolean {
  return (
    decision === 'stop' || decision === 'pick-winner' || decision === 'fail' || decision === 'done'
  )
}

function emitRunLoopHook<Task, Output, Decision>(
  options: RunAgentRoundsOptions<Task, Output, Decision>,
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
