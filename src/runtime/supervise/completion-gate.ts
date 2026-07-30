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

/** Assess one concrete output with the caller's completion check. Throwing checks fail closed. */
export async function checkDeliverable<Out>(
  out: Out,
  deliverable: DeliverableSpec<Out>,
  baseScore?: number,
): Promise<DefaultVerdict> {
  let delivered: boolean
  try {
    delivered = (await deliverable.check(out)) === true
  } catch {
    delivered = false
  }
  return { valid: delivered, score: baseScore ?? (delivered ? 1 : 0) }
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

  return {
    runtime: inner.runtime,
    ...(inner.budgetExempt !== undefined ? { budgetExempt: inner.budgetExempt } : {}),
    ...(inner.deliver ? { deliver: (m: unknown) => inner.deliver?.(m) } : {}),
    ...(inner.canDeliver ? { canDeliver: () => inner.canDeliver?.() ?? false } : {}),
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
          for await (const ev of r) yield ev
          const art = inner.resultArtifact()
          gated = await checkDeliverable(art.out, deliverable, art.verdict?.score)
        })()
      }
      // One-shot: gate the resolved result's verdict in place.
      return (async () => {
        const res = await r
        gated = await checkDeliverable(res.out, deliverable, res.verdict?.score)
        return { ...res, verdict: gated } satisfies ExecutorResult<Out>
      })()
    },
    teardown: (grace) => inner.teardown(grace),
    resultArtifact() {
      const art = inner.resultArtifact()
      return { ...art, verdict: gated ?? art.verdict }
    },
  }
}

function isAsyncIterable(v: unknown): v is AsyncIterable<UsageEvent> {
  return (
    v != null &&
    typeof (v as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
  )
}
