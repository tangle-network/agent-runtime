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

import { isAsyncIterable } from '../util'
import { type CheckVerdict, checkVerdictOf } from './continuation'
import { teardownSurfaces } from './deadline'
import { inheritRuntimeOwnedExecutorAttestation } from './materialization'
import type { DefaultVerdict, Executor, ExecutorResult, UsageEvent } from './types'

/**
 * The deployable completion oracle passed to {@link gateOnDeliverable}: a `check` that
 * decides DELIVERED (settles `valid` ⟺ it passes) plus an optional `describe` of what the spawn
 * was supposed to produce. The check reads the child's output — never the model judging itself.
 *
 * The same check decides a manager's `submit_result`, runs when a manager's turn ends without an
 * accepted result, and supplies the verdict the continuation note reports (`./continuation.ts`).
 */
export interface DeliverableSpec<Out = unknown> {
  /** The deployable check that decides DELIVERED. Return a `CheckVerdict` to report the items it
   *  read and one `FAIL <item> <where>: <reason>` line per failed item; `true` or a passing verdict
   *  delivers. Throw `CheckUnavailableError` (or anything) when the check could not run: that is
   *  never a verdict on the result. */
  check: (out: Out) => boolean | CheckVerdict | Promise<boolean | CheckVerdict>
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
  let gated: DefaultVerdict | undefined

  const check = async (out: Out, baseScore?: number): Promise<DefaultVerdict> => {
    let delivered: boolean
    try {
      delivered = checkVerdictOf(await deliverable.check(out)).pass
    } catch {
      delivered = false // fail-closed: a throwing check is NOT a delivery
    }
    return { valid: delivered, score: baseScore ?? (delivered ? 1 : 0) }
  }

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
    gated = await check(art.out, art.verdict?.score)
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
      gated = await check(res.out, res.verdict?.score)
      return { ...res, verdict: gated } satisfies ExecutorResult<Out>
    })()
  }

  const wrapped: Executor<Out> = {
    runtime: inner.runtime,
    ...(inner.budgetExempt !== undefined ? { budgetExempt: inner.budgetExempt } : {}),
    ...(inner.deliver ? { deliver: (m: unknown) => inner.deliver?.(m) } : {}),
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

  const wrapped: Executor<Out> = {
    runtime: inner.runtime,
    ...(inner.budgetExempt !== undefined ? { budgetExempt: inner.budgetExempt } : {}),
    ...(inner.deliver ? { deliver: (message: unknown) => inner.deliver?.(message) } : {}),
    ...(inner.progress ? { progress: () => inner.progress?.() } : {}),
    ...(inner.traceSource ? { traceSource: () => inner.traceSource?.() } : {}),
    ...(inner.accounting ? { accounting: () => inner.accounting?.() } : {}),
    ...(inner.metered ? { metered: () => inner.metered?.() } : {}),
    ...(inner.harnessTranscript ? { harnessTranscript: () => inner.harnessTranscript?.() } : {}),
    ...(inner.harnessTranscriptSettled
      ? { harnessTranscriptSettled: () => inner.harnessTranscriptSettled?.() ?? Promise.resolve() }
      : {}),
    execute(task, signal) {
      const execution = inner.execute(task, signal)
      if (isAsyncIterable<UsageEvent>(execution)) {
        return (async function* () {
          for await (const event of execution) yield event
          await settle(inner.resultArtifact(), task)
        })()
      }
      return (async () => settle(await execution, task))()
    },
    teardown: (grace) => inner.teardown(grace),
    ...teardownSurfaces(inner),
    resultArtifact() {
      if (!mapped) throw new Error('mapExecutorResult: resultArtifact() read before execute()')
      return mapped
    },
  }
  return inheritRuntimeOwnedExecutorAttestation(inner, wrapped)
}
