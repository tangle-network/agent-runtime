/**
 * `runBenchmarks` — the bench unifier.
 *
 * `gate.ts` runs ONE adapter as a diverse-vs-blind research gate through the recursive atom.
 * This is the other half it references: run a SUBSET of the registry's benchmarks over a MATRIX of
 * agent cells (harness × model × persona), each scored by the benchmark's OWN deterministic judge,
 * and return a ranked leaderboard. It is the "which harness/model/persona combination wins on which
 * benchmark" question, answered over an arbitrary subset in one call.
 *
 * It owns no new mechanism. Each cell is one `openSandboxRun` shot (the same per-run primitive the
 * SWE worker uses) driven by `resolveBenchClient` (off-box router completion OR in-box Sandbox; the
 * harness rides `sandboxOverrides.backend.type`). The deliverable is the adapter's OWN parser
 * (`adapter.output`), defaulting to the final answer text — so `runBenchmarks` needs no
 * per-benchmark branching. Concurrency is the shared `runPool`. The number comes from
 * `adapter.judge`, never a self-authored judge.
 *
 * Subset = the `benchmarks` and `cells` arrays plus `n`/`ids`/`split`. A benchmark whose
 * `preflight()` fails (missing Docker/venv/dataset) is recorded as unavailable and skipped — the
 * sweep never aborts because one bench's harness is absent.
 *
 *   const report = await runBenchmarks({
 *     benchmarks: ['humaneval', 'swe-bench'],
 *     cells: [
 *       { label: 'opencode/glm-4.6', model: 'glm-4.6', harness: 'opencode' },
 *       { label: 'codex/gpt-5',      model: 'gpt-5',    harness: 'codex'    },
 *     ],
 *     routerBaseUrl, routerKey, n: 20,
 *   })
 */

import type { AgentProfile, AgentRunSpec, Deliverable } from '@tangle-network/agent-runtime/loops'
import { openSandboxRun } from '@tangle-network/agent-runtime/loops'
import type { SandboxEvent } from '@tangle-network/sandbox'
import { resolveAdapter } from './adapters'
import type { BenchmarkAdapter, BenchScore, BenchTask } from './benchmarks/types'
import { resolveBenchClient } from './resolve-client'
import { runPool } from './run-pool'

/** One agent under test: a profile (prompt/tools/persona) plus the harness + model that run it. */
export interface BenchCell {
  /** Leaderboard row label, e.g. `opencode/glm-4.6` or `tax-agent@v1`. */
  readonly label: string
  /** Model id for this cell. */
  readonly model: string
  /** Coding harness for the in-box path (`opencode`/`codex`/`claude-code`/`kimi-code`). Defaults to
   *  `profile.metadata.backendType`, then `opencode`. Ignored on the `router` transport. */
  readonly harness?: string
  /** Transport: `router` (off-box completion, default), `sandbox`, or a BackendType for in-box. */
  readonly backend?: string
  /** Web-search provider for the `router` transport (turns the leaf into a `router-tools` loop). */
  readonly searchProvider?: string
  /** The agent under test. Defaults to a minimal `{ name, metadata.backendType }` profile. */
  readonly profile?: AgentProfile
}

/** Runs one (adapter, task, cell) shot and returns the deliverable text. The default uses
 *  `openSandboxRun`; tests inject a deterministic stub so the matrix runs offline. */
export type BenchShot = (input: {
  readonly adapter: BenchmarkAdapter
  readonly task: BenchTask
  readonly cell: BenchCell
  readonly routerBaseUrl: string
  readonly routerKey: string
  readonly sandboxBaseUrl?: string
  readonly timeoutMs?: number
}) => Promise<{ artifact: string; ok: boolean; detail?: string }>

