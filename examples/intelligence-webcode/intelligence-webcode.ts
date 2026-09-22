/**
 * intelligence-webcode — the WebCode harness×model benchmark (see ../webcode-matrix),
 * instrumented with the FULL Tangle Intelligence SDK. It reuses the EXACT benchmark next door — the same
 * harness×model grid and the same post-Aug-2025 WebCode tasks graded by hidden tests — and adds nothing
 * but the intelligence wiring. Per harness×model you get: did it pass, what it cost, the per-tool
 * waterfall, and the spans streamed to your trace collector.
 *
 * Three intelligence layers, all on one cell:
 *   1. BOUNDARY (the bill + the control) — `withIntelligence(cell, { project, effort })`.
 *      `effort ∈ off | eco | standard | thorough | max`; `'off'` is the PROVABLE passthrough floor —
 *      intelligence spend clamped to 0, the cell still runs. This is the one knob that gates spend.
 *   2. WATERFALL (the cost truth) — `createWaterfallCollector()` on the run. The sum of its spans IS the
 *      billed run cost, per tool/phase — no separate tally to drift.
 *   3. OTLP (the production trace pipe) — `createOtelExporter()` + `loopEventToOtelSpan`. Streams every
 *      span to your OTLP/HTTP collector (set `OTEL_EXPORTER_OTLP_ENDPOINT`); a no-op when unset.
 *
 * The intelligence attaches at TWO points: the boundary wraps the whole cell (`withIntelligence`
 * works over any async function), and the internal trace rides `openEnvironmentRun`'s `hooks`
 * here that emits per-tool spans). Same pattern instruments `runProfileMatrix`'s dispatch wholesale.
 *
 * Run:
 *   TANGLE_API_KEY=... [EFFORT=standard] [OTEL_EXPORTER_OTLP_ENDPOINT=…] \
 *     tsx examples/intelligence-webcode/intelligence-webcode.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import {
  composeRuntimeHooks,
  createOtelExporter,
  loopEventToOtelSpan,
  type RuntimeHooks,
} from '@tangle-network/agent-runtime'
import { type EffortTier, withIntelligence } from '@tangle-network/agent-runtime/intelligence'
import {
  type AgentRunSpec,
  createWaterfallCollector,
  openEnvironmentRun,
  sumEnvironmentUsage,
} from '@tangle-network/agent-runtime/loops'
import {
  createWebCodeEnvironmentProvider,
  gradeWebCodeEnvironment,
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
 *  `withIntelligence` (below) adds the BOUNDARY layer. */
function instrumentedCell(
  environmentProvider: AgentEnvironmentProvider,
): (input: CellInput) => Promise<CellResult> {
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
      environment: {
        backend: harness,
        workspace: task.baseImage ? { image: task.baseImage } : { environment: 'universal' },
        env: { TANGLE_SEARCH_DEFAULT_PROVIDER: 'exa' },
        providerOptions: {
          sandboxCreateOptions: {
            backend: {
              model: { provider: 'openai-compat', model, baseUrl: routerBaseUrl },
            },
          },
        },
        // The box self-auths via the TANGLE_API_KEY used to provision it.
        // do NOT pass a router/model key into the box (egress proxy rejects foreign creds). Search-provider
        // pick only.
      },
    }

    const run = await openEnvironmentRun<{ passed: boolean }>({
      provider: environmentProvider,
      agentRun,
      scenarioId: task.id,
      signal: new AbortController().signal,
      hooks: composeRuntimeHooks(waterfall.hooks, otelHook),
      deliverable: { kind: 'events', fromEvents: () => ({ passed: false }) },
    })
    const solutionFile = task.solutionFiles[0] ?? 'Solution.txt'
    try {
      const turn = await run.turn(
        `${task.taskDescription}\n\nWrite your solution to \`solution/${solutionFile}\`. Use web_search for the post-${task.releaseTag} API; make every test pass.`,
      )
      const usage = sumEnvironmentUsage(turn.events)
      const passed = await gradeWebCodeEnvironment(run.environment, task)
      const report = waterfall.report()
      return {
        passed,
        usd: usage.costUsd || report.totalUsd,
        ms: report.totalMs,
        waterfall: waterfall.render({ maxRows: 8 }),
      }
    } finally {
      await run.close()
      await otel?.flush()
    }
  }
}

/** Run the WebCode grid × tasks with the full intelligence stack on every cell. */
export async function runIntelligenceWebcode(
  environmentProvider: AgentEnvironmentProvider,
): Promise<void> {
  // LAYER 1 — the BOUNDARY: every cell runs under `withIntelligence` — observed + billed, effort-gated.
  // `effort: 'off'` clamps intelligence spend to 0 (the provable passthrough floor) while still running.
  const smartCell = withIntelligence(instrumentedCell(environmentProvider), {
    tenantId: process.env.TANGLE_TENANT_ID ?? 'tenant-demo',
    project,
    effort,
  })
  const webcodeTasks = loadWebCodeTasks(
    process.env.LIMIT ? { limit: Number(process.env.LIMIT) } : {},
  )

  console.log(`intelligence-webcode · effort=${effort} · project=${project}`)
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

// Run it live with the same provider as ../webcode-matrix.
if (import.meta.url === `file://${process.argv[1]}`) {
  const apiKey = process.env.TANGLE_API_KEY
  if (!apiKey) throw new Error('TANGLE_API_KEY required')
  const environmentProvider = createWebCodeEnvironmentProvider({
    apiKey,
    baseUrl: process.env.SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools',
  })
  await runIntelligenceWebcode(environmentProvider)
}
