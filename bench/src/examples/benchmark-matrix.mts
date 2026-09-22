/**
 * Rank a set of AI agents across a set of public benchmarks, and print a leaderboard.
 *
 * A "cell" is one agent = a coding harness (opencode, Codex, a bare router call) + a model.
 * Each benchmark (humaneval, swe-bench, terminal-bench, …) brings its OWN deterministic
 * grader, so the score is the benchmark's, not one we invented. Pick the benchmarks with
 * the BENCHMARKS env var; edit the `cells` array below to change who competes.
 *
 * Run from bench/:
 *   # offline demo (no creds): a stub benchmark + stub agent prove the pipeline end to end
 *   tsx src/examples/benchmark-matrix.mts
 *
 *   # live: real benchmarks graded by their real graders
 *   TANGLE_API_KEY=... BENCHMARKS=humaneval tsx src/examples/benchmark-matrix.mts
 */
import { createTangleProvider } from '@tangle-network/agent-provider-tangle'
import { routerEnvironmentProvider } from '@tangle-network/agent-runtime/loops'
import { Sandbox } from '@tangle-network/sandbox'
import type { BenchmarkAdapter, BenchScore, BenchTask } from '../benchmarks/types'
import {
  type BenchCell,
  type BenchShot,
  printBenchmarksReport,
  runBenchmarks,
} from '../run-benchmarks'

/** The matrix: three cells spanning harnesses, models, and transports. */
const cells: BenchCell[] = [
  { label: 'opencode/glm-4.6', harness: 'opencode', model: 'glm-4.6' },
  { label: 'codex/gpt-5', harness: 'codex', model: 'gpt-5' },
  { label: 'router/deepseek-v4-flash', model: 'deepseek-v4-flash' },
]

async function live(): Promise<void> {
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = process.env.TANGLE_API_KEY!
  const sandboxProvider = createTangleProvider({
    client: new Sandbox({
      baseUrl: process.env.SANDBOX_BASE ?? 'https://sandbox.tangle.tools',
      apiKey: routerKey,
    }) as never,
  })
  const liveCells: BenchCell[] = [
    { ...cells[0]!, provider: sandboxProvider },
    { ...cells[1]!, provider: sandboxProvider },
    {
      ...cells[2]!,
      provider: routerEnvironmentProvider({
        name: 'router-deepseek-v4-flash',
        routerBaseUrl,
        routerKey,
        model: cells[2]!.model,
      }),
      environment: {},
    },
  ]
  const benchmarks = (process.env.BENCHMARKS ?? 'humaneval')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const report = await runBenchmarks({
    benchmarks,
    cells: liveCells,
    routerBaseUrl,
    routerKey,
    n: Number(process.env.N ?? 10),
    concurrency: Number(process.env.CONCURRENCY ?? 4),
    onResult: (r) =>
      console.log(
        `  [${r.ok ? (r.resolved ? 'PASS' : 'fail') : 'ERR '}] ${r.benchmark} ${r.cell} ${r.taskId}`,
      ),
  })
  console.log(`\n=== live: ${report.benchmarks.join(', ')} × ${report.cells.length} cells ===`)
  console.log(printBenchmarksReport(report))
}

/** Offline proof: a stub registry whose judge is deterministic, and a stub shot whose "ability"
 *  differs per cell — so the leaderboard ORDER reflects the cells, with no model or sandbox. */
async function demo(): Promise<void> {
  const stub = (name: string, n: number): BenchmarkAdapter => ({
    name,
    preflight: async () => {},
    loadTasks: async (o) =>
      Array.from({ length: o?.limit ?? n }, (_, i) => ({
        id: `${name}-${i}`,
        prompt: `task ${i}`,
        metadata: { gold: `G-${name}-${i}` },
      })),
    judge: async (t: BenchTask, a: string): Promise<BenchScore> => ({
      resolved: a === t.metadata?.gold,
      score: a === t.metadata?.gold ? 1 : 0,
    }),
    goldArtifact: async (t: BenchTask) => String(t.metadata?.gold),
  })
  const registry: Record<string, BenchmarkAdapter> = {
    'demo-coding': stub('demo-coding', 8),
    'demo-research': stub('demo-research', 8),
  }

  // Cell ability: opencode/glm solves the most, router the least — deterministic by task index.
  const ability: Record<string, number> = {
    'opencode/glm-4.6': 0.88,
    'codex/gpt-5': 0.62,
    'router/deepseek-v4-flash': 0.38,
  }
  const shot: BenchShot = async ({ task, cell }) => {
    const idx = Number(task.id.split('-').pop())
    const solves = idx / 8 < (ability[cell.label] ?? 0.5)
    return { artifact: solves ? String(task.metadata?.gold) : 'WRONG', ok: true }
  }

  const report = await runBenchmarks({
    benchmarks: ['demo-coding', 'demo-research'],
    cells,
    routerBaseUrl: 'demo',
    routerKey: 'demo',
    runShot: shot,
    resolveAdapter: (k) => {
      const a = registry[k]
      if (!a) throw new Error(`unknown: ${k}`)
      return a
    },
  })
  console.log('=== offline demo: 2 benchmarks × 3 cells (stub judge, no creds) ===')
  console.log(printBenchmarksReport(report))
  console.log('\nSet TANGLE_API_KEY + BENCHMARKS to run real benchmarks against these cells.')
}

void (process.env.TANGLE_API_KEY ? live() : demo()).catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
