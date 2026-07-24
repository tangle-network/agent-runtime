/**
 * anytimeReport — time-to-satisfactory-output metrics, derived entirely from the
 * waterfall's spans (no new instrumentation): per task, the best-so-far score after each
 * shot with its elapsed wall-clock and cumulative spend; per strategy, the standard
 * anytime-optimization metrics:
 *
 *   TTT  time-to-target — elapsed ms until best-so-far ≥ the target (per task; median
 *        over tasks that reached it)
 *   STT  shots-to-target — attempts until best-so-far ≥ target
 *   ERT  expected running time (the COCO benchmarking convention): TOTAL time spent
 *        across all tasks — including failures' full budgets — divided by the number of
 *        tasks that reached the target. The honest "how long per success, all-in".
 *   AUC  the anytime curve's area (mean best-so-far score across the budget, per shot
 *        index) — higher = climbs earlier.
 *
 * The "satisfactory" bar follows the COCO/BBOB convention: a SET of satisficing targets
 * (e.g. [0.5, 0.8, 1.0] on the normalized check score), each measured independently —
 * runtime-to-target per (task, target) pair — optionally overridden per task
 * (`targetFor`) when satisfaction is task-specific. Spans come from
 * `createWaterfallCollector().report()`; tasks are grouped by the supervisor runId
 * (`agentic:<strategy>:<taskId>`); shot spans are `shot:N` labels.
 */
import type { WaterfallSpan } from './waterfall'

export interface AnytimeTaskCurve {
  taskId: string
  strategy: string
  /** Best-so-far after each settled shot: elapsed ms from the task's first spawn,
   *  cumulative usd, and the running max score. */
  points: Array<{ elapsedMs: number; cumUsd: number; best: number }>
  /** Per satisficing target (keyed by the target value as a string): the first point
   *  where best ≥ target, or null when never reached within budget. */
  hits: Record<string, { ms: number; shots: number; usd: number } | null>
}

export interface AnytimeStrategySummary {
  strategy: string
  /** The satisficing target this row summarizes. */
  target: number
  tasks: number
  reachedTarget: number
  /** Median time-to-target over the tasks that reached it (null when none did). */
  medianTttMs: number | null
  medianShotsToTarget: number | null
  /** COCO ERT: Σ all task wall-time (incl. failures) / #successes. Null when 0 succeed. */
  ertMs: number | null
  /** Same construction over dollars: Σ all spend / #successes. */
  erUsd: number | null
  /** Mean best-so-far score by shot index (the anytime curve, averaged over tasks). */
  curveByShot: number[]
  /** Area under the per-shot anytime curve, normalized to [0,1]. */
  auc: number
}

export interface AnytimeReport {
  targets: number[]
  perTask: AnytimeTaskCurve[]
  /** One summary per (strategy, target) pair — the COCO-style multi-target view. */
  perStrategy: AnytimeStrategySummary[]
}

/**
 * The best-so-far fold — the ONE definition of "how good was the run after k results", shared by
 * the post-run anytime report below and by the LIVE progress-based stop rules
 * (`supervise/stop-rules.ts`). Given the observed objective per settled result in order, it returns
 * the running maximum. A result with no objective (`undefined` — it failed, or it was never
 * scored) carries the previous best forward rather than resetting it.
 *
 * It is extracted rather than duplicated on purpose: a stop rule that decides a run has plateaued
 * must agree, number for number, with the report that later says whether stopping was right.
 */
export function bestSoFar(values: ReadonlyArray<number | undefined>): number[] {
  const out: number[] = []
  let best = 0
  for (const v of values) {
    if (typeof v === 'number' && v > best) best = v
    out.push(best)
  }
  return out
}

/** Mean of a best-so-far curve — the anytime AUC when the curve is normalized to [0,1]. Higher =
 *  the run climbed earlier. Shared with the stop rules so "improving" means one thing. */
export function areaUnderCurve(curve: ReadonlyArray<number>): number {
  if (curve.length === 0) return 0
  return curve.reduce((s, v) => s + v, 0) / curve.length
}

/**
 * How many trailing entries of a best-so-far curve are within `minDelta` of the curve's value
 * `window` steps back — i.e. the length of the current PLATEAU, in settles. `0` means the most
 * recent settle improved the best by more than `minDelta`.
 *
 * The plateau math the live stop rules read. Defined here, beside the report that measures whether
 * the plateau was real, so there is exactly one notion of "not improving".
 */
export function plateauLength(curve: ReadonlyArray<number>, minDelta: number): number {
  if (curve.length === 0) return 0
  const last = curve[curve.length - 1] as number
  let i = curve.length - 1
  while (i > 0 && last - (curve[i - 1] as number) <= minDelta) i -= 1
  return curve.length - 1 - i
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2
}

/** Derive anytime metrics from waterfall spans. `targets` are the satisficing score
 *  bars (default [1] = fully resolved; COCO-style multi-target: [0.5, 0.8, 1]);
 *  `targetFor` overrides the bar per task (task-specific satisfaction) — when set, the
 *  per-task bar replaces every entry of `targets` for that task. */
