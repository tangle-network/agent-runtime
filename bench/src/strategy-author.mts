/**
 * The strategy AUTHOR — the agent-authored layer (docs/research/layer-agent-authored.md)
 * made executable. An LLM reads a benchmark's per-task LOSSES + the defineStrategy
 * contract, authors a NEW optimization strategy as code, and the gate scores it against
 * the human-built baselines. The R0→R2 ladder:
 *   R0 — the authored strategy typechecks/loads and completes the gate.
 *   R1 — it beats `sample` (the brutal baseline) on this environment.
 *   R2 — it beats the best human strategy.
 *
 * Two structural safety properties make this sound: the authored body spends through the
 * Supervisor's conserved pool (it cannot win by spending more), and it composes
 * shot()/critique() — it never sees the verifiers (it can be wrong, not Goodhart).
 *
 *   ENV=counter AUTHOR_MODEL=deepseek-v4-pro WORKER_MODEL=gpt-4o-mini BUDGET=3 \
 *     tsx src/strategy-author.mts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type AgenticTask,
  type ArtifactHandle,
  type Environment,
  printBenchmarkReport,
  refine,
  runBenchmark,
  sample,
  type Strategy,
} from '@tangle-network/agent-runtime/loops'
import { type RouterConfig, routerChatWithUsage } from './router-client'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

// ── The contract shown to the author (the compressed consumable — what a skill carries) ──

const contractDoc = `
You author an OPTIMIZATION STRATEGY for an agentic loop system. A strategy decides how to
spend a compute budget to beat a task's deployable check. You compose exactly two steps:

  shot(spec?: { handle?, messages?, steer? }): Promise<ShotResult | null>
    Runs ONE worker attempt (a bounded tool loop) over an artifact.
    - omit handle  => the shot opens its OWN fresh artifact and closes it after (a sample).
    - pass handle  => the shot CONTINUES that artifact (state accumulates across shots).
    - messages     => the carried conversation (pass the previous ShotResult.messages to continue).
    - steer        => a corrective instruction injected before the shot.
    ShotResult = { messages, score (0..1 on the task's check), passes, total, completions, toolErrors }
    Returns null if the attempt failed infra-wise.

  critique(messages): Promise<string | null>
    A firewalled trace-analyst reads the attempt's trajectory and returns ONE corrective
    instruction (or null when it judges the work complete). Costs ~1 completion.

  surface.open(task) / surface.close(handle)
    Open a persistent artifact you manage yourself (remember to close in a finally).

Rules:
- Stay within ~budget total shots; every shot/critique spends from a conserved pool.
- Return { score, resolved, completions, progression, shots } — score = the BEST checkpoint
  you reached (keep-best, never final-state), progression = score after each shot.
- The module must be EXACTLY this shape (no other imports, no commentary outside code):

import { defineStrategy } from '@tangle-network/agent-runtime/loops'
export default defineStrategy('your-strategy-name', async ({ surface, task, budget, shot, critique }) => {
  // your composition
})
`

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
  const cfg: RouterConfig = { routerBaseUrl, routerKey, model: authorModel }
  console.error('\n▶ authoring a new strategy from the losses…')
  const res = await routerChatWithUsage(
    cfg,
    [
      { role: 'system', content: 'You are a senior engineer authoring optimization strategies for agent loops. Output exactly one fenced ```ts code block and nothing else.' },
      {
        role: 'user',
        content: `${contractDoc}\n\nBASELINE RESULTS on the "${environment.name}" environment (budget=${budget}):\n${losses}\n\nAuthor ONE new strategy that you expect to beat both baselines on THIS environment at the same budget. Use the losses to target the observed failure mode. Output only the module code block.`,
      },
    ],
    { temperature: 0.6 },
  )
  const match = res.content.match(/```(?:ts|typescript)?\s*\n([\s\S]*?)```/)
  if (!match?.[1]) throw new Error(`author produced no code block:\n${res.content.slice(0, 400)}`)
  const code = match[1]

  const dir = join(import.meta.dirname, 'authored')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `authored-${Date.now()}.mts`)
  writeFileSync(file, code)
  console.error(`  authored module → ${file}`)

  // R0: does it load + conform?
  const mod = (await import(`file://${file}`)) as { default?: Strategy }
  const authored = mod.default
  if (!authored || typeof authored.driver !== 'function' || !authored.name) {
    throw new Error('R0 FAIL: authored module does not export a default Strategy')
  }
  console.error(`  R0 PASS: loaded strategy "${authored.name}"\n`)

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

main().catch((e) => {
  console.error(`strategy-author: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
  process.exit(1)
})
