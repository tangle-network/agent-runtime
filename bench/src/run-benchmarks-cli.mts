/**
 * Run a SUBSET of the benchmark registry over a matrix of agent cells, end to end:
 *
 *   export TANGLE_API_KEY=...                          # router + each adapter judge's creds
 *   BENCHMARKS=humaneval,swe-bench \
 *   CELLS=opencode/glm-4.6,codex/gpt-5,deepseek-v4-flash \
 *   N=20 CONCURRENCY=6 tsx src/run-benchmarks-cli.mts
 *
 * A cell is `harness/model` (in-box: that coding harness runs the model) or a bare `model`
 * (off-box: a router completion is the worker). The number is the adapter's OWN deterministic
 * judge — pick benchmarks whose `adapter.judge` is a runnable checker. Output is a leaderboard:
 * resolve-rate and mean graded score per (benchmark × cell), with any unavailable benchmark
 * (missing Docker/venv/dataset) listed, never silently dropped.
 */
import { createCliBridgeProvider } from '@tangle-network/agent-provider-cli-bridge'
import { createTangleProvider } from '@tangle-network/agent-provider-tangle'
import { routerEnvironmentProvider } from '@tangle-network/agent-runtime/loops'
import { Sandbox } from '@tangle-network/sandbox'
import { type BenchCell, printBenchmarksReport, runBenchmarks } from './run-benchmarks'
import { makeSearchExecutor, webSearchTool } from './search-tool'

const must = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`env ${k} is required`)
  return v
}

interface ConfiguredCell extends BenchCell {
  readonly backend: string
  readonly searchProvider?: string
}

/** `harness/model` → in-box cell; bare `model` → off-box router cell. For cli-bridge, the
 *  full model id is already `harness/model`, so do not split it. */
function parseCell(spec: string): ConfiguredCell {
  const s = spec.trim()
  if (process.env.BACKEND === 'cli-bridge') {
    return {
      label: s,
      model: s,
      backend: 'cli-bridge',
      ...(process.env.SEARCH_PROVIDER ? { searchProvider: process.env.SEARCH_PROVIDER } : {}),
    }
  }
  const slash = s.indexOf('/')
  if (slash > 0) {
    const harness = s.slice(0, slash)
    const model = s.slice(slash + 1)
    return {
      label: s,
      harness,
      model,
      backend: process.env.BACKEND ?? 'sandbox',
      ...(process.env.SEARCH_PROVIDER ? { searchProvider: process.env.SEARCH_PROVIDER } : {}),
    }
  }
  return {
    label: s,
    model: s,
    backend: process.env.BACKEND ?? 'router',
    ...(process.env.SEARCH_PROVIDER ? { searchProvider: process.env.SEARCH_PROVIDER } : {}),
  }
}

async function main(): Promise<void> {
  const benchmarks = (process.env.BENCHMARKS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (benchmarks.length === 0)
    throw new Error(
      'env BENCHMARKS is required (comma-separated registry keys, e.g. humaneval,swe-bench)',
    )
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('TANGLE_API_KEY')
  const bridgeUrl = process.env.BRIDGE_URL ?? 'http://127.0.0.1:3355'
  const bridgeBearer = process.env.BRIDGE_BEARER ?? process.env.CLI_BRIDGE_BEARER ?? routerKey
  const timeoutMs = process.env.TIMEOUT_MS ? Number(process.env.TIMEOUT_MS) : undefined
  const sandboxProvider = createTangleProvider({
    client: new Sandbox({
      baseUrl: process.env.SANDBOX_BASE ?? 'https://sandbox.tangle.tools',
      apiKey: routerKey,
      timeoutMs: timeoutMs ?? 1_200_000,
    }) as never,
  })
  const cells = (process.env.CELLS ?? process.env.WORKER_MODEL ?? 'deepseek-v4-flash')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseCell)
    .map((configured): BenchCell => {
      const { backend, searchProvider, ...cell } = configured
      if (backend === 'router') {
        return {
          ...cell,
          provider: routerEnvironmentProvider({
            name: searchProvider ? `router-tools-${cell.label}` : `router-${cell.label}`,
            routerBaseUrl,
            routerKey,
            model: cell.model,
            ...(searchProvider
              ? {
                  tools: [webSearchTool],
                  executeToolCall: makeSearchExecutor({
                    routerBaseUrl,
                    routerKey,
                    provider: searchProvider,
                  }),
                }
              : {}),
          }),
          environment: {},
        }
      }
      if (backend === 'cli-bridge') {
        return {
          ...cell,
          provider: createCliBridgeProvider({
            baseUrl: bridgeUrl,
            bearerToken: bridgeBearer,
            defaultModel: cell.model,
            name: `cli-bridge-${cell.label}`,
          }),
          environment: {},
        }
      }
      return { ...cell, provider: sandboxProvider }
    })

  const report = await runBenchmarks({
    benchmarks,
    cells,
    routerBaseUrl,
    routerKey,
    n: Number(process.env.N ?? 10),
    ...(process.env.IDS ? { ids: process.env.IDS.split(',') } : {}),
    ...(process.env.SPLIT ? { split: process.env.SPLIT } : {}),
    ...(process.env.REPS ? { reps: Number(process.env.REPS) } : {}),
    ...(process.env.LOOP_ATTEMPTS ? { loopAttempts: Number(process.env.LOOP_ATTEMPTS) } : {}),
    concurrency: Number(process.env.CONCURRENCY ?? 4),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(process.env.VERIFY_JUDGE === '0' ? { verifyJudge: false } : {}),
    onResult: (r) =>
      console.log(
        `  [${r.ok ? (r.resolved ? 'PASS' : 'fail') : 'ERR '}] ${r.benchmark} ${r.cell} ${r.taskId} score=${r.score.toFixed(2)} ${(r.wallMs / 1000).toFixed(1)}s${r.detail ? ` (${r.detail})` : ''}`,
      ),
  })

  console.log(
    `\n=== benchmark matrix: ${report.benchmarks.join(', ')} × ${report.cells.length} cell(s) ===`,
  )
  console.log(printBenchmarksReport(report))
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
