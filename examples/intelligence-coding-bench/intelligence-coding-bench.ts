/**
 * intelligence-coding-bench — the WebCode harness×model coding benchmark (see ../webcode-matrix),
 * instrumented with the FULL Tangle Intelligence SDK. It reuses the EXACT benchmark next door — the same
 * harness×model grid and the same post-Aug-2025 WebCode tasks graded by hidden tests — and adds nothing
 * but the intelligence wiring. Per harness×model you get: did it pass, what it cost, the per-tool
 * waterfall, and the spans streamed to your trace collector.
 *
 * Three intelligence layers, all on one cell:
 *   1. BOUNDARY (the bill + the control) — `withTangleIntelligence(cell, { project, effort })`.
 *      `effort ∈ off | eco | standard | thorough | max`; `'off'` is the PROVABLE passthrough floor —
 *      intelligence spend clamped to 0, the cell still runs. This is the one knob that gates spend.
 *   2. WATERFALL (the cost truth) — `createWaterfallCollector()` on the run. The sum of its spans IS the
 *      billed run cost, per tool/phase — no separate tally to drift.
 *   3. OTLP (the production trace pipe) — `createOtelExporter()` + `loopEventToOtelSpan`. Streams every
 *      span to your OTLP/HTTP collector (set `OTEL_EXPORTER_OTLP_ENDPOINT`); a no-op when unset.
 *
 * The intelligence attaches at TWO seams: the BOUNDARY wraps the whole cell (`withTangleIntelligence`
 * works over any async fn), and the INTERNAL trace rides `openSandboxRun`'s `hooks` (the only run verb
 * here that emits per-tool spans). Same pattern instruments `runProfileMatrix`'s dispatch wholesale.
 *
 * Run:
 *   TANGLE_API_KEY=… SANDBOX_API_KEY=… EXA_API_KEY=… [EFFORT=standard] [OTEL_EXPORTER_OTLP_ENDPOINT=…] \
 *     tsx examples/intelligence-coding-bench/intelligence-coding-bench.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  composeRuntimeHooks,
  createOtelExporter,
  loopEventToOtelSpan,
  type RuntimeHooks,
} from '@tangle-network/agent-runtime'
import { type EffortTier, withTangleIntelligence } from '@tangle-network/agent-runtime/intelligence'
import {
  type AgentRunSpec,
  createWaterfallCollector,
  openSandboxRun,
  type SandboxClient,
} from '@tangle-network/agent-runtime/loops'
import type { BackendType } from '@tangle-network/sandbox'
import {
  loadWebCodeTasks,
  type WebCodeTask,
  profiles as webcodeGrid,
} from '../webcode-matrix/webcode-matrix'

const routerBaseUrl = process.env.ROUTER_BASE_URL ?? 'https://router.tangle.tools/v1'
const effort = (process.env.EFFORT ?? 'standard') as EffortTier
const project = process.env.TANGLE_PROJECT ?? 'webcode-bench'

interface CellInput {
  profile: AgentProfile
  task: WebCodeTask
}
interface CellResult {
  passed: boolean
  usd: number
  ms: number
  waterfall: string
}

/** One instrumented cell: run a harness×model on a WebCode task in its own sandbox with the INTERNAL trace
 *  collected (cost waterfall) AND streamed (OTLP), then score on the hidden tests. Wrapping this in
 *  `withTangleIntelligence` (below) adds the BOUNDARY layer. */
