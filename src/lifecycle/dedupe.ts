/**
 * `dedupeArtifacts` — retire the redundant half of a non-stacking pair.
 *
 * The lifecycle promotes each artifact on its OWN marginal lift, in isolation.
 * But two artifacts can each earn lift alone yet teach the agent the SAME thing —
 * a distilled "check state first" skill and a "verify before acting" prompt line,
 * say. Composed together they don't add up: the agent already learned the tactic
 * from the first, so the second buys little. Keeping both is wasted profile
 * surface (more context, more cost, more ways to conflict) for no extra score.
 *
 * `dedupeArtifacts` is the judge that catches this. For each pair of `active`
 * artifacts it measures whether their lifts STACK: it scores the baseline, each
 * artifact alone, and BOTH together, then compares the combined lift against the
 * sum of the individual lifts. When `combined < (a + b) − tolerance`, the pair
 * overlaps — they do not stack — and the weaker member (lower individual lift) is
 * `retire`d. Retirement is terminal: the kept member already delivers the shared
 * value, so the loop should not re-promote the redundant one.
 *
 * The "judge" is a MEASUREMENT, not an LLM verdict — it reuses the same ablation
 * machinery (`measureMarginalLift` + the caller's `EvalRunner`) the rest of the
 * lifecycle runs on, so the selector≠judge firewall holds and there is no new
 * execution model. It is surface-agnostic: any two artifacts (skill+prompt,
 * tool+tool, …) are compared identically, because stacking is measured on the
 * composed profile via the one `applyArtifacts` bridge.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { ValidationError } from '../errors'
import { applyArtifacts } from './apply'
import { type EvalResult, type EvalRunner, measureMarginalLift } from './marginal-lift'
import type { ArtifactRegistry } from './registry'
import type { ProfileArtifact } from './types'

export interface DedupeOptions {
  /** The registry whose `active` artifacts are pairwise stack-tested. Mutated in
   *  place: the weaker member of each non-stacking pair is retired. */
  registry: ArtifactRegistry
  /** The baseline profile the stacking ablation runs on top of. The "without"
   *  arm is scored once and shared across every pair. */
  baseline: AgentProfile
  /** Scores a profile on the held-back split. Called for the baseline, each
   *  artifact alone, and each candidate pair together. */
  evalRunner: EvalRunner
  /**
   * The stacking tolerance. A pair is judged non-stacking (redundant) when the
   * combined lift falls SHORT of the sum of individual lifts by more than this:
   * `combined < a + b − tolerance`. A small positive tolerance absorbs eval
   * noise so only a real overlap retires an artifact. Default 0 — any shortfall
   * counts as non-stacking (use a positive value on noisy live evals).
   */
  tolerance?: number
  /** Restrict dedupe to one surface (only compare skills against skills, …).
   *  Default: every `active` artifact is a candidate, across kinds. */
  kind?: ProfileArtifact['kind']
  /** A pre-computed baseline result, to skip the shared "without" run. */
  baselineResult?: EvalResult
  /** Cooperative cancellation, forwarded to every `evalRunner` call. */
  signal?: AbortSignal
}

/** The stacking verdict for one pair of active artifacts. */
export interface PairStackCheck {
  /** Ids of the two artifacts compared, in (a, b) order as examined. */
  pair: [string, string]
  /** Individual held-back lift of the first artifact alone (re-measured). */
  liftA: number
  /** Individual held-back lift of the second artifact alone (re-measured). */
  liftB: number
  /** Held-back lift of BOTH artifacts composed together. */
  combinedLift: number
  /** `combinedLift − (liftA + liftB)`: ≥ −tolerance ⇒ they stack; below ⇒ they
   *  overlap (redundant). */
  stackGap: number
  /** Whether the pair was judged non-stacking (redundant). */
  redundant: boolean
  /** The id retired when redundant (the weaker member), else `undefined`. */
  retiredId?: string
}

