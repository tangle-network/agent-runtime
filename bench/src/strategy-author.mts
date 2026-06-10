/**
 * The strategy-author LADDER CLI — the agent-authored layer
 * (docs/research/layer-agent-authored.md) made executable against a cheap environment.
 * The authoring itself is the package primitive (`authorStrategy` from
 * `@tangle-network/agent-runtime/loops`); this file supplies the environment and runs
 * the R0→R2 ladder:
 *   R0 — the authored strategy typechecks/loads and completes the gate.
 *   R1 — it beats `sample` (the brutal baseline) on this environment.
 *   R2 — it beats the best human strategy.
 *
 * Two structural properties make this sound: the authored body spends through the
 * Supervisor's conserved pool (it cannot win by spending more), and it composes
 * shot()/critique() — it never sees the verifiers (it can be wrong, not Goodhart).
 *
 *   AUTHOR_MODEL=deepseek-v4-pro WORKER_MODEL=gpt-4o-mini BUDGET=3 \
 *     tsx src/strategy-author.mts
 */
import { join } from 'node:path'
import { createChatClient } from '@tangle-network/agent-eval'
import {
  type AgenticTask,
  type ArtifactHandle,
  authorStrategy,
  type Environment,
  printBenchmarkReport,
  refine,
  runBenchmark,
  sample,
} from '@tangle-network/agent-runtime/loops'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

// ── Environments the author can be pointed at ────────────────────────────────────

function counterEnvironment(): { environment: Environment; tasks: AgenticTask[] } {
  const counters = new Map<string, { count: number }>()
  const target = 7
  const environment: Environment = {
    name: 'counter',
    async open() {
      const id = `counter-${Math.random().toString(36).slice(2, 8)}`
      counters.set(id, { count: 0 })
      return { id, surface: 'counter' } satisfies ArtifactHandle
    },
    async tools() {
      return [
        { type: 'function', function: { name: 'increment', description: 'Add 1 to the counter.', parameters: { type: 'object', properties: {} } } },
        { type: 'function', function: { name: 'read_count', description: 'Read the counter.', parameters: { type: 'object', properties: {} } } },
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
    async score(_task, handle) {
      const count = counters.get(handle.id)?.count ?? 0
      return { passes: Math.max(0, target - Math.abs(target - count)), total: target, errored: 0 }
    },
    async close(handle) {
      counters.delete(handle.id)
    },
  }
  const tasks: AgenticTask[] = [1, 2, 3].map((i) => ({
    id: `counter-${i}`,
    systemPrompt: 'You operate a counter with tools.',
    userPrompt: `Bring the counter to exactly ${target} using increment; verify with read_count. Reply DONE when it equals ${target}.`,
  }))
  return { environment, tasks }
}

async function main(): Promise<void> {
  const budget = Number(process.env.BUDGET ?? 3)
  const workerModel = process.env.WORKER_MODEL ?? 'gpt-4o-mini'
  const authorModel = process.env.AUTHOR_MODEL ?? 'deepseek-v4-pro'
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('TANGLE_API_KEY')
  const worker = { routerBaseUrl, routerKey, model: workerModel, innerTurns: Number(process.env.INNER_TURNS ?? 6) }
  const { environment, tasks } = counterEnvironment() // ENV registry grows as domains land

  console.error(`=== strategy author · env=${environment.name} · worker=${workerModel} · author=${authorModel} ===\n`)
  console.error('▶ baselines (sample, refine)…')
  const baseline = await runBenchmark({ environment, tasks, worker, strategies: [sample, refine], budget, concurrency: 2 })
  printBenchmarkReport(baseline)

  // The author sees the CONTRACT + the LOSSES (per-task cells) — never the verifiers.
  const losses = JSON.stringify(baseline.perTask, null, 1).slice(0, 6000)
  console.error('\n▶ authoring a new strategy from the losses…')
  const chat = createChatClient({ transport: 'router', apiKey: routerKey, baseUrl: routerBaseUrl, defaultModel: authorModel })
  const { strategy: authored, file } = await authorStrategy({
    chat,
    model: authorModel,
    fallbackModel: process.env.AUTHOR_FALLBACK_MODEL ?? 'deepseek-v4-flash',
    environmentName: environment.name,
    lossesJson: losses,
    budget,
    outDir: join(import.meta.dirname, 'authored'),
    temperature: 0.6,
    maxTokens: 8192,
  })
  console.error(`  authored "${authored.name}" → ${file}`)
  console.error('  R0 PASS: loaded\n')

  console.error('▶ the gate: authored vs baselines…')
  const final = await runBenchmark({ environment, tasks, worker, strategies: [sample, refine, authored], budget, concurrency: 2 })
  printBenchmarkReport(final)

  const a = final.perStrategy[authored.name]?.score ?? 0
  const s = final.perStrategy.sample?.score ?? 0
  const r = final.perStrategy.refine?.score ?? 0
  const best = Math.max(s, r)
  console.error(`\n  R1 (beats sample): ${a > s ? 'PASS' : 'fail'}   R2 (beats best human): ${a > best ? 'PASS' : 'fail'}`)
  console.error(`  verdict: authored=${(a * 100).toFixed(1)}% vs sample=${(s * 100).toFixed(1)}% refine=${(r * 100).toFixed(1)}%`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`strategy-author: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
    process.exit(1)
  })
}