function instrumentedCell(client: SandboxClient): (input: CellInput) => Promise<CellResult> {
  return async ({ profile, task }) => {
    const harness = String(profile.metadata?.harness ?? 'opencode')
    const model = String(profile.metadata?.model ?? '')

    // LAYER 2 + 3 — the INTERNAL trace: the per-tool waterfall (cost) AND OTLP spans, both as run hooks.
    const waterfall = createWaterfallCollector()
    const otel = createOtelExporter() // undefined unless OTEL_EXPORTER_OTLP_ENDPOINT (or config) is set
    const otelHook: RuntimeHooks = otel
      ? {
          onEvent: (e) => {
            otel.exportSpan(
              loopEventToOtelSpan(
                {
                  kind: e.target,
                  runId: e.runId,
                  timestamp: e.timestamp,
                  payload: (e.payload ?? {}) as object,
                },
                e.runId,
              ),
            )
          },
        }
      : {}

    const agentRun: AgentRunSpec<string> = {
      profile,
      name: profile.name ?? harness,
      taskToPrompt: (t) => t,
      sandboxOverrides: {
        // ONE key: TANGLE_API_KEY auths the sandbox, the model router, AND router-backed web_search.
        env: {
          TANGLE_SEARCH_DEFAULT_PROVIDER: 'exa',
          ...(process.env.TANGLE_API_KEY ? { TANGLE_API_KEY: process.env.TANGLE_API_KEY } : {}),
        },
        // The multi-language toolchain (python+pytest + Go/Py/TS/Java/C++), same as commit0/clbench.
        environment: 'universal',
        backend: {
          type: harness as BackendType,
          model: { provider: 'openai-compat', model, baseUrl: routerBaseUrl },
        },
      },
    }

    const run = await openSandboxRun<{ passed: boolean }>(
      client,
      {
        agentRun,
        scenarioId: task.id,
        signal: new AbortController().signal,
        hooks: composeRuntimeHooks(waterfall.hooks, otelHook),
      },
      { kind: 'events', fromEvents: () => ({ passed: false }) },
    )
    const solutionFile = task.solutionFiles[0] ?? 'Solution.txt'
    await run.start(
      `${task.taskDescription}\n\n— Write your solution to \`solution/${solutionFile}\`. Use web_search for the post-${task.releaseTag} API; make every test pass.`,
    )
    // Grade with Exa's exact test_patch (pytest), score on exit — the same execution-truth grader as
    // webcode-matrix; here every cell is also traced + billed by the intelligence layers above.
    await run.box.fs.mkdir('tests', { recursive: true })
    await run.box.fs.mkdir('solution', { recursive: true })
    await run.box.fs.write('tests/test_solution.py', task.testPatch)
    await run.box.exec?.('python3 -m pip install -q pytest 2>/dev/null || true')
    const res = await run.box.exec?.('python3 -m pytest tests/ -q')
    await otel?.flush()

    const report = waterfall.report()
    return {
      passed: (res?.exitCode ?? 1) === 0,
      usd: report.totalUsd,
      ms: report.totalMs,
      waterfall: waterfall.render({ maxRows: 8 }),
    }
  }
}

/** Run the WebCode grid × tasks with the full intelligence stack on every cell. */
export async function runIntelligenceCodingBench(client: SandboxClient): Promise<void> {
  // LAYER 1 — the BOUNDARY: every cell runs under `withTangleIntelligence` — traced + billed, effort-gated.
  // `effort: 'off'` clamps intelligence spend to 0 (the provable passthrough floor) while still running.
  const smartCell = withTangleIntelligence(instrumentedCell(client), { project, effort })
  const webcodeTasks = loadWebCodeTasks(
    process.env.LIMIT ? { limit: Number(process.env.LIMIT) } : {},
  )

  console.log(`intelligence-coding-bench · effort=${effort} · project=${project}`)
  console.log(`${'harness·model'.padEnd(30)}${'task'.padEnd(14)}result  cost     wall\n`)
  let shownWaterfall = false
  for (const profile of webcodeGrid) {
    for (const task of webcodeTasks) {
      const r = await smartCell({ profile, task })
      console.log(
        `${(profile.name ?? '').padEnd(30)}${task.id.padEnd(14)}${r.passed ? 'PASS' : 'fail'}    $${r.usd.toFixed(4)}  ${(r.ms / 1000).toFixed(1)}s`,
      )
      // Show the per-tool cost waterfall (layer 2) once — the same spans the $ column sums.
      if (!shownWaterfall) {
        console.log(`\n  — per-tool cost waterfall (layer 2), one cell —\n${r.waterfall}\n`)
        shownWaterfall = true
      }
    }
  }
}

// Run it live — mirrors ../webcode-matrix's client wiring.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { SandboxClient } = (await import('@tangle-network/sandbox')) as {
    SandboxClient: new (o: { apiKey: string; baseUrl: string }) => SandboxClient
  }
  const apiKey = process.env.SANDBOX_API_KEY
  if (!apiKey) throw new Error('SANDBOX_API_KEY required')
  const client = new SandboxClient({
    apiKey,
    baseUrl: process.env.SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools',
  })
  await runIntelligenceCodingBench(client)
}