export interface DedupeResult {
  /** One verdict per examined pair, in iteration order. Pairs where one member
   *  was already retired by an earlier pair this cycle are skipped. */
  checks: PairStackCheck[]
  /** Ids retired this cycle (the weaker member of each non-stacking pair). */
  retired: string[]
  /** The shared baseline eval (the "without" arm, measured once). */
  baselineResult: EvalResult
}

/**
 * Pairwise stack-test the `active` artifacts and retire the redundant half of
 * each non-stacking pair.
 *
 * For every unordered pair of active artifacts (optionally within one `kind`),
 * the combined lift is compared against the sum of individual lifts. A pair is
 * non-stacking when `combinedLift < liftA + liftB − tolerance`; the lower-lift
 * member is retired (ties retire the second-examined). An artifact retired by one
 * pair is removed from the remaining comparisons that cycle, so a cluster of
 * three mutually-redundant artifacts collapses to its single strongest member.
 *
 * Cost is one shared baseline run, one re-measure per active artifact (cached
 * across the pairs it appears in), and one combined run per still-eligible pair.
 *
 * @example Retire skills that teach the same tactic as a stronger one:
 *   const out = await dedupeArtifacts({ registry, baseline, evalRunner, kind: 'skill' })
 *   if (out.retired.length) report(`retired ${out.retired.length} redundant skills`)
 */
export async function dedupeArtifacts(opts: DedupeOptions): Promise<DedupeResult> {
  const tolerance = opts.tolerance ?? 0
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new ValidationError(
      `dedupeArtifacts: tolerance must be a finite, non-negative number (got ${tolerance})`,
    )
  }

  const active = opts.registry.list({ status: 'active', kind: opts.kind })
  const baselineResult = opts.baselineResult ?? (await opts.evalRunner(opts.baseline, opts.signal))

  // Re-measure each artifact's individual lift ONCE (cached across every pair it
  // appears in) so the stack comparison is apples-to-apples in this eval cycle.
  const liftCache = new Map<string, number>()
  const liftOf = async (artifact: ProfileArtifact): Promise<number> => {
    const cached = liftCache.get(artifact.id)
    if (cached !== undefined) return cached
    const lift = await measureMarginalLift({
      baseline: opts.baseline,
      candidate: artifact,
      evalRunner: opts.evalRunner,
      baselineResult,
      signal: opts.signal,
    })
    liftCache.set(artifact.id, lift.scoreDelta)
    return lift.scoreDelta
  }

  const retired = new Set<string>()
  const checks: PairStackCheck[] = []

  for (let i = 0; i < active.length; i += 1) {
    if (opts.signal?.aborted) break
    const a = active[i]!
    if (retired.has(a.id)) continue
    for (let j = i + 1; j < active.length; j += 1) {
      if (opts.signal?.aborted) break
      const b = active[j]!
      if (retired.has(b.id)) continue

      const liftA = await liftOf(a)
      const liftB = await liftOf(b)
      const combined = await opts.evalRunner(applyArtifacts(opts.baseline, [a, b]), opts.signal)
      const combinedLift = combined.composite - baselineResult.composite
      const stackGap = combinedLift - (liftA + liftB)
      const redundant = stackGap < -tolerance

      const check: PairStackCheck = {
        pair: [a.id, b.id],
        liftA,
        liftB,
        combinedLift,
        stackGap,
        redundant,
      }
      if (redundant) {
        // Retire the weaker member; on a tie, drop the second-examined.
        const weaker = liftA < liftB ? a : b
        const reason =
          `lifts do not stack: combined Δ=${combinedLift.toFixed(4)} < ` +
          `${a.id} (Δ=${liftA.toFixed(4)}) + ${b.id} (Δ=${liftB.toFixed(4)}) − tol ${tolerance} — ` +
          `redundant with ${(weaker.id === a.id ? b : a).id}`
        opts.registry.retire(weaker.id, reason)
        retired.add(weaker.id)
        check.retiredId = weaker.id
        checks.push(check)
        // `a` itself may have been the one retired — stop pairing it further.
        if (weaker.id === a.id) break
      } else {
        checks.push(check)
      }
    }
  }

  return { checks, retired: [...retired], baselineResult }
}