export interface RunBenchmarksOptions {
  /** Registry keys (`resolveAdapter`) — the benchmark subset to run. */
  readonly benchmarks: readonly string[]
  /** The agent cells to rank. */
  readonly cells: readonly BenchCell[]
  readonly routerBaseUrl: string
  readonly routerKey: string
  readonly sandboxBaseUrl?: string
  /** Tasks per benchmark (the n). */
  readonly n?: number
  readonly ids?: string[]
  readonly split?: string
  /** Replicates per (benchmark × cell × task). Default 1. */
  readonly reps?: number
  /** Bounded concurrency across all shots. Default 4. */
  readonly concurrency?: number
  /** Per-shot wall-clock (ms). */
  readonly timeoutMs?: number
  /** Self-verify each benchmark's judge against its gold artifact on the first task before spending
   *  model tokens; a benchmark whose judge rejects its own gold is recorded unavailable. Default true. */
  readonly verifyJudge?: boolean
  /** Test seam: a deterministic shot runner. Defaults to the `openSandboxRun` leaf. */
  readonly runShot?: BenchShot
  /** Test seam: resolve a benchmark key to an adapter. Defaults to the registry `resolveAdapter`. */
  readonly resolveAdapter?: (key: string) => BenchmarkAdapter
  readonly onResult?: (r: BenchCellTaskResult) => void
}

export interface BenchCellTaskResult {
  readonly benchmark: string
  readonly cell: string
  readonly taskId: string
  readonly rep: number
  readonly resolved: boolean
  readonly score: number
  /** false = the shot threw or produced no artifact (infra/empty), excluded from the resolve
   *  denominator so a harness outage can't masquerade as a 0% capability result. */
  readonly ok: boolean
  readonly detail?: string
  readonly wallMs: number
}

export interface BenchLeaderboardRow {
  readonly benchmark: string
  readonly cell: string
  readonly n: number
  readonly resolved: number
  readonly errored: number
  /** resolved / (n - errored). */
  readonly resolveRate: number
  /** Mean graded score over non-errored shots (partial credit where the judge supports it). */
  readonly meanScore: number
}

export interface RunBenchmarksReport {
  /** One row per (benchmark × cell), sorted by benchmark then descending resolveRate. */
  readonly rows: readonly BenchLeaderboardRow[]
  readonly perTask: readonly BenchCellTaskResult[]
  readonly benchmarks: readonly string[]
  readonly cells: readonly string[]
  /** Benchmarks skipped because `preflight`/judge-self-check failed, with the reason. */
  readonly unavailable: ReadonlyArray<{ readonly benchmark: string; readonly reason: string }>
}

/** Last assistant text across the common event shapes (delta accumulation, then a terminal
 *  `result`/`done`/`agent` snapshot). The structured-deliverable case is handled by the adapter's
 *  own `output.parse`; this is the research/QA fallback. */
function finalText(events: readonly SandboxEvent[]): string {
  let text = ''
  for (const ev of events) {
    const e = ev as { type?: string; data?: Record<string, unknown> }
    const data = e.data ?? {}
    if (e.type === 'message.part.updated') {
      const part = data.part as { type?: string; text?: string } | undefined
      const partType = (data.partType as string | undefined) ?? part?.type
      if (partType === 'text') {
        if (typeof data.delta === 'string') text += data.delta
        else if (typeof part?.text === 'string') text = part.text
      }
    } else if (typeof data.finalText === 'string') text = data.finalText
    else if (typeof data.response === 'string') text = data.response
  }
  return text.trim()
}

/** The default real-agent shot: one `openSandboxRun` over the cell's harness+model, deliverable
 *  extracted by the adapter's parser (or final text), abortable on `timeoutMs`. */
