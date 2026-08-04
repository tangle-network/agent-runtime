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

import { pairedBootstrap, paretoFrontier } from '@tangle-network/agent-eval'
import type { RuntimeHooks } from '../runtime-hooks'
import { profileChatClient } from './profile-chat-client'
import {
  type AgenticOptions,
  type AgenticSurface,
  type AgenticTask,
  refine,
  runAgentic,
  type Strategy,
  sample,
} from './strategy'
import { concreteModelId } from './supervise/model-policy'

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
  /** Progress hook — fires as each task settles (the live-monitoring seam: append to a
   *  progress file, render a tree, stream to a dashboard). `done` counts settled tasks. */
  onTask?: (row: BenchmarkTaskRow, done: number, total: number) => void
  /** Lifecycle observability — every spawn/settle of every cell's shots/analysts streams
   *  here live (the watchdog/route-auditor seam, passed through to `runAgentic`). */
  hooks?: RuntimeHooks
  /**
   * Model availability check before tasks start.
   *
   * By default, live router workers send one one-token request per unique worker and analyst
   * model. Injected `worker.complete` transports skip the check. Pass `false` to disable it or a
   * callback to check each unique model through a custom transport.
   */
  modelPreflight?:
    | false
    | ((model: string, worker: Readonly<AgenticOptions>, signal: AbortSignal) => Promise<void>)
  /** Maximum time for each model availability check. Default 30 seconds. */
  modelPreflightTimeoutMs?: number
}

export interface BenchmarkLift {
  /** Mean of paired deltas (refine − sample). */
  mean: number
  low: number
  high: number
  n: number
}

/** One strategy's outcome on one task — the per-task cell an optimizer consumes. */
export interface BenchmarkCell {
  score: number
  resolved: boolean
  /** The progress curve (refine: score per shot; sample: best-so-far per rollout). */
  progression: number[]
  usd: number
  usdKnown: boolean
  ms: number
  tokens: { input: number; output: number }
  tokensKnown: boolean
}

export interface BenchmarkTaskRow {
  taskId: string
  /** Per-strategy cells; absent when the task errored before completing all strategies. */
  cells?: Record<string, BenchmarkCell>
  /** Per-strategy failures on this task: the strategy competed, threw, and scored an
   *  honest zero — it loses, it does not poison the row. The message is kept so a later
   *  generation's author can see WHY a candidate died. */
  errors?: Record<string, string>
  /** Why the task was excluded (infra/setup failure) — never silently dropped. */
  error?: string
}

export interface BenchmarkStrategySummary {
  /** Mean verifier score (0..1). */
  score: number
  /** Fraction of tasks fully resolved. */
  resolved: number
  /** Mean cost vector per task. */
  usd: number
  /** Fraction of task cells whose billed-dollar total was complete. */
  usdKnownRate: number
  ms: number
}

/** Benchmark output: per-strategy means plus the full per-task × per-strategy losses table an optimizer mines. */
export interface BenchmarkReport {
  n: number
  excluded: number
  /** Per-strategy means (keyed by strategy.name). */
  perStrategy: Record<string, BenchmarkStrategySummary>
  /** The full per-task × per-strategy table — the LOSSES an optimizer (GEPA, a
   *  strategy-author, an operator) consumes. Includes errored tasks with the reason. */
  perTask: BenchmarkTaskRow[]
  /** The non-dominated strategies on (score ↑, $/task ↓) — collapse-last, per the canon:
   *  a strategy that ties on score at half the cost WINS and a scalar would hide it. */
  pareto: string[]
  /** The headline when both `refine` and `sample` ran: paired-bootstrap lift of refine over sample. */
  refineVsSample?: BenchmarkLift
}

/** Bounded-concurrency map preserving order. */
async function pool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next
      next += 1
      out[i] = await fn(items[i] as T, i)
    }
  })
  await Promise.all(workers)
  return out
}

