/**
 * The optimization suite in three layers, on a tiny in-memory Environment.
 *
 * You implement an `Environment` (5 hooks: open/tools/call/score/close) and
 * get optimization STRATEGIES — sample (best-of-N), refine (iterate with
 * critique), and any you author with `defineStrategy` — compared at equal
 * budget and scored by your own check, for free.
 *
 * Gym-free: no benchmark dataset, no sandbox. Runs fully OFFLINE — with no
 * `TANGLE_API_KEY`, the worker points at an in-process mock router (./mock-router.ts) that drives
 * the counter, so the whole comparison runs end-to-end with zero credentials. Set the key to swap
 * in the live Tangle router as the drop-in upgrade:
 *
 *   pnpm tsx examples/strategy-suite/strategy-suite.ts                 # offline (mock worker)
 *   TANGLE_API_KEY=... pnpm tsx examples/strategy-suite/strategy-suite.ts   # live router worker
 */

import {
  defineStrategy,
  printBenchmarkReport,
  refine,
  runBenchmark,
  sample,
} from '@tangle-network/agent-runtime/loops'
import { counterEnv, counterTask } from './counter-env'
import { startMockRouter } from './mock-router'

// ── 1. The domain — the only thing a new domain writes ──────────────────────
// `counterEnv` (the shared toy `Environment`, 5 hooks open/tools/call/score/close)
// lives in ./counter-env.ts so this file shows only the DISTINCT concept: authoring
// a strategy and comparing it against the built-ins at equal budget.

const task = counterTask('counter-to-5')

// ── 2. Author a strategy — compose shot() + critique(), zero ceremony ───────
// shot() = one worker attempt over the artifact; critique() = the firewalled
// analyst reads the trace and returns a steer for the next shot.

const doubleCheck = defineStrategy(
  'doubleCheck',
  async ({ surface, task: t, budget, shot, critique }) => {
    const handle = await surface.open(t)
    const progression: number[] = []
    let messages: Record<string, unknown>[] | undefined
    let steer: string | undefined
    let completions = 0
    try {
      for (let i = 0; i < budget; i += 1) {
        const out = await shot({ handle, messages, steer })
        if (!out) break
        completions += out.completions
        progression.push(out.score)
        if (out.score >= 1) break
        messages = out.messages
        const findings = await critique(out.messages)
        completions += 1
        if (!findings) break
        steer = `Not done yet. ${findings}`
      }
      const score = progression.length ? Math.max(...progression) : 0
      return { score, resolved: score >= 1, completions, progression, shots: progression.length }
    } finally {
      await surface.close(handle)
    }
  },
)

// ── 3. Compare them at equal budget, scored by the env's own check ──────────

async function main(): Promise<void> {
  // No key → spin up the in-process mock router and point the worker at it (offline). A key → use
  // the live Tangle router. EITHER WAY the worker drives the SAME `runBenchmark` machinery below.
  const routerKey = process.env.TANGLE_API_KEY
  const mock = routerKey ? null : await startMockRouter()
  const worker = {
    routerBaseUrl: mock?.baseUrl ?? process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
    routerKey: routerKey ?? 'offline-mock',
    model: process.env.WORKER_MODEL ?? 'gpt-4o-mini',
    innerTurns: 6,
  }
  console.log(mock ? 'worker: offline mock router\n' : 'worker: live Tangle router\n')

  try {
    printBenchmarkReport(
      await runBenchmark({
        environment: counterEnv,
        tasks: [task],
        worker,
        budget: 3,
        strategies: [sample, refine, doubleCheck],
      }),
    )
  } finally {
    await mock?.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