const openSandboxShot: BenchShot = async ({ adapter, task, cell, routerBaseUrl, routerKey, sandboxBaseUrl, timeoutMs }) => {
  const client = resolveBenchClient({
    backend: cell.backend ?? 'router',
    routerBaseUrl,
    routerKey,
    model: cell.model,
    ...(sandboxBaseUrl ? { sandboxBaseUrl } : {}),
    ...(cell.searchProvider ? { searchProvider: cell.searchProvider } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
  })
  const harness = cell.harness ?? (cell.profile?.metadata?.backendType as string | undefined) ?? 'opencode'
  const profile: AgentProfile = cell.profile ?? { name: cell.label, metadata: { backendType: harness } }
  // Unique per shot: the same (adapter, task) runs concurrently across cells and reps, so the box
  // name and runId must not collide.
  const uniq = Math.random().toString(36).slice(2, 8)
  const agentRun: AgentRunSpec<string> = {
    profile,
    name: cell.label,
    taskToPrompt: () => '',
    sandboxOverrides: {
      name: `bench-${adapter.name}-${task.id}-${uniq}`.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 60),
      environment: 'universal',
      backend: { type: harness as never, model: { provider: 'openai', model: cell.model, baseUrl: routerBaseUrl } },
    },
  }
  const deliverable: Deliverable<string> = {
    kind: 'events',
    fromEvents: (events) => (adapter.output ? adapter.output.parse(events) : finalText(events)),
  }
  const controller = new AbortController()
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : undefined
  const run = await openSandboxRun(
    client,
    { agentRun, signal: controller.signal, runId: `bench:${adapter.name}:${task.id}:${uniq}`, scenarioId: task.id },
    deliverable,
  )
  try {
    const turn = await run.start(task.prompt)
    const artifact = (turn.out ?? '').trim()
    return {
      artifact,
      ok: artifact.length > 0,
      ...(turn.readError ? { detail: `read: ${turn.readError.slice(0, 160)}` } : {}),
    }
  } finally {
    if (timer) clearTimeout(timer)
    await run.close()
  }
}

interface Job {
  readonly benchmark: string
  readonly adapter: BenchmarkAdapter
  readonly cell: BenchCell
  readonly task: BenchTask
  readonly rep: number
}

/** Resolve + preflight + (optionally) self-verify each benchmark once; load its tasks. A benchmark
 *  whose harness is absent or whose judge rejects its own gold is recorded unavailable, not run. */
async function prepareBenchmarks(
  benchmarks: readonly string[],
  resolve: (key: string) => BenchmarkAdapter,
  opts: Pick<RunBenchmarksOptions, 'n' | 'ids' | 'split' | 'verifyJudge'>,
): Promise<{ ready: Array<{ benchmark: string; adapter: BenchmarkAdapter; tasks: BenchTask[] }>; unavailable: Array<{ benchmark: string; reason: string }> }> {
  const ready: Array<{ benchmark: string; adapter: BenchmarkAdapter; tasks: BenchTask[] }> = []
  const unavailable: Array<{ benchmark: string; reason: string }> = []
  for (const benchmark of benchmarks) {
    const adapter = resolve(benchmark) // throws on an unknown key — fail loud on a typo
    try {
      await adapter.preflight()
      const tasks = await adapter.loadTasks({
        ...(opts.n !== undefined ? { limit: opts.n } : {}),
        ...(opts.ids ? { ids: opts.ids } : {}),
        ...(opts.split ? { split: opts.split } : {}),
      })
      if (tasks.length === 0) {
        unavailable.push({ benchmark, reason: 'loadTasks returned no tasks' })
        continue
      }
      if (opts.verifyJudge !== false) {
        const gold = await adapter.goldArtifact(tasks[0]!)
        if (gold !== undefined) {
          const verdict = await adapter.judge(tasks[0]!, gold)
          if (!verdict.resolved) {
            unavailable.push({ benchmark, reason: `judge rejected its own gold on ${tasks[0]!.id} — judge is miscalibrated` })
            continue
          }
        }
      }
      ready.push({ benchmark, adapter, tasks })
    } catch (err) {
      unavailable.push({ benchmark, reason: err instanceof Error ? err.message : String(err) })
    }
  }
  return { ready, unavailable }
}

