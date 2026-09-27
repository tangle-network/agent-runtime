/**
 * The optimization suite in three layers, on a tiny in-memory Environment.
 *
 * You implement an `Environment` (5 hooks: open/tools/call/score/close) and
 * get optimization STRATEGIES — sample (best-of-N), refine (iterate with
 * critique), and any you author with `defineStrategy` — compared at equal
 * budget and scored by your own check, for free.
 *
 * Gym-free: no benchmark dataset, no sandbox. Runs fully OFFLINE — with no
 * `TANGLE_API_KEY` the worker runs against an injected `complete` transport (a deterministic
 * in-process responder that drives the counter), so the whole comparison runs end-to-end with
 * zero credentials AND no localhost server. Set the key to swap in the live Tangle router as the
 * drop-in upgrade — the SAME `runBenchmark` machinery either way:
 *
 *   pnpm tsx examples/strategy-suite/strategy-suite.ts                 # offline (injected transport)
 *   TANGLE_API_KEY=... pnpm tsx examples/strategy-suite/strategy-suite.ts   # live router worker
 */

import {
  defaultAnalystInstruction,
  defineStrategy,
  printBenchmarkReport,
  refine,
  runBenchmark,
  sample,
} from '@tangle-network/agent-runtime/kernel'
import { counterEnv, counterProfile, counterTask, offlineCounterComplete } from './counter-env'

// ── 1. The domain — the only thing a new domain writes ──────────────────────
// `counterEnv` (the shared toy `Environment`, 5 hooks open/tools/call/score/close)
// lives in ./counter-env.ts so this file shows only the DISTINCT concept: authoring
// a strategy and comparing it against the built-ins at equal budget.

const task = counterTask('counter-to-5')

// ── 2. Author a strategy — compose shot() + critique(), zero ceremony ───────
// shot() = one worker attempt over the artifact; critique() = the firewalled
// analyst reads the trace and returns a steer for the next shot.

// An AUTHORED policy the built-ins DON'T have: never trust a single passing shot — require the solution
// to pass TWICE IN A ROW before declaring done (a flake/luck guard). `refine` stops the instant a shot
// passes; `doubleCheck` runs ONE more verification shot and only accepts if that also passes. On a
// deterministic surface this is `refine` + one confirm shot; its real payoff is on a NON-deterministic
// surface (real tools / flaky tests), where a lucky single pass is caught before it ships. That is the
// point of `defineStrategy`: a stop-condition the library doesn't ship, in ~10 lines.
const doubleCheck = defineStrategy(
  'doubleCheck',
  async ({ surface, task: t, budget, shot, critique }) => {
    const handle = await surface.open(t)
    const progression: number[] = []
    let messages: Record<string, unknown>[] | undefined
    let steer: string | undefined
    let completions = 0
    let consecutivePasses = 0
    try {
      for (let i = 0; i < budget; i += 1) {
        const out = await shot({ handle, messages, steer })
        if (!out) break
        completions += out.completions
        progression.push(out.score)
        messages = out.messages
        if (out.score >= 1) {
          consecutivePasses += 1
          if (consecutivePasses >= 2) break // passed twice in a row → trust it, stop
          steer = 'That passed. Run the checks ONE more time to confirm it is stable, not a fluke.'
          continue
        }
        // A failing shot resets the streak — a single pass is never enough.
        consecutivePasses = 0
        const findings = await critique(out.messages)
        completions += 1
        if (!findings) break
        steer = `Not done yet. ${findings}`
      }
      const resolved = consecutivePasses >= 2
      const score = progression.length ? Math.max(...progression) : 0
      return { score, resolved, completions, progression, shots: progression.length }
    } finally {
      await surface.close(handle)
    }
  },
)

// ── 3. Compare them at equal budget, scored by the env's own check ──────────

async function main(): Promise<void> {
  // No key → inject the deterministic `complete` transport (offline, no network, no server).
  // A key → use the live Tangle router. EITHER WAY the worker drives the SAME `runBenchmark` below.
  const routerKey = process.env.TANGLE_API_KEY
  const model = process.env.WORKER_MODEL ?? 'deepseek-v4-flash'
  const worker = {
    routerBaseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
    routerKey: routerKey ?? 'offline',
    workerProfile: counterProfile('counter-worker', model, { maxTurns: 6, tools: true }),
    analystProfile: counterProfile('counter-analyst', model, {
      systemPrompt: defaultAnalystInstruction,
    }),
    ...(routerKey ? {} : { complete: offlineCounterComplete }),
  }
  console.log(routerKey ? 'worker: live Tangle router\n' : 'worker: offline (injected transport)\n')
  if (!routerKey) {
    console.log(
      'NOTE: the offline transport solves the counter on the first shot, so all three strategies\n' +
        'tie at 100% by construction — this run proves the WIRING (equal budget, own-check scoring),\n' +
        'not that the strategies differ. Set TANGLE_API_KEY to see sample vs refine vs doubleCheck\n' +
        'separate on a task where iterate-with-critique actually beats best-of-N.\n',
    )
  }

  printBenchmarkReport(
    await runBenchmark({
      environment: counterEnv,
      tasks: [task],
      worker,
      budget: 3,
      strategies: [sample, refine, doubleCheck],
    }),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
