/**
 * The whole toolkit in one small file, on a toy task (drive a counter to 5).
 *
 * You write one small adapter (open a task, expose tools, score the result) and get back
 * automatic comparison of ways to spend a compute budget, each scored by your own check.
 * Three levels, shown below:
 *   1. just run it     — runBenchmark(env, …) compares the built-in tactics for you.
 *   2. pick tactics    — sample (N blind attempts, keep best), refine (critic steers the
 *                        retry), adaptiveRefine (refine, restart a stalled line).
 *   3. author your own — defineStrategy(name, body) in ~10 lines from shot() + critique().
 *
 * Toy task = only a router key needed (no dataset, no sandbox). Run from bench/:
 *   TANGLE_API_KEY=... WORKER_MODEL=gpt-4o-mini tsx src/examples/strategy-demo.mts
 */
import { adaptiveRefine, type AgenticTask, type ArtifactHandle, defineStrategy, type Environment, printBenchmarkReport, refine, runBenchmark, sample } from '@tangle-network/agent-runtime/kernel'
import { benchRouterProfile } from '../router-turn'

// ── 1. Implement an Environment (the only thing a new domain writes) ──────────────
// A toy: the agent must drive a counter to exactly the target using the increment tool.
// score = how close it got. This is the seam every real benchmark (EOPS, a coding repo,
// a browser task) implements the same way — open a checkable artifact, expose tools,
// score it. Here the "artifact" is just an in-memory counter.

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
      { type: 'function', function: { name: 'increment', description: 'Add 1 to the counter.', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'read_count', description: 'Read the current counter value.', parameters: { type: 'object', properties: {} } } },
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
  // The deployable CHECK: exact hits toward the target. score = passes/total.
  async score(_task, handle) {
    const c = counters.get(handle.id)
    const count = c?.count ?? 0
    return { passes: Math.min(count, target), total: target, errored: 0 }
  },
  async close(handle) {
    counters.delete(handle.id)
  },
}

const task: AgenticTask = {
  id: 'counter-to-5',
  userPrompt: `You operate a counter with tools. Use the increment tool to bring the counter to exactly ${target}. Use read_count to verify before you finish. Reply DONE when the count equals ${target}.`,
}

// ── 3. Author your OWN strategy in ~10 lines — the lego (no Supervisor ceremony) ──
// "doubleCheck": one attempt, then critique twice (extra steering passes) before stopping.
// A strategy body composes two steps: shot() (one worker attempt) + critique() (the
// firewalled analyst → a steer). That's it. This is the skillifiable unit.
const doubleCheck = defineStrategy('doubleCheck', async ({ surface, task: t, budget, shot, critique }) => {
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
})

async function main(): Promise<void> {
  const worker = {
    routerBaseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
    routerKey: process.env.TANGLE_API_KEY ?? '',
    workerProfile: benchRouterProfile(
      'strategy-demo-worker',
      process.env.WORKER_MODEL ?? 'deepseek-v4-flash',
      {
        systemPrompt: 'Use the available tools to complete and verify the task.',
        maxTurns: 6,
      },
    ),
  }
  if (!worker.routerKey) throw new Error('set TANGLE_API_KEY (the worker calls the router)')

  console.log('Layer 1 — just run it (default strategies, scored by the env\'s own check):')
  printBenchmarkReport(await runBenchmark({ environment: counterEnv, tasks: [task], worker, budget: 3 }))

  console.log('\nLayer 2+3 — pick the built-ins AND your own authored strategy:')
  printBenchmarkReport(
    await runBenchmark({ environment: counterEnv, tasks: [task], worker, budget: 3, strategies: [sample, refine, adaptiveRefine, doubleCheck] }),
  )
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
