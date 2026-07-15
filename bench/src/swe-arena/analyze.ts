/**
 * Typed port of the reference `fixtures/analyze.py` statistics: discordant
 * pair extraction, exact two-sided sign test, and cost rollups.
 *
 * The sign test is NOT re-implemented: `mcnemar` from
 * `@tangle-network/agent-eval` computes the identical exact two-sided
 * binomial p on discordant pairs (`min(1, 2·P(X ≤ min(b,c)))`, X ~
 * Binomial(b+c, 0.5)) — the same formula as `analyze.py::sign_test`.
 *
 * Token accounting has TWO deliberately distinct rollups:
 *  - `supBrainTokens` — what analyze.py prints as "SUP total tokens":
 *    supervisor-journal metered spend (the supervisor "brain"), journal-true
 *    where captured, else the runtime's `sup_spentTokens`.
 *  - `supTotalTokens` — brain + worker-session tokens (worker-tokens.json).
 *    This is the true SUP-arm spend (1,722,390 for the 12-run set) and the
 *    number the 2.55x SUP/SOLO ratio refers to. analyze.py never printed it;
 *    its printed 0.83x ratio is brain-only.
 */

import { mcnemar } from '@tangle-network/agent-eval'
import type { ReconciledInstance } from './reconcile'
import type { LedgerRow, RematchRow, WorkerTokens } from './types'

export interface PairedOutcome {
  iid: string
  solo: boolean
  sup: boolean
}

/** Raw ledger outcomes — analyze.py semantics (strict `is True`), sorted by iid. */
export function ledgerOutcomes(ledger: LedgerRow[]): PairedOutcome[] {
  return [...ledger]
    .sort((a, b) => (a.iid < b.iid ? -1 : a.iid > b.iid ? 1 : 0))
    .map((r) => ({ iid: r.iid, solo: r.solo_resolved === true, sup: r.sup_resolved === true }))
}

/** Reconciled (re-judged, gold-gated) outcomes, sorted by iid. */
export function reconciledOutcomes(instances: ReconciledInstance[]): PairedOutcome[] {
  return [...instances]
    .sort((a, b) => (a.iid < b.iid ? -1 : a.iid > b.iid ? 1 : 0))
    .map((r) => ({ iid: r.iid, solo: r.solo.resolved, sup: r.sup.resolved }))
}

export interface DiscordantSplit {
  /** SUP resolved, SOLO not. */
  supOnly: string[]
  /** SOLO resolved, SUP not. */
  soloOnly: string[]
  both: string[]
  neither: string[]
}

export function splitPairs(outcomes: PairedOutcome[]): DiscordantSplit {
  const supOnly: string[] = []
  const soloOnly: string[] = []
  const both: string[] = []
  const neither: string[] = []
  for (const o of outcomes) {
    if (o.sup && !o.solo) supOnly.push(o.iid)
    else if (o.solo && !o.sup) soloOnly.push(o.iid)
    else if (o.solo && o.sup) both.push(o.iid)
    else neither.push(o.iid)
  }
  return { supOnly, soloOnly, both, neither }
}

export interface SignTestResult {
  n: number
  /** Discordant pairs where SUP (treatment) won. */
  b: number
  /** Discordant pairs where SOLO (control) won. */
  c: number
  nDiscordant: number
  /** Exact two-sided binomial sign-test p on discordant pairs. */
  pValue: number
}

/** Exact paired sign test, SOLO as control and SUP as treatment. */
export function pairedSignTest(outcomes: PairedOutcome[]): SignTestResult {
  const result = mcnemar(
    outcomes.map((o) => o.solo),
    outcomes.map((o) => o.sup),
  )
  const { n, b, c, nDiscordant, pValue } = result
  return { n, b, c, nDiscordant, pValue }
}

export interface CostRollup {
  soloTokens: number
  /** analyze.py's "SUP total tokens": journal-true brain spend, else sup_spentTokens. */
  supBrainTokens: number
  /** Σ worker-session tokens (worker-tokens.json; instances without workers contribute 0). */
  supWorkerTokens: number
  /** Brain + workers — the true SUP-arm token spend. */
  supTotalTokens: number
  supUsd: number
  /** Blended $ per token from SUP runtime accounting (analyze.py's `rate`). */
  blendedRatePerTok: number
  soloUsdDerived: number
  /** supBrainTokens / soloTokens — the ratio analyze.py prints (0.83x). */
  brainTokenRatio: number
  /** supTotalTokens / soloTokens — the true-spend ratio (2.55x). */
  totalTokenRatio: number
  soloWallS: number
  supWallS: number
  wallRatio: number
  /** iids where the runtime's sup_spentTokens disagrees with journal-true (no-winner zeroing). */
  telemetryGaps: string[]
}

