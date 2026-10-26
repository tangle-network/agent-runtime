/**
 *
 * The completion-oracle: **settled ⟺ DELIVERED.**
 *
 * Foreman's one hard lesson (0/18 self-improvement deliverables) — "done" must mean a check
 * PASSED, not the agent's say-so. `gateOnDeliverable` wraps an `Executor` so its settlement
 * is `valid` ONLY when the deliverable check passes. The child still RUNS and settles (its
 * spend is conserved into the pool either way), but a child that ran WITHOUT delivering
 * settles `valid:false` — so a keep-best driver never counts it as done, and a gate never
 * inflates with self-judged wins.
 *
 * Dual-purpose by construction:
 *  - product: the agent fleet only advances on real, checked deliverables.
 *  - proof: the gate's `valid` is the honest settle — equal-k comparisons can't be gamed by an
 *    arm that "ran" without producing the artifact.
 *
 * The check is a DEPLOYABLE oracle — a test command, a state verifier, the commit0 judge —
 * read off the child's output, never the model judging itself. A throwing check is
 * fail-closed (not delivered), never a crash.
 *
 * @experimental
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { isAsyncIterable } from '../util'
import { checkVerdictOf } from './continuation'
import { teardownSurfaces } from './deadline'
import { inheritRuntimeOwnedExecutorAttestation } from './materialization'
import {
  type RetainedExecutorContext,
  retainedExecutorContext,
  retainedExecutorSeamKey,
} from './retained-executor'
import { detachedSnapshot } from './snapshot'
import type {
  DefaultVerdict,
  Executor,
  ExecutorFactory,
  ExecutorNodeContext,
  ExecutorResult,
  UsageEvent,
} from './types'

/** Kernel-owned leaf identity; never reconstructed from the worker's submitted output. */
export interface CompletionCheckContext {
  readonly profile: AgentProfile
  readonly node: ExecutorNodeContext | undefined
  readonly originalVerdict: DefaultVerdict | undefined
  readonly signal: AbortSignal
}

/**
 * The deployable completion oracle passed to {@link gateOnDeliverable}: a `check` that
 * decides DELIVERED (settles `valid` ⟺ it passes) plus an optional `describe` of what the spawn
 * was supposed to produce. The check reads the child's output — never the model judging itself.
 *
 * The same check decides a manager's `submit_result`, runs when a manager's turn ends without an
 * accepted result, and supplies the verdict the continuation note reports (`src/runtime/supervise/continuation.ts`).
 */
export interface DeliverableSpec<Out = unknown> {
  /** The deployable check that decides DELIVERED. Return a `CheckVerdict` to report the items it
   *  read and one `FAIL <item> <where>: <reason>` line per failed item; `true` or a passing verdict
   *  delivers. Throw `CheckUnavailableError` (or anything) when the check could not run: that is
   *  never a verdict on the result. Only gateFactoryOnDeliverable supplies the trusted leaf
   *  context; direct checks and graph finalizers receive none. */
  check: (
    out: Out,
    context?: CompletionCheckContext,
  ) => boolean | CheckVerdict | Promise<boolean | CheckVerdict>
  /** What the spawn was supposed to produce — surfaced in traces/reports. */
  describe?: string
  /** Judge the run's current state with no submitted result. Runtime calls it when a manager's
   *  turn ends and no result reached the check during that turn. Omit for a check that reads only
   *  the submitted value. */
  checkState?: () => boolean | CheckVerdict | Promise<boolean | CheckVerdict>
  /** `verbatim` (the default) returns the check's FAIL lines to the manager; `pass-only` tells it
   *  only that the check failed and how many times it has read the check, for a check whose tests
   *  must stay hidden. */
  feedback?: 'verbatim' | 'pass-only'
  /** True when the score comes from sealed cases the manager never sees. Stated in the note. */
  sealed?: boolean
}

/**
 * Wrap an `Executor` so its settlement `valid` reflects the deliverable check, not the
 * inner verdict. Handles both `execute` shapes (one-shot `Promise<ExecutorResult>` and
 * streaming `AsyncIterable<UsageEvent>` + `resultArtifact()`); the check runs once the inner
 * executor has produced its output. The inner `score` is preserved; only `valid` is gated.
 */