async function preflightModels(cfg: BenchmarkConfig): Promise<void> {
  if (cfg.modelPreflight === false) return
  if (cfg.worker.complete && !cfg.modelPreflight) return

  const profiles = [cfg.worker.workerProfile, cfg.worker.analystProfile ?? cfg.worker.workerProfile]
  const profilesByModel = new Map<string, (typeof profiles)[number]>()
  for (const [index, profile] of profiles.entries()) {
    const model = concreteModelId(profile.model?.default)
    if (!model) {
      throw new Error(
        `Benchmark ${index === 0 ? 'worker' : 'analyst'} AgentProfile.model.default must name an exact model`,
      )
    }
    if (!profilesByModel.has(model)) profilesByModel.set(model, profile)
  }
  const models = [...profilesByModel.keys()]
  const timeoutMs = cfg.modelPreflightTimeoutMs ?? 30_000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error('modelPreflightTimeoutMs must be a positive finite number')
  const check =
    cfg.modelPreflight ??
    (async (model: string, worker: Readonly<AgenticOptions>, signal: AbortSignal) => {
      const profile = profilesByModel.get(model)
      if (!profile) throw new Error(`Benchmark preflight has no AgentProfile for model ${model}`)
      await profileChatClient({
        profile,
        context: `runBenchmark model preflight (${model})`,
        executor: {
          backend: 'router',
          routerBaseUrl: worker.routerBaseUrl,
          routerKey: worker.routerKey,
        },
      }).chat({ model, messages: [{ role: 'user', content: 'Reply OK.' }] }, { signal })
    })

  const results = await Promise.allSettled(
    models.map(async (model) => {
      const controller = new AbortController()
      let timeoutError: Error | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          check(model, cfg.worker, controller.signal),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              timeoutError = new Error(`timed out after ${timeoutMs} ms`)
              controller.abort(timeoutError)
              reject(timeoutError)
            }, timeoutMs)
          }),
        ])
      } catch (cause) {
        const reported = timeoutError ?? cause
        const message = reported instanceof Error ? reported.message : String(reported)
        throw new Error(`Benchmark model "${model}" preflight failed: ${message}`, {
          cause: reported,
        })
      } finally {
        if (timer) clearTimeout(timer)
      }
    }),
  )

  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  )
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    const message = failures
      .map((failure) => (failure instanceof Error ? failure.message : String(failure)))
      .join('; ')
    throw new AggregateError(failures, message)
  }
}

/** Run the requested strategies over the tasks, scored by the Environment's own check.
 *  Resilient: a task whose rollouts fail (transient infra) is excluded from the stats but
 *  reported in `perTask` with the error — never silently dropped. */
