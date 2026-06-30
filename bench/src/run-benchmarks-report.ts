/**
 * run-benchmarks-report — render a `runBenchmarks` result as a rich, multi-axis leaderboard (markdown +
 * SVG + HTML), with the BENCHMARKS as the axes. `runBenchmarks` (the registry matrix runner) already
 * returns a fixed-width CLI table; this bridges its per-task results into the domain-agnostic `leaderboard`
 * engine so the same run also yields a publishable board — every harness×model×persona cell scored on every
 * benchmark, the vals.ai-style surface.
 *
 * No new aggregation logic: it maps each `BenchCellTaskResult` into the universal `RunRecord` shape the
 * engine reads (cell → profile, benchmark → axis, score → score), then calls the shared renderers.
 * Errored shots (`ok:false`) are dropped, exactly as the runner excludes them from its own denominator.
 */
import type { RunRecord } from '@tangle-network/agent-eval'
import {
  type Leaderboard,
  leaderboard,
  renderLeaderboardHtml,
  renderLeaderboardMarkdown,
  renderLeaderboardSvg,
} from '@tangle-network/agent-runtime/loops'
import type { BenchCellTaskResult, RunBenchmarksReport } from './run-benchmarks'

/** Project the runner's per-task results into `RunRecord`s the leaderboard engine reads. Cost/tokens are
 *  left at 0 — `runBenchmarks` does not meter them per task, so the board shows them as not-captured rather
 *  than inventing a number. */
function toRecords(perTask: readonly BenchCellTaskResult[]): RunRecord[] {
  return perTask
    .filter((t) => t.ok)
    .map(
      (t) =>
        ({
          runId: `${t.benchmark}:${t.cell}:${t.taskId}:${t.rep}`,
          experimentId: t.benchmark,
          candidateId: t.cell,
          seed: t.rep,
          // The cell label is `harness/model` (or a persona id); carry it as the model + harness so the
          // leaderboard's default profile key resolves to the cell.
          model: t.cell,
          promptHash: '',
          configHash: '',
          commitSha: '',
          wallMs: t.wallMs,
          costUsd: 0,
          tokenUsage: { input: 0, output: 0 },
          outcome: { holdoutScore: t.score, raw: { resolved: t.resolved ? 1 : 0 } },
          splitTag: 'holdout',
          scenarioId: t.benchmark,
          agentProfile: { harness: t.cell.split('/')[0] ?? t.cell, model: t.cell },
        }) as unknown as RunRecord,
    )
}

/** Build the rich leaderboard from a `runBenchmarks` result — benchmarks are the axes, cells are the rows. */
export function benchmarksLeaderboard(
  report: RunBenchmarksReport,
  opts: { title?: string; meta?: Record<string, string> } = {},
): Leaderboard {
  return leaderboard(toRecords(report.perTask), {
    title: opts.title ?? 'Benchmark matrix — cell × benchmark',
    // The cell (harness/model/persona) is the row label; one column per benchmark.
    profileKeyOf: (r) => r.candidateId,
    groupOf: (r) => r.scenarioId ?? r.experimentId,
    ...(opts.meta ? { meta: opts.meta } : {}),
  })
}

export { renderLeaderboardHtml, renderLeaderboardMarkdown, renderLeaderboardSvg }