export function gateOnDeliverable<Out>(
  inner: Executor<Out>,
  deliverable: DeliverableSpec<Out>,
): Executor<Out> {
  return wrapCompletionGate(inner, (result) => checkDeliverable(deliverable, result))
}

/** Build a worker with the same check on durable acceptance and normal completion. @internal */
export function gateFactoryOnDeliverable(
  factory: ExecutorFactory<unknown>,
  deliverable: DeliverableSpec,
): ExecutorFactory<unknown> {
  return (spec, ctx) => {
    const profile = detachedSnapshot(spec.profile, 'completion check profile')
    const node =
      ctx.node === undefined ? undefined : detachedSnapshot(ctx.node, 'completion check node')
    const retention = retainedExecutorContext(ctx)
    // One invocation's exact artifact reaches both onResult and resultArtifact. A new native
    // invocation has a new artifact even when its output is identical, so it is checked again.
    const verdicts = new WeakMap<ExecutorResult<unknown>, Promise<DefaultVerdict>>()
    const check = (result: ExecutorResult<unknown>): Promise<DefaultVerdict> => {
      let verdict = verdicts.get(result)
      if (verdict === undefined) {
        verdict = checkDeliverable(
          deliverable,
          result,
          Object.freeze({
            profile,
            node,
            signal: ctx.signal,
            originalVerdict:
              result.verdict === undefined
                ? undefined
                : detachedSnapshot(result.verdict, 'completion check original verdict'),
          }),
        )
        verdicts.set(result, verdict)
      }
      return verdict
    }
    if (retention === undefined) return wrapCompletionGate(factory(spec, ctx), check)
    const checkedRetention = (source: RetainedExecutorContext): RetainedExecutorContext => ({
      ...source,
      onResult: async (result) => source.onResult({ ...result, verdict: await check(result) }),
      ...(source.continueInvocation === undefined
        ? {}
        : {
            continueInvocation: async (task: unknown) =>
              checkedRetention(await source.continueInvocation!(task)),
          }),
    })
    const inner = factory(spec, {
      ...ctx,
      seams: { ...ctx.seams, [retainedExecutorSeamKey]: checkedRetention(retention) },
    })
    return wrapCompletionGate(inner, check)
  }
}

async function checkDeliverable<Out>(
  deliverable: DeliverableSpec<Out>,
  result: ExecutorResult<Out>,
  context?: CompletionCheckContext,
): Promise<DefaultVerdict> {
  let delivered: boolean
  try {
    delivered = checkVerdictOf(await deliverable.check(result.out, context)).pass
  } catch {
    delivered = false // A check that could not run never establishes delivery.
  }
  return { valid: delivered, score: result.verdict?.score ?? (delivered ? 1 : 0) }
}