export function anytimeReport(
  spans: WaterfallSpan[],
  opts?: { targets?: number[]; targetFor?: (taskId: string) => number },
): AnytimeReport {
  const targets = opts?.targets ?? [1]
  const byRun = new Map<string, WaterfallSpan[]>()
  for (const s of spans) {
    if (!s.label.startsWith('shot:')) continue
    const list = byRun.get(s.runId) ?? []
    list.push(s)
    byRun.set(s.runId, list)
  }

  const perTask: AnytimeTaskCurve[] = []
  for (const [runId, shots] of byRun) {
    const m = runId.match(/^agentic:(.+):(.+)$/)
    const strategy = m?.[1] ?? runId
    const taskId = m?.[2] ?? runId
    const ordered = [...shots].sort((a, b) => (a.endMs ?? a.startMs) - (b.endMs ?? b.startMs))
    const t0 = Math.min(...ordered.map((s) => s.startMs))
    const taskTargets = opts?.targetFor ? [opts.targetFor(taskId)] : targets
    // ONE best-so-far definition, shared with the live stop rules.
    const bests = bestSoFar(ordered.map((s) => (typeof s.score === 'number' ? s.score : undefined)))
    let cumUsd = 0
    const points: AnytimeTaskCurve['points'] = []
    const hits: AnytimeTaskCurve['hits'] = {}
    for (const t of taskTargets) hits[String(t)] = null
    for (const [i, s] of ordered.entries()) {
      cumUsd += s.usd
      const best = bests[i] as number
      const elapsedMs = (s.endMs ?? s.startMs) - t0
      points.push({ elapsedMs, cumUsd, best })
      for (const t of taskTargets) {
        if (hits[String(t)] === null && best >= t) {
          hits[String(t)] = { ms: elapsedMs, shots: points.length, usd: cumUsd }
        }
      }
    }
    perTask.push({ taskId, strategy, points, hits })
  }

  const byStrategy = new Map<string, AnytimeTaskCurve[]>()
  for (const t of perTask) {
    const list = byStrategy.get(t.strategy) ?? []
    list.push(t)
    byStrategy.set(t.strategy, list)
  }

  const perStrategy: AnytimeStrategySummary[] = []
  for (const [strategy, tasks] of byStrategy) {
    const totalMs = tasks.reduce((s, t) => s + (t.points[t.points.length - 1]?.elapsedMs ?? 0), 0)
    const totalUsd = tasks.reduce((s, t) => s + (t.points[t.points.length - 1]?.cumUsd ?? 0), 0)
    const maxShots = Math.max(0, ...tasks.map((t) => t.points.length))
    const curveByShot: number[] = []
    for (let i = 0; i < maxShots; i += 1) {
      // A task with fewer shots carries its final best forward (it stopped — its
      // best-so-far is what an operator would have at that point).
      const vals = tasks.map(
        (t) => (t.points[Math.min(i, t.points.length - 1)] as { best: number }).best,
      )
      curveByShot.push(vals.reduce((s, v) => s + v, 0) / vals.length)
    }
    const auc = areaUnderCurve(curveByShot)
    const summaryTargets = opts?.targetFor ? [Number.NaN] : targets
    for (const t of summaryTargets) {
      const key = (
        taskCurve: AnytimeTaskCurve,
      ): { ms: number; shots: number; usd: number } | null =>
        opts?.targetFor
          ? (Object.values(taskCurve.hits)[0] ?? null)
          : (taskCurve.hits[String(t)] ?? null)
      const reached = tasks.filter((x) => key(x) !== null)
      perStrategy.push({
        strategy,
        target: t,
        tasks: tasks.length,
        reachedTarget: reached.length,
        medianTttMs: median(reached.map((x) => (key(x) as { ms: number }).ms)),
        medianShotsToTarget: median(reached.map((x) => (key(x) as { shots: number }).shots)),
        ertMs: reached.length > 0 ? totalMs / reached.length : null,
        erUsd: reached.length > 0 ? totalUsd / reached.length : null,
        curveByShot,
        auc,
      })
    }
  }
  perStrategy.sort((a, b) => a.strategy.localeCompare(b.strategy) || a.target - b.target)
  return { targets, perTask, perStrategy }
}

/** One row per (strategy, satisficing target): the shareable time-to-satisfactory table. */
export function renderAnytimeTable(report: AnytimeReport): string {
  const lines = [
    `anytime metrics · satisficing targets [${report.targets.join(', ')}] · ERT = Σ all wall-time / #successes (COCO)`,
    'strategy            ≥tgt   reach   med-TTT   med-shots   ERT(all-in)   $/success   AUC   curve',
  ]
  for (const s of report.perStrategy) {
    const curve = s.curveByShot.map((v) => '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor(v * 8))]).join('')
    const tgt = Number.isNaN(s.target) ? 'task' : s.target.toFixed(2)
    lines.push(
      `${s.strategy.padEnd(19)} ${tgt.padStart(4)} ${String(s.reachedTarget).padStart(4)}/${String(s.tasks).padEnd(3)} ` +
        `${s.medianTttMs === null ? '      —' : `${(s.medianTttMs / 1000).toFixed(1).padStart(6)}s`}   ` +
        `${s.medianShotsToTarget === null ? '    —' : String(s.medianShotsToTarget).padStart(5)}   ` +
        `${s.ertMs === null ? '         —' : `${(s.ertMs / 1000).toFixed(1).padStart(9)}s`}   ` +
        `${s.erUsd === null ? '       —' : `$${s.erUsd.toFixed(4)}`}   ${s.auc.toFixed(2)}   ${curve}`,
    )
  }
  return lines.join('\n')
}
