/**
 * runBenchmark — the packaged optimization suite. Define a domain by implementing an
 * `Environment` (open / tools / call / score / close); get the optimization strategies
 * compared, scored by your own deployable check, with a paired-bootstrap report — free.
 *
 * The mental model: you have a TASK + a deployable CHECK + a compute BUDGET. A strategy
 * is how you spend the budget to beat the check. Two built-ins:
 *
 *   sample  — N independent attempts, keep the best-verifying one.   (best-of-N / resample)
 *   refine  — attempt → a critic reads the trace → steer the next → repeat. (iterate-with-feedback)
 *
 * Both run at equal budget through the Supervisor's conserved pool; the headline is the
 * paired lift of refine over sample. Author your own strategy with `defineStrategy`.
 */

import { pairedBootstrap } from '@tangle-network/agent-eval'
import {
  type AgenticOptions,
  type AgenticSurface,
  type AgenticTask,
  refine,
  runAgentic,
  type Strategy,
  sample,
} from './strategy'

/** A checkable task domain — implement these 5 hooks and the suite does the rest. The
 *  same seam as `AgenticSurface`; `Environment` is the RL/gym-standard name for it. */
export type Environment = AgenticSurface

export interface BenchmarkConfig {
  /** The task domain (5 hooks). */
  environment: Environment
  /** The tasks to score across. */
  tasks: AgenticTask[]
  /** The worker: model + router + (optional) the critic's instruction (the steerer knob). */
  worker: AgenticOptions
  /** Which strategies to compare. Pass the built-ins (`refine`, `sample`) or your own.
   *  Default: [sample, refine]. */
  strategies?: Strategy[]
  /** Shots (refine) / width (sample) — the equal compute budget per strategy. Default 3. */
  budget?: number
  /** Tasks scored in parallel. Default 3. */
  concurrency?: number
}

export interface BenchmarkLift {
  /** Mean of paired deltas (refine − sample). */
  mean: number
  low: number
  high: number
  n: number
}

export interface BenchmarkReport {
  n: number
  excluded: number
  /** Mean verifier score per strategy (keyed by strategy.name, 0..1). */
  perStrategy: Record<string, number>
  /** The headline when both `refine` and `sample` ran: paired-bootstrap lift of refine over sample. */
  refineVsSample?: BenchmarkLift
}

/** Bounded-concurrency map preserving order; a worker that throws resolves its slot to null. */
async function pool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R | null>,
): Promise<Array<R | null>> {
  const out: Array<R | null> = new Array(items.length).fill(null)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next
      next += 1
      try {
        out[i] = await fn(items[i] as T, i)
      } catch {
        out[i] = null
      }
    }
  })
  await Promise.all(workers)
  return out
}

/** Run the requested strategies over the tasks, scored by the Environment's own check.
 *  Resilient: a task whose rollouts fail (transient infra) is excluded, not fatal. */
export async function runBenchmark(cfg: BenchmarkConfig): Promise<BenchmarkReport> {
  const strategies = cfg.strategies ?? [sample, refine]
  const budget = cfg.budget ?? 3
  const concurrency = cfg.concurrency ?? 3

  const rows = await pool(cfg.tasks, concurrency, async (task) => {
    const scores: Record<string, number> = {}
    for (const s of strategies) {
      const r = await runAgentic({
        ...cfg.worker,
        surface: cfg.environment,
        task,
        strategy: s,
        budget,
      })
      scores[s.name] = r.score
    }
    return scores
  })

  const ok = rows.filter((r): r is Record<string, number> => r !== null)
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)
  const perStrategy: Record<string, number> = {}
  for (const s of strategies) perStrategy[s.name] = mean(ok.map((r) => r[s.name] ?? 0))

  const report: BenchmarkReport = { n: ok.length, excluded: rows.length - ok.length, perStrategy }
  const names = strategies.map((s) => s.name)
  if (names.includes('refine') && names.includes('sample') && ok.length >= 2) {
    const b = pairedBootstrap(
      ok.map((r) => r.sample ?? 0),
      ok.map((r) => r.refine ?? 0),
    )
    report.refineVsSample = { mean: b.mean, low: b.low, high: b.high, n: b.n }
  }
  return report
}

/** Pretty-print a report — the "free optimization" verdict. */
export function printBenchmarkReport(report: BenchmarkReport): void {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`
  const pp = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`
  console.log(
    `\n=== benchmark · n=${report.n}${report.excluded ? ` (excluded ${report.excluded})` : ''} ===`,
  )
  for (const [s, v] of Object.entries(report.perStrategy))
    console.log(`  ${s.padEnd(8)} ${pct(v ?? 0)}`)
  const l = report.refineVsSample
  if (l) {
    const sig = l.low > 0 ? 'SIGNIF +' : l.high < 0 ? 'SIGNIF -' : 'n.s.'
    console.log(`  refine − sample: ${pp(l.mean)}  CI [${pp(l.low)}, ${pp(l.high)}]  (${sig})`)
  }
}
