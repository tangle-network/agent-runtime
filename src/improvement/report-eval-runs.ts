/**
 * @experimental
 *
 * Wire the `exportEvalRuns` seam to its natural producer, `optimizePrompt`.
 *
 * `optimizePrompt` returns an `OptimizePromptResult` shaped almost exactly like
 * the Intelligence eval-run wire (`EvalRunEvent`): a baseline composite, a
 * per-generation candidate trajectory, a held-out lift, and a gate decision
 * whose enum is identical to `EvalRunEvent.gateDecision`. This module is the
 * thin, pure projection between them, plus an opt-in shipper — so an RSI run's
 * proposal→verdict provenance lands in the product instead of evaporating.
 *
 * Discipline:
 * - The gate decision is validated against the wire enum and FAILS LOUD on an
 *   unmapped value (a custom gate must translate first) — never a silent cast.
 * - Run economics (`totalCostUsd`/`totalDurationMs`) are REQUIRED from the
 *   caller, which measured them. The mapper does not invent a 0 cost.
 * - Shipping is opt-in (the caller calls `reportOptimizationRun`); `exportEvalRuns`
 *   itself throws on a missing key or network failure (no best-effort swallow).
 */

import type { CampaignResult, Scenario } from '@tangle-network/agent-eval/campaign'
import {
  type EvalRunEvent,
  type EvalRunGeneration,
  type EvalRunsExportConfig,
  type EvalRunsExportResult,
  exportEvalRuns,
} from '../otel-export'
import type { OptimizePromptResult } from './optimize-prompt'

/** The wire's `gateDecision` enum — identical to agent-eval's `GateDecision`,
 *  by design, so a `heldOutGate` decision passes through 1:1. */
const wireGateDecisions = new Set<EvalRunEvent['gateDecision']>([
  'ship',
  'hold',
  'need_more_work',
  'model_ceiling',
  'arch_ceiling',
])

/** Run-level facts the caller measured. Required so the exported event never
 *  carries fabricated economics. */
export interface OptimizationRunMeta {
  /** Stable run identity — also used as the Idempotency-Key (safe re-export). */
  runId: string
  /** Where the run's artifacts/traces live (opaque under in-memory storage). */
  runDir: string
  /** Measured total USD cost of the run. */
  totalCostUsd: number
  /** Measured wall-clock duration of the run. */
  totalDurationMs: number
  /** Extra provenance labels; merged over the derived defaults. */
  labels?: Record<string, string>
  /** Test seam — override the wall clock. */
  now?: () => Date
}

/** Mean composite over a campaign's per-scenario aggregates — the same reduction
 *  `optimizePrompt` uses to derive its baseline/winner composites. */
function meanComposite(campaign: CampaignResult<unknown, Scenario>): number {
  const scenarios = Object.values(campaign.aggregates.byScenario)
  if (scenarios.length === 0) return 0
  return scenarios.reduce((acc, s) => acc + s.meanComposite, 0) / scenarios.length
}

/**
 * Project an `OptimizePromptResult` onto the Intelligence eval-run wire as a
 * single `finished` event: baseline generation, the per-generation best-candidate
 * trajectory, the gate decision + held-out lift, and the winner's diff/rationale
 * as provenance on the winning generation.
 */
export function optimizePromptResultToEvalRunEvents<TArtifact, TScenario extends Scenario>(
  result: OptimizePromptResult<TArtifact, TScenario>,
  meta: OptimizationRunMeta,
): EvalRunEvent[] {
  if (!wireGateDecisions.has(result.decision as EvalRunEvent['gateDecision'])) {
    throw new Error(
      `optimizePromptResultToEvalRunEvents: gate decision "${result.decision}" is not a wire ` +
        `gateDecision (${[...wireGateDecisions].join(' | ')}) — a custom gate must map to one before export`,
    )
  }
  const timestamp = (meta.now ? meta.now() : new Date()).toISOString()
  const winnerHash = result.raw.winnerSurfaceHash

  // The baseline (identity) the gate protected — generation 0 on the wire.
  const baseline: EvalRunGeneration = {
    index: 0,
    surfaceHash: 'baseline',
    surface: { role: 'baseline' },
    compositeMean: result.baselineComposite,
    costUsd: 0,
    durationMs: 0,
  }

  // The reflective trajectory: one wire-generation per loop generation, scored
  // by that generation's best candidate (max mean-composite over its surfaces).
  const generations: EvalRunGeneration[] = result.raw.generations.map((gen, i) => {
    let bestHash = 'baseline'
    let bestComposite = Number.NEGATIVE_INFINITY
    for (const s of gen.surfaces) {
      const c = meanComposite(s.campaign as CampaignResult<unknown, Scenario>)
      if (c > bestComposite) {
        bestComposite = c
        bestHash = s.surfaceHash
      }
    }
    const isWinner = result.improved && bestHash === winnerHash
    const surface: Record<string, unknown> = { role: 'candidate', generation: i }
    if (isWinner) {
      surface.winner = true
      if (result.rationale) surface.rationale = result.rationale
      if (result.diff) surface.diff = result.diff
    }
    return {
      index: i + 1,
      surfaceHash: bestHash,
      surface,
      compositeMean: Number.isFinite(bestComposite) ? bestComposite : 0,
      costUsd: 0,
      durationMs: 0,
    }
  })

  const event: EvalRunEvent = {
    runId: meta.runId,
    runDir: meta.runDir,
    timestamp,
    status: 'finished',
    labels: {
      rsiImproved: String(result.improved),
      rsiDecision: result.decision,
      ...(meta.labels ?? {}),
    },
    baseline,
    generations,
    gateDecision: result.decision as EvalRunEvent['gateDecision'],
    holdoutLift: result.delta,
    totalCostUsd: meta.totalCostUsd,
    totalDurationMs: meta.totalDurationMs,
  }
  return [event]
}

/**
 * Opt-in: project an `optimizePrompt` run and ship it to Tangle Intelligence.
 * Throws on a missing API key or network failure (via `exportEvalRuns`); resolves
 * with the per-event ingest verdict so the caller can assert its provenance
 * landed. The `runId` doubles as the Idempotency-Key, so re-exporting a run is a
 * safe upsert.
 */
export async function reportOptimizationRun<TArtifact, TScenario extends Scenario>(
  result: OptimizePromptResult<TArtifact, TScenario>,
  meta: OptimizationRunMeta,
  config?: EvalRunsExportConfig,
): Promise<EvalRunsExportResult> {
  const events = optimizePromptResultToEvalRunEvents(result, meta)
  return exportEvalRuns(events, { idempotencyKey: meta.runId, ...config })
}