function wrapCompletionGate<Out>(
  inner: Executor<Out>,
  check: (result: ExecutorResult<Out>) => Promise<DefaultVerdict>,
): Executor<Out> {
  let gated: DefaultVerdict | undefined

  /**
   * Ask the delivery question once, from whatever the inner executor managed to produce.
   *
   * Fail-closed on the artifact being unavailable: an executor that never produced one delivered
   * nothing, and leaving `gated` unset keeps the existing invalid-by-default reading.
   */
  const settleVerdict = async (): Promise<void> => {
    let art: ReturnType<Executor<Out>['resultArtifact']>
    try {
      art = inner.resultArtifact()
    } catch {
      return
    }
    gated = await check(art)
  }

  const gateExecution = (
    r: ReturnType<Executor<Out>['execute']>,
  ): ReturnType<Executor<Out>['execute']> => {
    if (isAsyncIterable<UsageEvent>(r)) {
      // The terminal artifact may exist even when a budget or abort ends the stream.
      return (async function* () {
        try {
          for await (const ev of r) yield ev
        } finally {
          await settleVerdict()
        }
      })()
    }
    return (async () => {
      let res: ExecutorResult<Out>
      try {
        res = await r
      } catch (error) {
        await settleVerdict()
        throw error
      }
      gated = await check(res)
      return { ...res, verdict: gated } satisfies ExecutorResult<Out>
    })()
  }

  const wrapped: Executor<Out> = {
    runtime: inner.runtime,
    ...(inner.budgetExempt !== undefined ? { budgetExempt: inner.budgetExempt } : {}),
    ...(inner.deliver ? { deliver: (m: unknown) => inner.deliver?.(m) } : {}),
    ...(inner.cancel ? { cancel: (request) => inner.cancel!(request) } : {}),
    ...(inner.interactive ? { interactive: () => inner.interactive!() } : {}),
    ...(inner.interactiveReady ? { interactiveReady: () => inner.interactiveReady!() } : {}),
    // Forward the OPTIONAL live-observation surfaces so a gated worker stays supervisable
    // mid-flight. The scope captures `progress`/`traceSource` at spawn and only if the executor
    // exposes them; a gate that drops them makes `observe_agent` read `recentActivity:[]` and
    // loses online detection for a running worker (it saw the tokens/turns the fold derives, but
    // none of the harness's own turn count or tool activity). `metered` is a driver-executor's
    // OWN-inference subtree total, re-homed by the parent on settle — dropping it would leak a
    // gated sub-driver's inference out of the journal. Preserve the "undefined ⟺ not implemented"
    // contract: only expose a method the inner executor actually implements.
    ...(inner.progress ? { progress: () => inner.progress?.() } : {}),
    ...(inner.traceSource ? { traceSource: () => inner.traceSource?.() } : {}),
    ...(inner.metered ? { metered: () => inner.metered?.() } : {}),
    ...(inner.accounting ? { accounting: () => inner.accounting?.() } : {}),
    ...(inner.resultAccepted ? { resultAccepted: () => inner.resultAccepted?.() === true } : {}),
    ...(inner.harnessTranscript ? { harnessTranscript: () => inner.harnessTranscript?.() } : {}),
    ...(inner.harnessTranscriptSettled
      ? { harnessTranscriptSettled: () => inner.harnessTranscriptSettled?.() ?? Promise.resolve() }
      : {}),
    execute: (task, signal) => gateExecution(inner.execute(task, signal)),
    ...(inner.recover
      ? {
          recover: (task: unknown, signal: AbortSignal) =>
            gateExecution(inner.recover!(task, signal)),
        }
      : {}),
    teardown: (grace) => inner.teardown(grace),
    ...teardownSurfaces(inner),
    resultArtifact() {
      const art = inner.resultArtifact()
      return { ...art, verdict: gated ?? art.verdict }
    },
  }
  return inheritRuntimeOwnedExecutorAttestation(inner, wrapped)
}

export interface ExecutorResultMapping<Out> {
  outRef: string
  out: Out
  verdict?: DefaultVerdict
}

/**
 * Transform a Runtime executor's terminal artifact without losing its private
 * profile-materialization attestation or altering its measured spend. This is
 * the composition point for deterministic post-processing and grading; callers
 * must not rebuild an Executor around a model transport merely to change `out`.
 */