/**
 * Port of analyze.py's cost section over the full ledger (all 12 paired runs
 * — cost is a property of the runs, not of the gradeable subset), extended
 * with the worker-token rollup.
 */
export function costRollup(
  ledger: LedgerRow[],
  supJournalTrue: Record<string, number | null>,
  workerTokens: Record<string, WorkerTokens>,
): CostRollup {
  const rows = [...ledger].sort((a, b) => (a.iid < b.iid ? -1 : a.iid > b.iid ? 1 : 0))
  let soloTokens = 0
  let supBrainTokens = 0
  let supUsd = 0
  let soloWallS = 0
  let supWallS = 0
  const telemetryGaps: string[] = []
  for (const r of rows) {
    soloTokens += r.solo_tokens
    const journalTrue = supJournalTrue[r.iid] ?? null
    supBrainTokens += journalTrue ?? r.sup_spentTokens ?? 0
    supUsd += r.sup_spentUsd ?? 0
    soloWallS += r.solo_wall_s
    supWallS += r.sup_wall_s
    if (journalTrue !== null && (r.sup_spentTokens ?? 0) !== journalTrue) telemetryGaps.push(r.iid)
  }
  const supWorkerTokens = Object.values(workerTokens).reduce((s, w) => s + w.worker_tok, 0)
  const supTotalTokens = supBrainTokens + supWorkerTokens
  const blendedRatePerTok = supBrainTokens > 0 ? supUsd / supBrainTokens : 0
  return {
    soloTokens,
    supBrainTokens,
    supWorkerTokens,
    supTotalTokens,
    supUsd,
    blendedRatePerTok,
    soloUsdDerived: soloTokens * blendedRatePerTok,
    brainTokenRatio: soloTokens > 0 ? supBrainTokens / soloTokens : 0,
    totalTokenRatio: soloTokens > 0 ? supTotalTokens / soloTokens : 0,
    soloWallS,
    supWallS,
    wallRatio: soloWallS > 0 ? supWallS / soloWallS : 0,
    telemetryGaps,
  }
}

/** Round label for the original head-to-head SUP run in the ledger. */
export type SupRound = 'SUP' | 'SUP2' | 'SUP3' | 'SUP4'

export interface RoundState {
  round: SupRound
  resolved: boolean
  verifyPass: boolean
  patchLines: number
  verdict: 'delivered' | 'no-winner' | 'best-effort' | null
  delivered: boolean | null
  spentTokens: number | null
}

/**
 * Supervisor evolution progression: the original SUP run (round 0, from the
 * ledger) followed by each rematch round, for every instance that appears in
 * at least one rematch file.
 */
export function roundsProgression(
  ledger: LedgerRow[],
  rounds: RematchRow[][],
): Map<string, RoundState[]> {
  const byIid = new Map<string, RoundState[]>()
  const rematchIids = new Set(rounds.flat().map((r) => r.iid))
  for (const r of ledger) {
    if (!rematchIids.has(r.iid)) continue
    byIid.set(r.iid, [
      {
        round: 'SUP',
        resolved: r.sup_resolved === true,
        verifyPass: r.sup_verify_pass === true,
        patchLines: r.sup_patch_lines,
        verdict: r.sup_verdict,
        delivered: r.sup_delivered,
        spentTokens: r.sup_spentTokens,
      },
    ])
  }
  for (const round of rounds) {
    for (const r of round) {
      const states = byIid.get(r.iid)
      if (!states) throw new Error(`rematch row for ${r.iid} has no ledger baseline`)
      states.push({
        round: r.arm,
        resolved: r.resolved === true,
        verifyPass: r.verify_pass === true,
        patchLines: r.patch_lines,
        verdict: r.sup_verdict,
        delivered: r.delivered,
        spentTokens: r.spentTokens,
      })
    }
  }
  return byIid
}
