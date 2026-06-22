/**
 * `PromotionGate` — the held-back exam that decides whether a measured candidate
 * artifact is promoted into the registry.
 *
 * The lifecycle measures each candidate's marginal lift (`measureMarginalLift`),
 * but a positive ablation delta on the practice problems is NOT enough to ship —
 * that is how you overfit. The gate is the SECOND, stricter test: it decides
 * promotion from a held-back split (fresh problems the candidate never tuned on)
 * with a significance bar, so a promoted artifact earned its place rather than
 * memorized the practice set.
 *
 * The interface is small and pluggable on purpose: production wires
 * `heldOutPromotionGate`, which delegates to agent-eval's paper-grade
 * `HeldOutGate` (paired-bootstrap CI on the held-out delta + an overfit-gap
 * check). A deterministic test can inject a stub gate. The orchestrator never
 * imports `HeldOutGate` directly — it only knows this interface — so the gate
 * policy is a configuration choice, not a hardcode.
 */

import { HeldOutGate, type RunRecord } from '@tangle-network/agent-eval'
import type { MarginalLift } from './marginal-lift'

/** The verdict a gate returns for one candidate. */
export interface PromotionVerdict {
  /** Whether to promote the candidate into the registry as `active`. */
  promote: boolean
  /** Human-readable reason (surfaced in provenance + reports). */
  reason: string
  /** Machine-readable rejection code, or `null` on promote. Mirrors the
   *  `HeldOutGate` rejection taxonomy when that gate is the backend. */
  rejectionCode: string | null
}

/**
 * Decides whether ONE measured candidate is promoted. The lifecycle calls this
 * once per candidate, after `measureMarginalLift` has produced the ablation.
 *
 * `lift` carries the with/without ablation (the marginal contribution); the gate
 * MAY use it directly (the simple "positive lift on the held-back split" policy)
 * OR ignore the scalar and decide from the paired per-task records the eval
 * produced (`lift.withArtifact.runs` / `lift.withoutArtifact.runs`) when a
 * significance gate like `HeldOutGate` is the backend.
 */
export interface PromotionGate {
  /** Stable label for the gate policy (provenance). */
  kind: string
  decide(lift: MarginalLift): PromotionVerdict
}

/**
 * The simplest honest gate: promote iff the candidate's marginal lift on the
 * held-back split clears `minDelta` (default `> 0`). It reads only the scalar
 * `scoreDelta`, so it works with any `EvalRunner` (no per-task records needed).
 *
 * Use this when the eval is already scored ON the held-back split and you want a
 * threshold, not a significance test — e.g. a deterministic fixture domain, or a
 * cheap first pass before a paired-bootstrap gate. For paper-grade promotion on
 * noisy live evals, prefer `heldOutPromotionGate`.
 */
export function thresholdPromotionGate(minDelta = 0): PromotionGate {
  return {
    kind: `threshold:${minDelta}`,
    decide(lift): PromotionVerdict {
      if (lift.scoreDelta > minDelta) {
        return {
          promote: true,
          reason: `held-back lift Δ=${lift.scoreDelta.toFixed(4)} > ${minDelta}`,
          rejectionCode: null,
        }
      }
      return {
        promote: false,
        reason: `held-back lift Δ=${lift.scoreDelta.toFixed(4)} ≤ ${minDelta}`,
        rejectionCode: 'negative_delta',
      }
    },
  }
}

export interface HeldOutPromotionGateOptions {
  /** Stable label of the baseline candidate the held-out records pair against. */
  baselineKey: string
  /** Minimum paired (candidate, baseline) holdout observations. Default 3. */
  minProductiveRuns?: number
  /** Lower-bound on the bootstrap-CI of the median paired holdout delta. Default 0. */
  pairedDeltaThreshold?: number
  /** Max allowed worsening of the (search − holdout) overfit gap. Default 0.15. */
  overfitGapThreshold?: number
  /** Deterministic bootstrap seed (reproducible CIs). Default unseeded. */
  seed?: number
  /** Hard ceiling on the candidate's median per-task USD cost. Default none. */
  costPerTaskCeiling?: number
}

/**
 * The paper-grade promotion gate: delegate to agent-eval's `HeldOutGate`, which
 * pairs the candidate and baseline per-task holdout records by (experimentId,
 * seed), runs a paired-bootstrap CI on the median delta, and checks the
 * overfit gap. Promotes only when the held-out generalization is real, not luck.
 *
 * REQUIRES the eval to surface per-task records: `lift.withArtifact.runs` (the
 * candidate arm) and `lift.withoutArtifact.runs` (the baseline arm), each
 * carrying matched seeds with both `search` and `holdout` split scores. When the
 * records are absent, this gate FAILS LOUD — a held-out significance claim with
 * no per-task data behind it would be a fabricated number, which the
 * no-silent-fallback doctrine forbids. Use `thresholdPromotionGate` for evals
 * that only produce a scalar composite.
 */
export function heldOutPromotionGate(opts: HeldOutPromotionGateOptions): PromotionGate {
  const gate = new HeldOutGate({
    baselineKey: opts.baselineKey,
    minProductiveRuns: opts.minProductiveRuns,
    pairedDeltaThreshold: opts.pairedDeltaThreshold,
    overfitGapThreshold: opts.overfitGapThreshold,
    seed: opts.seed,
    costPerTaskCeiling: opts.costPerTaskCeiling,
  })
  return {
    kind: 'heldout',
    decide(lift): PromotionVerdict {
      const candidateRuns = recordsOf(lift.withArtifact.runs, 'withArtifact', lift.artifactId)
      const baselineRuns = recordsOf(lift.withoutArtifact.runs, 'withoutArtifact', lift.artifactId)
      const decision = gate.evaluate(candidateRuns, baselineRuns)
      return {
        promote: decision.promote,
        reason: decision.reason,
        rejectionCode: decision.rejectionCode,
      }
    },
  }
}

/** Require the per-task records the held-out gate cannot run without. */
function recordsOf(
  runs: RunRecord[] | undefined,
  arm: 'withArtifact' | 'withoutArtifact',
  artifactId: string,
): RunRecord[] {
  if (runs === undefined || runs.length === 0) {
    throw new Error(
      `heldOutPromotionGate: the EvalRunner produced no per-task records on the '${arm}' arm for artifact ${JSON.stringify(artifactId)}. ` +
        'The held-out gate runs a paired-bootstrap on per-task holdout records — it cannot decide from a scalar composite. ' +
        'Either surface EvalResult.runs from your runner, or use thresholdPromotionGate.',
    )
  }
  return runs
}