export function mapExecutorResult<In, Out>(
  inner: Executor<In>,
  map: (
    result: ExecutorResult<In>,
    task: unknown,
  ) => ExecutorResultMapping<Out> | Promise<ExecutorResultMapping<Out>>,
): Executor<Out> {
  let mapped: ExecutorResult<Out> | undefined

  const settle = async (
    result: ExecutorResult<In>,
    task: unknown,
  ): Promise<ExecutorResult<Out>> => {
    const transformed = await map(result, task)
    mapped = {
      outRef: transformed.outRef,
      out: transformed.out,
      ...(transformed.verdict ? { verdict: transformed.verdict } : {}),
      spent: result.spent,
    }
    return mapped
  }

  const mapExecution = (
    execution: ReturnType<Executor<In>['execute']>,
    task: unknown,
  ): ReturnType<Executor<Out>['execute']> => {
    if (isAsyncIterable<UsageEvent>(execution)) {
      return (async function* () {
        for await (const event of execution) yield event
        await settle(inner.resultArtifact(), task)
      })()
    }
    return (async () => settle(await execution, task))()
  }

  const wrapped: Executor<Out> = {
    runtime: inner.runtime,
    ...(inner.budgetExempt !== undefined ? { budgetExempt: inner.budgetExempt } : {}),
    ...(inner.deliver ? { deliver: (message: unknown) => inner.deliver?.(message) } : {}),
    ...(inner.cancel ? { cancel: (request) => inner.cancel!(request) } : {}),
    ...(inner.interactive ? { interactive: () => inner.interactive!() } : {}),
    ...(inner.interactiveReady ? { interactiveReady: () => inner.interactiveReady!() } : {}),
    ...(inner.progress ? { progress: () => inner.progress?.() } : {}),
    ...(inner.traceSource ? { traceSource: () => inner.traceSource?.() } : {}),
    ...(inner.accounting ? { accounting: () => inner.accounting?.() } : {}),
    ...(inner.metered ? { metered: () => inner.metered?.() } : {}),
    ...(inner.harnessTranscript ? { harnessTranscript: () => inner.harnessTranscript?.() } : {}),
    ...(inner.harnessTranscriptSettled
      ? { harnessTranscriptSettled: () => inner.harnessTranscriptSettled?.() ?? Promise.resolve() }
      : {}),
    execute: (task, signal) => mapExecution(inner.execute(task, signal), task),
    ...(inner.recover
      ? {
          recover: (task: unknown, signal: AbortSignal) =>
            mapExecution(inner.recover!(task, signal), task),
        }
      : {}),
    teardown: (grace) => inner.teardown(grace),
    ...teardownSurfaces(inner),
    resultArtifact() {
      if (!mapped) throw new Error('mapExecutorResult: resultArtifact() read before execute()')
      return mapped
    },
  }
  return inheritRuntimeOwnedExecutorAttestation(inner, wrapped)
}

// ── The check ────────────────────────────────────────────────────────────────────────────────────

/**
 * One reading of a completion check.
 *
 * A check program prints an agent-eval `JudgeScore`; {@link verdictFromJudgeScore} reads it into
 * this shape. A plain boolean check is a verdict with no items.
 */
export interface CheckVerdict {
  /** Whether the check accepts the result. */
  readonly pass: boolean
  /** Every item the check read, by name: 1 when it passes, lower when it does not. The
   *  `JudgeScore.dimensions` of the check program. */
  readonly items?: Readonly<Record<string, number>>
  /** The check's score. */
  readonly composite?: number
  /** The pass threshold on `composite`, when the check has one. */
  readonly threshold?: number
  /** One `FAIL <item> <where>: <reason>` line per failed item, in the check's order. */
  readonly failures?: ReadonlyArray<string>
  /** The check's prose review of the result, when it writes one. */
  readonly review?: string
}

/**
 * The check could not run: its box did not start, its judge's provider refused, its program
 * crashed. It is not a verdict on the result. Inside a run the loop pauses, as it does for an
 * unavailable upstream, and the refusal tells the director its result was not judged.
 */
export class CheckUnavailableError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options)
    this.name = 'CheckUnavailableError'
  }
}

/**
 * Read an agent-eval `JudgeScore` from a check program into a verdict.
 *
 * Each dimension is a checked item. `notes` lines that start with `FAIL ` are the failures; the
 * remaining lines are the check's review. The verdict passes when `composite >= threshold` and the
 * score is not marked `failed`; a `failed` score means the judge itself did not run, which is
 * {@link CheckUnavailableError}, not a verdict.
 */
export function verdictFromJudgeScore(
  score: {
    readonly dimensions: Readonly<Record<string, number>>
    readonly composite: number
    readonly notes: string
    readonly failed?: true
  },
  threshold: number,
): CheckVerdict {
  if (score.failed === true) {
    throw new CheckUnavailableError(`the check's judge did not run: ${score.notes}`)
  }
  const lines = score.notes.split('\n').map((line) => line.trimEnd())
  const failures = lines.filter((line) => line.startsWith('FAIL '))
  const review = lines.filter((line) => !line.startsWith('FAIL ') && line.trim() !== '').join('\n')
  return checkVerdictOf({
    pass: score.composite >= threshold,
    items: score.dimensions,
    composite: score.composite,
    threshold,
    failures,
    ...(review === '' ? {} : { review }),
  })
}
