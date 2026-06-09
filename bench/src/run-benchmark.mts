/**
 * runBenchmark — the packaged optimization suite. Define a domain by implementing an
 * Environment (open / tools / call / score / close); get the optimization strategies
 * compared, scored by your own deployable check, with a paired-bootstrap report — FREE.
 *
 * The mental model: you have a TASK + a deployable CHECK + a compute BUDGET. An
 * optimization STRATEGY is how you spend the budget to beat the check. Two primitives:
 *
 *   sample  — N independent attempts, keep the best-verifying one.   ("best-of-N" / resample)
 *   refine  — attempt → a critic reads the trace → steer the next → repeat. (iterate-with-feedback)
 *
 * Both run at equal budget; the headline is the paired lift of refine over sample.
 * (Internally `sample`→breadth, `refine`→depth on the canonical Supervisor+observe loop.)
 *
 * Juniors call runBenchmark and read the report. Seniors customize the HOOKS: the critic
 * (worker.analystInstruction — observe()'s prompt), the check (Environment.score), the
 * worker (the model), and can drop to runAgentic / the Supervisor for new strategies.
 */
import { type AgenticOptions, type AgenticSurface, type AgenticTask, runAgentic } from './agentic'
import { type PairedLift, pairedLift, pool } from './stats.mts'

/** A checkable task domain — implement these 5 hooks and the suite does the rest. The
 *  same seam as `AgenticSurface`; `Environment` is the RL/gym-standard name for it. */
export type Environment = AgenticSurface

/** How to spend the compute budget to beat the Environment's check. */
export type Strategy = 'sample' | 'refine'
const modeForStrategy = { sample: 'breadth', refine: 'depth' } as const

export interface BenchmarkConfig {
  /** The task domain (5 hooks). */
  environment: Environment
  /** The tasks to score across. */
  tasks: AgenticTask[]
  /** The worker: model + router + (optional) the critic's instruction (the steerer knob). */
  worker: AgenticOptions
  /** Which strategies to compare. Default: both. */
  strategies?: Strategy[]
  /** Shots (refine) / width (sample) — the equal compute budget per strategy. Default 3. */
  budget?: number
  /** Tasks scored in parallel. Default 3. */
  concurrency?: number
}

export interface BenchmarkReport {
  n: number
  excluded: number
  /** Mean verifier score per strategy (0..1). */
  perStrategy: Partial<Record<Strategy, number>>
  /** The headline: paired lift of refine over sample (present when both ran). */
  refineVsSample?: PairedLift
}

/** Run the requested strategies over the tasks, scored by the Environment's own check,
 *  and return the per-strategy means + the paired-bootstrap lift of refine over sample.
 *  Resilient: a task whose rollouts fail (transient infra) is excluded, not fatal. */
export async function runBenchmark(cfg: BenchmarkConfig): Promise<BenchmarkReport> {
  const strategies = cfg.strategies ?? ['sample', 'refine']
  const budget = cfg.budget ?? 3
  const concurrency = cfg.concurrency ?? 3

  const rows = await pool(cfg.tasks, concurrency, async (task) => {
    const scores: Partial<Record<Strategy, number>> = {}
    try {
      for (const s of strategies) {
        const r = await runAgentic({ ...cfg.worker, surface: cfg.environment, task, mode: modeForStrategy[s], budget })
        scores[s] = r.score
      }
      return scores
    } catch {
      return null // transient infra on this task — exclude it
    }
  })

  const ok = rows.filter((r): r is Partial<Record<Strategy, number>> => r !== null)
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)
  const perStrategy: Partial<Record<Strategy, number>> = {}
  for (const s of strategies) perStrategy[s] = mean(ok.map((r) => r[s] ?? 0))

  const report: BenchmarkReport = { n: ok.length, excluded: rows.length - ok.length, perStrategy }
  if (strategies.includes('refine') && strategies.includes('sample')) {
    report.refineVsSample = pairedLift(ok.map((r) => r.sample ?? 0), ok.map((r) => r.refine ?? 0))
  }
  return report
}

/** Pretty-print a report — the "free optimization" verdict. */
export function printBenchmarkReport(report: BenchmarkReport): void {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`
  const pp = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`
  console.log(`\n=== benchmark · n=${report.n}${report.excluded ? ` (excluded ${report.excluded})` : ''} ===`)
  for (const [s, v] of Object.entries(report.perStrategy)) console.log(`  ${s.padEnd(8)} ${pct(v ?? 0)}`)
  const l = report.refineVsSample
  if (l) {
    const sig = l.low > 0 ? 'SIGNIF +' : l.high < 0 ? 'SIGNIF -' : 'n.s.'
    console.log(`  refine − sample: ${pp(l.point)}  CI [${pp(l.low)}, ${pp(l.high)}]  (${sig})`)
  }
}
