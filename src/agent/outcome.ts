/**
 * `OutcomeMeasurement` — the missing metric that turns the analyst
 * loop from "observability" into "self-improvement".
 *
 * Without this hook, the loop reports process counts (`findings: 42`,
 * `applied: 7`) and never proves the applied edits actually improved
 * anything. With this hook, the substrate re-runs the cohort against
 * the same personas after each apply pass and reports a composite
 * score delta. A negative delta is the substrate's strongest signal
 * to either roll back or surface for review.
 *
 * Wiring is intentionally simple: pass the manifest + the `runAgentEval`
 * function and a list of `personaIds` to re-run. The wrapper:
 *   1. Captures the baseline composite from the just-finished run.
 *   2. After `runAnalystLoop` returns, re-invokes `runAgentEval` against
 *      the same persona slice.
 *   3. Computes the delta and appends to `loop-report.json`.
 *   4. If `rollbackOnRegression` and delta < 0, reverts applied edits.
 */

import type { RunAnalystLoopResult } from '../analyst-loop/types'

export interface OutcomeMeasurement {
  /** Baseline composite before applies — captured from the most-recent eval run. */
  baselineComposite: number
  /** Composite after re-running the cohort with applied edits. */
  afterComposite: number
  /** `afterComposite - baselineComposite`. Positive = the loop improved the agent. */
  delta: number
  /** Per-persona deltas for finer-grained review. */
  perPersona: ReadonlyArray<{ personaId: string; before: number; after: number; delta: number }>
  /** When the substrate rolled back applies due to regression, the paths reverted. */
  rolledBackPaths: ReadonlyArray<string>
}

export interface OutcomeMeasurementOpts {
  /** Composite scores from the run that produced the findings. */
  baseline: ReadonlyArray<{ personaId: string; composite: number }>
  /**
   * Re-run callback — the substrate invokes this after applies. The
   * agent author provides their `runAgentEval`-equivalent so the
   * substrate can ask "score this persona slice now."
   *
   * The callback SHOULD reuse the same cohort + judges + variant as
   * the baseline run; only the agent's mutable surfaces have changed.
   */
  reRunCohort: (personaIds: ReadonlyArray<string>) => Promise<
    ReadonlyArray<{ personaId: string; composite: number }>
  >
  /** When `true`, applied edits are reverted on negative delta. Default `false`. */
  rollbackOnRegression?: boolean
  /** Callback to revert a list of paths (typically `git checkout HEAD --`). */
  revert?: (paths: ReadonlyArray<string>) => Promise<void>
}

/**
 * Run `runAnalystLoop` and stamp an `OutcomeMeasurement` onto the
 * result. The substrate calls this after each canonical eval; the
 * delta lands in `loop-report.json` for cross-run trend analysis.
 *
 * The function returns the original `RunAnalystLoopResult` enriched
 * with `outcome` so callers stay backwards-compatible (the field is
 * optional on the type; missing means no measurement was wired).
 */
export async function measureOutcome<TProposal, TEdit>(
  result: RunAnalystLoopResult<TProposal, TEdit>,
  opts: OutcomeMeasurementOpts,
): Promise<RunAnalystLoopResult<TProposal, TEdit> & { outcome: OutcomeMeasurement }> {
  const applied = result.knowledge?.applied ?? []
  const improvementsApplied = result.improvement?.applied ?? []
  const allApplied = [...applied, ...improvementsApplied]

  // No applies → no outcome to measure. Return a zero-delta to keep the
  // shape stable for consumers; baseline / after equal.
  if (allApplied.length === 0) {
    return {
      ...result,
      outcome: {
        baselineComposite: meanComposite(opts.baseline),
        afterComposite: meanComposite(opts.baseline),
        delta: 0,
        perPersona: opts.baseline.map((b) => ({
          personaId: b.personaId,
          before: b.composite,
          after: b.composite,
          delta: 0,
        })),
        rolledBackPaths: [],
      },
    }
  }

  const personaIds = opts.baseline.map((b) => b.personaId)
  const after = await opts.reRunCohort(personaIds)
  const afterByPersona = new Map(after.map((r) => [r.personaId, r.composite]))

  const perPersona = opts.baseline.map((b) => {
    const a = afterByPersona.get(b.personaId) ?? b.composite
    return { personaId: b.personaId, before: b.composite, after: a, delta: a - b.composite }
  })
  const baselineComposite = meanComposite(opts.baseline)
  const afterComposite = meanComposite(after)
  const delta = afterComposite - baselineComposite

  let rolledBackPaths: string[] = []
  if (delta < 0 && opts.rollbackOnRegression && opts.revert) {
    await opts.revert(allApplied)
    rolledBackPaths = [...allApplied]
  }

  return {
    ...result,
    outcome: {
      baselineComposite,
      afterComposite,
      delta,
      perPersona,
      rolledBackPaths,
    },
  }
}

function meanComposite(rows: ReadonlyArray<{ composite: number }>): number {
  if (rows.length === 0) return 0
  return rows.reduce((acc, r) => acc + r.composite, 0) / rows.length
}
