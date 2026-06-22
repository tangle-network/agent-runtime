/**
 * `measureMarginalLift` — the with-vs-without ablation for one artifact.
 *
 * "What does THIS one piece add?" is the question a lifecycle has to answer
 * before it can promote anything. The answer is an ablation: score the baseline
 * profile, score the baseline-plus-candidate profile, and report the delta. This
 * is the marginal contribution of the artifact — the same shape the project's
 * `OutcomeMeasurement` reports for an apply pass, but isolated to ONE artifact so
 * a registry can rank candidates by what they individually earn.
 *
 * The measurement is selector-agnostic: it takes an `EvalRunner` the caller
 * supplies (any function that scores a profile and reports cost), runs it twice,
 * and subtracts. It never judges, never picks a winner, never re-scores on a
 * holdout — those are the gate's job. It only quantifies the ablation so the gate
 * has a real number to decide on.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { applyArtifact } from './apply'
import type { ProfileArtifact } from './types'

/**
 * The result of running an eval over ONE profile: a composite score and the cost
 * to obtain it. This mirrors the project's score/cost convention (`composite`
 * from `OutcomeMeasurement`, `costUsd` from `LoopResult`), so a caller can pass a
 * thin wrapper over `runLoop` / `runBenchmark` / `runAgentEval` directly.
 */
export interface EvalResult {
  /** Composite score in `[0, 1]` (higher is better) for the profile under test. */
  composite: number
  /** USD cost to produce this result. */
  costUsd: number
  /** Optional opaque passthrough (per-task cells, the raw report, …). */
  details?: unknown
}

/**
 * Scores a profile. The caller wires this to whatever eval they run — a
 * `runLoop` rollout, a `runBenchmark` campaign, a `runAgentEval` cohort — and
 * returns the composite + cost. `signal` is forwarded for cancellation.
 */
export type EvalRunner = (profile: AgentProfile, signal?: AbortSignal) => Promise<EvalResult>

export interface MeasureMarginalLiftOptions {
  /** The profile the artifact is measured ON TOP OF (the "without" arm). */
  baseline: AgentProfile
  /** The single artifact whose marginal contribution we want. */
  candidate: ProfileArtifact
  /** The eval that scores a profile. Run once per arm (twice total). */
  evalRunner: EvalRunner
  /**
   * A pre-computed baseline result, to skip the "without" run when the caller
   * already scored the baseline (e.g. measuring several candidates against the
   * same baseline). When set, the baseline arm is NOT re-run.
   */
  baselineResult?: EvalResult
  /** Forwarded to both `evalRunner` invocations for cancellation. */
  signal?: AbortSignal
}

/**
 * The marginal lift of one artifact: the with/without ablation.
 *
 * `scoreDelta = with.composite − without.composite`. A positive `scoreDelta` is
 * the evidence a gate needs to promote; a negative one is the signal to drop the
 * artifact. `costDelta` is the extra USD the artifact costs (often positive — a
 * new tool/MCP adds calls) and lets the gate weigh lift against spend.
 */
export interface MarginalLift {
  /** The artifact id this measurement is for (stable, from the registry). */
  artifactId: string
  /** Eval of `applyArtifact(baseline, candidate)`. */
  withArtifact: EvalResult
  /** Eval of `baseline` alone. */
  withoutArtifact: EvalResult
  /** `withArtifact.composite − withoutArtifact.composite`. */
  scoreDelta: number
  /** `withArtifact.costUsd − withoutArtifact.costUsd`. */
  costDelta: number
}

/**
 * Run the with/without ablation for `candidate` over `baseline` and return its
 * marginal score/cost contribution.
 *
 * The "without" arm scores the baseline profile unchanged; the "with" arm scores
 * `applyArtifact(baseline, candidate)`. Both use the same `evalRunner`, so the
 * delta isolates the artifact's effect (eval method held constant). The baseline
 * arm is skipped when `baselineResult` is supplied.
 *
 * @example
 *   const lift = await measureMarginalLift({
 *     baseline,
 *     candidate: registry.get(id)!,
 *     evalRunner: (profile) => scoreProfileOnCohort(profile),
 *   })
 *   if (lift.scoreDelta > 0) registry.promote(lift.artifactId)
 */
export async function measureMarginalLift(opts: MeasureMarginalLiftOptions): Promise<MarginalLift> {
  const { baseline, candidate, evalRunner, baselineResult, signal } = opts

  const withoutArtifact = baselineResult ?? (await evalRunner(baseline, signal))
  const withProfile = applyArtifact(baseline, candidate)
  const withArtifact = await evalRunner(withProfile, signal)

  return {
    artifactId: candidate.id,
    withArtifact,
    withoutArtifact,
    scoreDelta: withArtifact.composite - withoutArtifact.composite,
    costDelta: withArtifact.costUsd - withoutArtifact.costUsd,
  }
}
