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

import { inheritRuntimeOwnedExecutorAttestation } from './materialization'
import type { DefaultVerdict, Executor, ExecutorResult, UsageEvent } from './types'

/**
 * The deployable completion oracle passed to {@link gateOnDeliverable}: a `check` that
 * decides DELIVERED (settles `valid` ⟺ it resolves true) plus an optional `describe` of
 * what the spawn was supposed to produce. The check reads the child's output — never the
 * model judging itself.
 */
export interface DeliverableSpec<Out = unknown> {
  /** The deployable check that decides DELIVERED. `settled.valid ⟺ this resolves true`. */
  check: (out: Out) => boolean | Promise<boolean>
  /** What the spawn was supposed to produce — surfaced in traces/reports. */
  describe?: string
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
      delivered = (await deliverable.check(out)) === true
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
    execute(task, signal) {
      const r = inner.execute(task, signal)
      if (isAsyncIterable(r)) {
        // Streaming: pass the usage events through (the conserved-pool fold consumes them),
        // then gate the verdict from the settled artifact.
        return (async function* () {
          try {
            for await (const ev of r) yield ev
          } finally {
            // `finally`, NOT the straight-line path: delivery is a property of the OUTPUT, not of
            // how the worker terminated. A worker killed by budget, deadline, or abort AFTER it
            // wrote its deliverable has still delivered, and checking only on clean completion
            // reported failure over completed work.
            //
            // Measured: discovery-lab run `proof-native-tools-20260801b` spawned a child that
            // wrote `child-artifact.txt` containing exactly the required line, then overran a
            // parent-authored 12,000-token budget (it spent 76,657 — no pi child in six runs has
            // finished under ~31,000). The stream aborted, this check never ran, and the run
            // recorded `no-winner` over a file that was correct on disk.
            //
            // This does not weaken the gate. The deliverable check IS the ground truth, so a
            // partially-written or absent artifact still fails it; all that changes is that the
            // question now gets asked.
            await settleVerdict()
          }
        })()
      }
      // One-shot: gate the resolved result's verdict in place.
      return (async () => {
        let res: ExecutorResult<Out>
        try {
          res = await r
        } catch (error) {
          // Same reason as the streaming path: a rejected execute can still have left a correct
          // artifact behind. Check it, then re-throw so the failure itself is never swallowed.
          await settleVerdict()
          throw error
        }
        gated = await check(res.out, res.verdict?.score)
        return { ...res, verdict: gated } satisfies ExecutorResult<Out>
      })()
    },
    teardown: (grace) => inner.teardown(grace),
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
    execute(task, signal) {
      const execution = inner.execute(task, signal)
      if (isAsyncIterable(execution)) {
        return (async function* () {
          for await (const event of execution) yield event
          await settle(inner.resultArtifact(), task)
        })()
      }
      return (async () => settle(await execution, task))()
    },
    teardown: (grace) => inner.teardown(grace),
    resultArtifact() {
      if (!mapped) throw new Error('mapExecutorResult: resultArtifact() read before execute()')
      return mapped
    },
  }
  return inheritRuntimeOwnedExecutorAttestation(inner, wrapped)
}

function isAsyncIterable(v: unknown): v is AsyncIterable<UsageEvent> {
  return (
    v != null &&
    typeof (v as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
  )
}
