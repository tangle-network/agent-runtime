/**
 * The optimization suite in three layers, on a tiny in-memory Environment.
 *
 * You implement an `Environment` (5 hooks: open/tools/call/score/close) and
 * get optimization STRATEGIES — sample (best-of-N), refine (iterate with
 * critique), and any you author with `defineStrategy` — compared at equal
 * budget and scored by your own check, for free.
 *
 * Gym-free: no benchmark dataset, no sandbox. The worker calls the router, so
 * it needs a key:
 *
 *   TANGLE_API_KEY=... pnpm tsx examples/strategy-suite/strategy-suite.ts
 */

import {
  type AgenticTask,
  type ArtifactHandle,
  defineStrategy,
  type Environment,
  printBenchmarkReport,
  refine,
  runBenchmark,
  sample,
} from '@tangle-network/agent-runtime/loops'

// ── 1. The Environment — the only thing a new domain writes ─────────────────
// A toy: drive a counter to exactly the target with the increment tool. The
// "artifact" is an in-memory counter; a real domain opens a repo, a browser,
// or an MCP server the same way and scores it with its own deployable check.

const target = 5
const counters = new Map<string, { count: number }>()

const counterEnv: Environment = {
  name: 'counter',
  async open(_task) {
    const id = `counter-${Math.random().toString(36).slice(2, 8)}`
    counters.set(id, { count: 0 })
    return { id, surface: 'counter' } satisfies ArtifactHandle
  },
  async tools() {
    return [
      {
        type: 'function',
        function: {
          name: 'increment',
          description: 'Add 1 to the counter.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'read_count',
          description: 'Read the current counter value.',
          parameters: { type: 'object', properties: {} },
        },
      },
    ]
  },
  async call(handle, name) {
    const c = counters.get(handle.id)
    if (!c) return 'ERROR: no such counter'
    if (name === 'increment') {
      c.count += 1
      return `count is now ${c.count}`
    }
    if (name === 'read_count') return `count is ${c.count}`
    return `ERROR: unknown tool ${name}`
  },
  // The deployable CHECK — your own success criterion, never an LLM's opinion.
  async score(_task, handle) {
    const count = counters.get(handle.id)?.count ?? 0
    return { passes: Math.min(count, target), total: target, errored: 0 }
  },
  async close(handle) {
    counters.delete(handle.id)
  },
}

const task: AgenticTask = {
  id: 'counter-to-5',
  systemPrompt: 'You operate a counter with tools.',
  userPrompt: `Use the increment tool to bring the counter to exactly ${target}. Use read_count to verify before you finish. Reply DONE when the count equals ${target}.`,
}

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
  const routerKey = process.env.TANGLE_API_KEY
  if (!routerKey) throw new Error('set TANGLE_API_KEY (the worker calls the router)')
  const worker = {
    routerBaseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
    routerKey,
    model: process.env.WORKER_MODEL ?? 'gpt-4o-mini',
    innerTurns: 6,
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