export async function runBenchmark(cfg: BenchmarkConfig): Promise<BenchmarkReport> {
  const strategies = cfg.strategies ?? [sample, refine]
  const budget = cfg.budget ?? 3
  const concurrency = cfg.concurrency ?? 3

  await preflightModels(cfg)

  let settled = 0
  const perTask = await pool(cfg.tasks, concurrency, async (task): Promise<BenchmarkTaskRow> => {
    const cells: Record<string, BenchmarkCell> = {}
    const errors: Record<string, string> = {}
    let row: BenchmarkTaskRow
    try {
      // Per-strategy isolation: one strategy throwing (a broken authored candidate, a
      // hallucinated tool name) must not destroy the other strategies' cells for the
      // task. The thrower scores an honest zero — it competed, it failed, it loses.
      for (const s of strategies) {
        try {
          const r = await runAgentic({
            ...cfg.worker,
            surface: cfg.environment,
            task,
            strategy: s,
            budget,
            ...(cfg.hooks ? { hooks: cfg.hooks } : {}),
          })
          cells[s.name] = {
            score: r.score,
            resolved: r.resolved,
            progression: r.progression,
            usd: r.usd,
            usdKnown: r.usdKnown,
            ms: r.ms,
            tokens: r.tokens,
            tokensKnown: r.tokensKnown,
          }
        } catch (e) {
          errors[s.name] = e instanceof Error ? e.message.slice(0, 300) : String(e)
          cells[s.name] = {
            score: 0,
            resolved: false,
            progression: [],
            usd: 0,
            usdKnown: true,
            ms: 0,
            tokens: { input: 0, output: 0 },
            tokensKnown: true,
          }
        }
      }
      row = {
        taskId: task.id,
        cells,
        ...(Object.keys(errors).length > 0 ? { errors } : {}),
      }
    } catch (e) {
      row = { taskId: task.id, error: e instanceof Error ? e.message.slice(0, 300) : String(e) }
    }
    settled += 1
    cfg.onTask?.(row, settled, cfg.tasks.length)
    return row
  })

  const ok = perTask.filter(
    (r): r is BenchmarkTaskRow & { cells: Record<string, BenchmarkCell> } => !!r.cells,
  )
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)
  const perStrategy: Record<string, BenchmarkStrategySummary> = {}
  for (const s of strategies) {
    const cells = ok.map((r) => r.cells[s.name]).filter((c): c is BenchmarkCell => !!c)
    perStrategy[s.name] = {
      score: mean(cells.map((c) => c.score)),
      resolved: mean(cells.map((c) => (c.resolved ? 1 : 0))),
      usd: mean(cells.map((c) => c.usd)),
      usdKnownRate: mean(cells.map((c) => (c.usdKnown ? 1 : 0))),
      ms: mean(cells.map((c) => c.ms)),
    }
  }

  const frontier = paretoFrontier(
    Object.entries(perStrategy).map(([name, v]) => ({ name, score: v.score, usd: v.usd })),
    [
      { name: 'score', direction: 'maximize', value: (c) => c.score },
      { name: 'usd', direction: 'minimize', value: (c) => c.usd },
    ],
  ).frontier.map((c) => c.name)

  const report: BenchmarkReport = {
    n: ok.length,
    excluded: perTask.length - ok.length,
    perStrategy,
    perTask,
    pareto: frontier,
  }
  const names = strategies.map((s) => s.name)
  if (names.includes('refine') && names.includes('sample') && ok.length >= 2) {
    const b = pairedBootstrap(
      ok.map((r) => r.cells.sample?.score ?? 0),
      ok.map((r) => r.cells.refine?.score ?? 0),
    )
    report.refineVsSample = { mean: b.mean, low: b.low, high: b.high, n: b.n }
  }
  return report
}

/** Pretty-print a report — the "free optimization" verdict, with the cost vector. */
export function printBenchmarkReport(report: BenchmarkReport): void {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`
  const pp = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`
  console.log(
    `\n=== benchmark · n=${report.n}${report.excluded ? ` (excluded ${report.excluded})` : ''} ===`,
  )
  console.log(
    `  ${'strategy'.padEnd(16)} ${'score'.padStart(7)} ${'resolved'.padStart(9)} ${'$/task'.padStart(8)} ${'s/task'.padStart(7)}`,
  )
  for (const [s, v] of Object.entries(report.perStrategy))
    console.log(
      `  ${(report.pareto.includes(s) ? `${s} *` : s).padEnd(16)} ${pct(v.score).padStart(7)} ${pct(v.resolved).padStart(9)} ${`$${v.usd.toFixed(3)}`.padStart(8)} ${(v.ms / 1000).toFixed(0).padStart(6)}s`,
    )
  if (report.pareto.length) console.log(`  * = on the (score, $) Pareto frontier`)
  for (const row of report.perTask)
    if (row.error) console.log(`  ⚠ ${row.taskId}: ${row.error.slice(0, 120)}`)
  const l = report.refineVsSample
  if (l) {
    const sig = l.low > 0 ? 'SIGNIF +' : l.high < 0 ? 'SIGNIF -' : 'n.s.'
    console.log(`  refine − sample: ${pp(l.mean)}  CI [${pp(l.low)}, ${pp(l.high)}]  (${sig})`)
  }
}
