/**
 * Replay CLI: `tsx src/swe-arena/replay.mts`
 *
 * Reproduces the reference `fixtures/analyze.py` output from the committed
 * fixtures (section 1 matches its printed lines exactly — pinned in
 * replay.test.mts), then prints what the reference script never did:
 * the reconciled valid-denominator verdict, the true SUP spend including
 * worker tokens, the supervisor evolution rounds, and the holdout registry.
 */

import { pathToFileURL } from 'node:url'
import {
  loadHoldout,
  loadLedger,
  loadPreregisterLog,
  loadRejudge,
  loadRematchRounds,
  loadSupJournalTrue,
  loadWorkerTokens,
} from './fixtures.ts'
import {
  costRollup,
  ledgerOutcomes,
  pairedSignTest,
  reconciledOutcomes,
  roundsProgression,
  splitPairs,
  type CostRollup,
  type DiscordantSplit,
  type RoundState,
  type SignTestResult,
} from './analyze.ts'
import { reconcile, type PairedTable } from './reconcile.ts'
import type { HoldoutRegistry, LedgerRow, RematchRow } from './types.ts'

/** Python-style list repr (single quotes) so section 1 matches analyze.py byte-for-byte. */
const pyList = (xs: string[]): string => `[${xs.map((x) => `'${x}'`).join(', ')}]`
const signed = (x: number, digits?: number): string =>
  (x >= 0 ? '+' : '') + (digits === undefined ? String(x) : x.toFixed(digits))

export interface Replay {
  ledger: LedgerRow[]
  raw: { split: DiscordantSplit; sign: SignTestResult; soloResolved: number; supResolved: number }
  cost: CostRollup
  table: PairedTable
  valid: { split: DiscordantSplit; sign: SignTestResult; soloResolved: number; supResolved: number }
  rounds: Map<string, RoundState[]>
  rematchRounds: RematchRow[][]
  holdout: HoldoutRegistry
  preregisterLog: string[]
}

export function buildReplay(): Replay {
  const ledger = loadLedger()
  const rejudge = loadRejudge()
  const rematchRounds = loadRematchRounds()

  const rawOutcomes = ledgerOutcomes(ledger)
  const table = reconcile(ledger, rejudge)
  const validOutcomes = reconciledOutcomes(table.valid)

  return {
    ledger,
    raw: {
      split: splitPairs(rawOutcomes),
      sign: pairedSignTest(rawOutcomes),
      soloResolved: rawOutcomes.filter((o) => o.solo).length,
      supResolved: rawOutcomes.filter((o) => o.sup).length,
    },
    cost: costRollup(ledger, loadSupJournalTrue(), loadWorkerTokens()),
    table,
    valid: {
      split: splitPairs(validOutcomes),
      sign: pairedSignTest(validOutcomes),
      soloResolved: validOutcomes.filter((o) => o.solo).length,
      supResolved: validOutcomes.filter((o) => o.sup).length,
    },
    rounds: roundsProgression(ledger, rematchRounds),
    rematchRounds,
    holdout: loadHoldout(),
    preregisterLog: loadPreregisterLog(),
  }
}

