/**
 *
 * `runAgentRounds` — the topology-agnostic kernel built atop the sandbox SDK.
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
 *
 * @stable
 */

import type { SandboxInstance } from '@tangle-network/sandbox'
import { ValidationError } from '../errors'
import { emitRunLoopHook, emitTrace } from './iteration-events'
import { runBatch } from './iteration-execution'
import { decideAndFinalize, finalizeAndEmitEnded, isTerminalDecision } from './iteration-result'
import {
  branchPoint,
  destroySandboxSafe,
  planLineageRound,
  pruneLineage,
  setUpLineage,
} from './iteration-sandboxes'
import { readPromptOptions } from './prompt-options'
import {
  type SandboxEvidenceRetentionPort,
  SandboxEvidenceTracker,
} from './sandbox-evidence-retention'
import { assertExecutableAgentProfile } from './supervise/model-policy'
import type {
  AgentRunSpec,
  Driver,
  ExecCtx,
  Iteration,
  LoopLineageOptions,
  LoopResult,
  LoopWinner,
  MountManifestEntry,
  MountRecorder,
  OutputAdapter,
  Validator,
} from './types'
import { randomSuffix, stringifySafe, throwAbort, zeroTokenUsage } from './util'

/** @stable */
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
  /** Durable Sandbox evidence capture required before any worker box cleanup. */
  evidenceRetention?: SandboxEvidenceRetentionPort
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
   * (one that reuses the worker's box) can stream its move INTO the
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
   * parent iteration's session on its live box; with `forkFanout` on, a fanout
   * round branches the parent's live box so the branches share a context prefix.
   * The lineage owns every box it starts or
   * forks and tears them all down at loop end — so these paths are mutually
   * exclusive with `onWorkerBox`, which claims the same box-ownership channel.
   * @experimental
   */
  lineage?: LoopLineageOptions
}

const DEFAULT_MAX_ITERATIONS = 10

const DEFAULT_MAX_CONCURRENCY = 4

/**
 * The round-synchronous MULTI-AGENT kernel: each round `driver.plan()` fans N tasks
 * out to N sandboxes (bounded concurrency), parses + validates each output, and folds
 * the round's results through `driver.decide` — fanout → validate → vote/select →
 * refine, repeated until the driver says stop. One call spans many agent sessions.
 *
 * Not to be confused with `runToolLoop` / `streamToolLoop` (`/tool-loop`): those
 * run ONE chat turn against ONE model, dispatching the tool calls that turn emits and
 * folding the results back in until the model stops calling tools. No sandboxes, no
 * rounds, no winner selection.
 *
 * @stable
 */