export async function runBenchmarks(opts: RunBenchmarksOptions): Promise<RunBenchmarksReport> {
  if (opts.benchmarks.length === 0) throw new Error('runBenchmarks: no benchmarks selected')
  if (opts.cells.length === 0) throw new Error('runBenchmarks: no cells to run')
  const reps = Math.max(1, opts.reps ?? 1)
  const shot = opts.runShot ?? openSandboxShot

  const { ready, unavailable } = await prepareBenchmarks(opts.benchmarks, opts.resolveAdapter ?? resolveAdapter, opts)

  const jobs: Job[] = []
  for (const { benchmark, adapter, tasks } of ready)
    for (const cell of opts.cells) for (const task of tasks) for (let rep = 0; rep < reps; rep += 1) jobs.push({ benchmark, adapter, cell, task, rep })

  const perTask: BenchCellTaskResult[] = []
  await runPool(jobs, Math.max(1, opts.concurrency ?? 4), async (job, index) => {
    const startedAt = Date.now()
    let result: BenchCellTaskResult
    try {
      const out = await shot({
        adapter: job.adapter,
        task: job.task,
        cell: job.cell,
        routerBaseUrl: opts.routerBaseUrl,
        routerKey: opts.routerKey,
        ...(opts.sandboxBaseUrl ? { sandboxBaseUrl: opts.sandboxBaseUrl } : {}),
        ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
      })
      const score: BenchScore = await job.adapter.judge(job.task, out.artifact)
      result = {
        benchmark: job.benchmark,
        cell: job.cell.label,
        taskId: job.task.id,
        rep: job.rep,
        resolved: out.ok && score.resolved,
        score: out.ok ? score.score : 0,
        ok: out.ok,
        ...(out.detail ?? score.detail ? { detail: out.detail ?? score.detail } : {}),
        wallMs: Date.now() - startedAt,
      }
    } catch (err) {
      // A thrown shot/judge is infra error for THIS cell-task: ok=false excludes it from the
      // resolve denominator (never a silent 0% that hides a harness outage).
      result = {
        benchmark: job.benchmark,
        cell: job.cell.label,
        taskId: job.task.id,
        rep: job.rep,
        resolved: false,
        score: 0,
        ok: false,
        detail: err instanceof Error ? err.message.slice(0, 200) : String(err),
        wallMs: Date.now() - startedAt,
      }
    }
    void index
    perTask.push(result)
    opts.onResult?.(result)
    return result
  })

  const rows = aggregate(perTask)
  return {
    rows,
    perTask,
    benchmarks: ready.map((r) => r.benchmark),
    cells: opts.cells.map((c) => c.label),
    unavailable,
  }
}

function aggregate(perTask: readonly BenchCellTaskResult[]): BenchLeaderboardRow[] {
  const byKey = new Map<string, { benchmark: string; cell: string; n: number; resolved: number; errored: number; scoreSum: number }>()
  for (const r of perTask) {
    const key = `${r.benchmark} ${r.cell}`
    const e = byKey.get(key) ?? { benchmark: r.benchmark, cell: r.cell, n: 0, resolved: 0, errored: 0, scoreSum: 0 }
    e.n += 1
    if (!r.ok) e.errored += 1
    else {
      if (r.resolved) e.resolved += 1
      e.scoreSum += r.score
    }
    byKey.set(key, e)
  }
  const rows: BenchLeaderboardRow[] = [...byKey.values()].map((e) => {
    const denom = Math.max(1, e.n - e.errored)
    return {
      benchmark: e.benchmark,
      cell: e.cell,
      n: e.n,
      resolved: e.resolved,
      errored: e.errored,
      resolveRate: e.resolved / denom,
      meanScore: e.scoreSum / denom,
    }
  })
  rows.sort((a, b) => (a.benchmark === b.benchmark ? b.resolveRate - a.resolveRate : a.benchmark < b.benchmark ? -1 : 1))
  return rows
}

/** Render the leaderboard as a fixed-width table for a CLI/log. */
export function printBenchmarksReport(report: RunBenchmarksReport): string {
  const lines: string[] = []
  const w = Math.max(8, ...report.rows.map((r) => r.cell.length))
  const b = Math.max(9, ...report.rows.map((r) => r.benchmark.length))
  lines.push(`${'benchmark'.padEnd(b)}  ${'cell'.padEnd(w)}  resolve   mean    n  err`)
  for (const r of report.rows)
    lines.push(
      `${r.benchmark.padEnd(b)}  ${r.cell.padEnd(w)}  ${(r.resolveRate * 100).toFixed(1).padStart(6)}%  ${r.meanScore.toFixed(3).padStart(5)}  ${String(r.n).padStart(3)}  ${String(r.errored).padStart(3)}`,
    )
  for (const u of report.unavailable) lines.push(`(skipped ${u.benchmark}: ${u.reason})`)
  return lines.join('\n')
}