/** Section 1 — byte-faithful reproduction of analyze.py's printed analysis. */
export function renderReference(r: Replay): string[] {
  const rows = [...r.ledger].sort((a, b) => (a.iid < b.iid ? -1 : a.iid > b.iid ? 1 : 0))
  const n = rows.length
  const { raw, cost } = r
  const bar = '='.repeat(80)
  const lines: string[] = []
  lines.push(bar)
  lines.push(`PAIRED HEAD-TO-HEAD: glm-5.2 SOLO vs glm-5.2 SUPERVISOR  (N=${n} paired instances)`)
  lines.push(bar)
  lines.push(`SOLO resolved: ${raw.soloResolved}/${n} = ${((100 * raw.soloResolved) / n).toFixed(1)}%`)
  lines.push(`SUP  resolved: ${raw.supResolved}/${n} = ${((100 * raw.supResolved) / n).toFixed(1)}%`)
  const delta = raw.supResolved - raw.soloResolved
  lines.push(`delta (SUP-SOLO): ${signed(delta)} instances (${signed((100 * delta) / n, 1)} pts)`)
  lines.push('')
  lines.push('DISCORDANT PAIRS (the signal):')
  lines.push(`  SUP-only wins (SUP✓ SOLO✗): ${raw.split.supOnly.length}  ${pyList(raw.split.supOnly)}`)
  lines.push(`  SOLO-only wins (SOLO✓ SUP✗): ${raw.split.soloOnly.length}  ${pyList(raw.split.soloOnly)}`)
  lines.push(`  both resolved: ${raw.split.both.length}  |  neither: ${raw.split.neither.length}  ${pyList(raw.split.neither)}`)
  lines.push(`  exact two-sided sign test on discordant pairs: p=${raw.sign.pValue.toFixed(4)}`)
  lines.push('')
  lines.push(
    `COST (measured tokens; USD via shared blended rate $${(cost.blendedRatePerTok * 1e6).toFixed(3)}/1M from SUP accounting):`,
  )
  lines.push(`  SOLO total tokens: ${cost.soloTokens.toLocaleString('en-US')}  -> derived $${cost.soloUsdDerived.toFixed(4)}`)
  lines.push(`  SUP  total tokens: ${cost.supBrainTokens.toLocaleString('en-US')}  -> runtime $${cost.supUsd.toFixed(4)}`)
  lines.push(`  SUP/SOLO token ratio: ${cost.brainTokenRatio.toFixed(2)}x`)
  lines.push(`  SUP/SOLO cost ratio (token-derived): ${(cost.supUsd / cost.soloUsdDerived).toFixed(2)}x`)
  lines.push(`  [telemetry] instances where runtime spentTokens != journal-true (no-winner zeroing): ${pyList(cost.telemetryGaps)}`)
  lines.push(`  WALL: SOLO ${cost.soloWallS}s total vs SUP ${cost.supWallS}s total -> SUP ${cost.wallRatio.toFixed(2)}x wall`)
  lines.push('')
  lines.push(bar)
  lines.push('PER-INSTANCE')
  lines.push(bar)
  lines.push(
    `${'instance'.padEnd(32)} ${'SOLO'.padEnd(5)} ${'SUP'.padEnd(5)} ${'v_s'.padEnd(3)} ${'v_p'.padEnd(3)} ${'wrk'.padEnd(3)} ${'soloTok'.padEnd(8)} ${'supTok'.padEnd(8)} ${'supUSD'.padEnd(7)} ${'soloW'.padEnd(5)} ${'supW'.padEnd(5)}`,
  )
  for (const row of rows) {
    const pyBool = (v: boolean): string => (v ? 'True' : 'False')
    lines.push(
      `${row.iid.padEnd(32)} ${pyBool(row.solo_resolved).slice(0, 5).padEnd(5)} ${pyBool(row.sup_resolved).slice(0, 5).padEnd(5)} ` +
        `${pyBool(row.solo_verify_pass)[0].padEnd(3)} ${pyBool(row.sup_verify_pass)[0].padEnd(3)} ` +
        `${String(row.sup_workers ?? '?').padEnd(3)} ${String(row.solo_tokens).padEnd(8)} ${String(row.sup_spentTokens ?? 0).padEnd(8)} ` +
        `${(row.sup_spentUsd ?? 0).toFixed(4)} ${String(row.solo_wall_s).padEnd(5)} ${String(row.sup_wall_s).padEnd(5)}`,
    )
  }
  return lines
}

/** Sections 2-5 — the analysis that lived in session lore, now typed. */
export function renderReconciled(r: Replay): string[] {
  const bar = '='.repeat(80)
  const lines: string[] = []
  const { table, valid, cost } = r
  const n = table.valid.length

  lines.push(bar)
  lines.push('RECONCILED VERDICT (re-judged, gold-gated denominator)')
  lines.push(bar)
  for (const e of table.excluded) lines.push(`  EXCLUDED ${e.iid}: ${e.excludeReason}`)
  for (const v of table.valid) {
    const src = [v.solo.source !== 'ledger' ? `solo:${v.solo.source}` : null, v.sup.source !== 'ledger' ? `sup:${v.sup.source}` : null]
      .filter(Boolean)
      .join(' ')
    if (src) lines.push(`  RE-JUDGED ${v.iid}: ${src}`)
  }
  lines.push(`SOLO resolved: ${valid.soloResolved}/${n}`)
  lines.push(`SUP  resolved: ${valid.supResolved}/${n}`)
  lines.push(`discordant: SUP-only ${pyList(valid.split.supOnly)} | SOLO-only ${pyList(valid.split.soloOnly)}`)
  lines.push(`exact two-sided sign test: p=${valid.sign.pValue.toFixed(4)}`)
  lines.push('')
  lines.push('TRUE SUP SPEND (brain + workers; analyze.py printed brain only):')
  lines.push(`  brain ${cost.supBrainTokens.toLocaleString('en-US')} + workers ${cost.supWorkerTokens.toLocaleString('en-US')} = ${cost.supTotalTokens.toLocaleString('en-US')} tokens`)
  lines.push(`  SUP/SOLO true token ratio: ${cost.totalTokenRatio.toFixed(2)}x  (brain-only ratio: ${cost.brainTokenRatio.toFixed(2)}x)`)
  lines.push('')
  lines.push('SUP EVOLUTION ROUNDS (SUP = original head-to-head run):')
  for (const [iid, states] of r.rounds) {
    const cells = states.map(
      (s) => `${s.round}:${s.resolved ? 'RESOLVED' : 'unresolved'}(${s.patchLines}L,${s.verdict ?? 'null'})`,
    )
    lines.push(`  ${iid.padEnd(32)} ${cells.join(' -> ')}`)
  }
  lines.push('')
  lines.push(`HOLDOUT REGISTRY (pre-registered at loops@${r.holdout.selectedAtCommit.slice(0, 10)}, untouched):`)
  for (const e of r.holdout.entries) {
    lines.push(`  ${e.iid.padEnd(36)} gold_official_resolved=${e.gold_official_resolved} verify_calibrated=${e.verify_calibrated}`)
  }
  return lines
}

export function renderReplay(r: Replay = buildReplay()): string {
  return [...renderReference(r), '', ...renderReconciled(r)].join('\n')
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  console.log(renderReplay())
}