export async function runAgentRounds<Task, Output, Decision>(
  options: RunAgentRoundsOptions<Task, Output, Decision>,
): Promise<LoopResult<Task, Output, Decision>> {
  const specs = resolveAgentRuns(options)
  for (const [index, spec] of specs.entries()) {
    assertExecutableAgentProfile(spec.profile, `runAgentRounds: agent spec ${index}`)
  }
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS
  if (!Number.isFinite(maxIterations) || maxIterations <= 0) {
    throw new ValidationError('runAgentRounds: maxIterations must be > 0')
  }
  const maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY
  if (!Number.isFinite(maxConcurrency) || maxConcurrency <= 0) {
    throw new ValidationError('runAgentRounds: maxConcurrency must be > 0')
  }
  // Default fresh-box path streaming mode (read regardless of lineage activation,
  // which gates on sessionContinuity/forkFanout — the bench uses neither).
  const sandboxStreaming = options.lineage?.streaming ?? 'sse'
  if (!options.ctx?.sandboxClient || typeof options.ctx.sandboxClient.create !== 'function') {
    throw new ValidationError('runAgentRounds: ctx.sandboxClient.create is required')
  }
  // Read once, before any box exists: an unusable value is a caller error, and the
  // kernel-owned sessionId/signal are removed here so no later call site can forward
  // a caller's copy of them.
  const promptOptions = readPromptOptions(
    options.ctx.promptOptions,
    'runAgentRounds: ctx.promptOptions',
  )
  const now = options.now ?? Date.now
  const runId = options.runId ?? `loop-${randomSuffix()}`
  if (options.evidenceRetention !== undefined && options.onWorkerBox !== undefined) {
    throw new ValidationError(
      'runAgentRounds: evidenceRetention cannot cover sessions dispatched through onWorkerBox',
    )
  }
  const evidenceTracker =
    options.evidenceRetention === undefined
      ? undefined
      : new SandboxEvidenceTracker(options.evidenceRetention, runId)
  const loopStart = now()
  const driverName = options.driver.name ?? 'driver'
  const iterations: Iteration<Task, Output>[] = []
  // Per-run provenance manifest. `recordMount` is threaded into every box
  // preparation path (fresh + lineage) so a `prepareBox` declares what it
  // mounted. The kernel never inspects box contents — it only collects what the
  // caller records.
  const mounts: MountManifestEntry[] = []
  const recordMount: MountRecorder = (entry) => {
    mounts.push(entry)
  }
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
  // branches the parent box. Both flags off ⇒ lineage stays undefined and
  // the per-iteration acquire/stream/teardown path is byte-identical to today.
  const lineageState = await setUpLineage(
    options,
    maxConcurrency,
    recordMount,
    promptOptions,
    evidenceTracker,
  )

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
      // the parent session (refine) or branch the parent box (fanout).
      const lineagePlan = lineageState
        ? planLineageRound(
            lineageState,
            specs,
            slice,
            parentIndex,
            controller.signal,
            evidenceTracker !== undefined,
          )
        : undefined

      await runBatch({
        slice,
        baseIndex,
        iterations,
        specs,
        output: options.output,
        validator: options.validator,
        maxConcurrency,
        streaming: sandboxStreaming,
        signal: controller.signal,
        ctx: options.ctx,
        runId,
        now,
        roundIndex,
        parentIndex,
        collectBox,
        lineagePlan,
        lineageState,
        evidenceTracker,
        recordMount,
        ...(promptOptions === undefined ? {} : { promptOptions }),
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
      // The loop continues: free any lineage boxes no future round can descend
      // from, so the live-box set tracks the active frontier instead of growing
      // with every round. No-op unless pruning is provably safe (see canPrune).
      if (lineageState) await pruneLineage(lineageState, iterations)
    }

    // Either the cap was reached without a terminal decision, or plan() returned
    // [] first — both ask the driver for its final state and close out identically.
    return await decideAndFinalize(options, iterations, loopStart, now, runId, mounts)
  } finally {
    if (options.ctx.signal) options.ctx.signal.removeEventListener('abort', onOuterAbort)
    // Same-sandbox mode kept worker boxes alive across plan() so the planner could
    // stream into them — the kernel owns their teardown. Destroy in parallel so a
    // large fanout's deletes don't serialize, and bound each so a hung platform
    // delete cannot wedge loop return after the caller aborted.
    const cleanup = await Promise.allSettled(
      ownedBoxes.map((box) =>
        evidenceTracker === undefined
          ? destroySandboxSafe(box, options.ctx.traceEmitter, runId, now)
          : evidenceTracker.destroy(box),
      ),
    )
    if (options.onWorkerBox) options.onWorkerBox(undefined)
    let lineageFailure: unknown
    try {
      if (lineageState) await lineageState.lineage.teardown()
    } catch (error) {
      lineageFailure = error
    }
    const failures = cleanup.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    )
    if (lineageFailure !== undefined) failures.push(lineageFailure)
    // biome-ignore lint/correctness/noUnsafeFinally: Evidence failure must prevent a successful run result and keep source boxes live.
    if (failures.length) throw new AggregateError(failures, 'Sandbox evidence cleanup failed')
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
