/**
 * The policy-search research journey — `runStrategyEvolution` + `promotionGate`.
 *
 * This is the headline self-improvement loop, end to end: per generation the engine AUTHORS a
 * population of candidate optimization strategies from the current tournament's losses, plays them
 * against the incumbent at equal budget, and advances a champion. The promotion decision runs ONCE
 * on a fresh holdout slice the search never touched (the no-adaptive-reuse rule) through
 * `promotionGate` — a seeded paired-bootstrap CI, not a point comparison.
 *
 * You supply three things: an `Environment` (your domain + its own deployable check), a `tasks`
 * supplier that returns DISJOINT slices by `(offset, n)` (train draws [0, trainN); the holdout draws
 * past it), and an author `chat` client (the model that writes candidate strategies). The engine owns
 * the tournament, the champion selection, and the gate.
 *
 * Run:  TANGLE_API_KEY=<router key>  pnpm tsx examples/strategy-evolution/strategy-evolution.ts
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatClient } from '@tangle-network/agent-eval'
import {
  type AgenticTask,
  type ArtifactHandle,
  type Environment,
  refine,
  runStrategyEvolution,
  sample,
} from '@tangle-network/agent-runtime/loops'

// ── The Environment — your domain + its own check ───────────────────────────
// A toy: drive a counter to the target with the increment tool. A real domain opens a repo, a
// browser, or an MCP server the same way and scores it with its own deployable check.

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

// ── The task supplier — DISJOINT slices by offset ───────────────────────────
// The engine calls this with (0, trainN) for the practice set and (trainN + holdoutOffset, holdoutN)
// for the held-back exam. Returning ids keyed on the offset is what keeps the two sets disjoint, so a
// good holdout score cannot be memorization of the practice tasks.

const tasks = async (offset: number, n: number): Promise<AgenticTask[]> =>
  Array.from({ length: n }, (_, i) => ({
    id: `counter-${offset + i}`,
    systemPrompt: 'You operate a counter with tools.',
    userPrompt: `Use the increment tool to bring the counter to exactly ${target}. Use read_count to verify before you finish. Reply DONE when the count equals ${target}.`,
  }))

async function main(): Promise<void> {
  const routerKey = process.env.TANGLE_API_KEY
  if (!routerKey)
    throw new Error('set TANGLE_API_KEY (the worker + the author both call the router)')
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const authorModel = process.env.AUTHOR_MODEL ?? 'deepseek-v4-flash'

  // The author writes candidate strategies; agent-eval's createChatClient is its model-call seam.
  const authorChat = createChatClient({
    transport: 'router',
    baseUrl: routerBaseUrl,
    apiKey: routerKey,
    defaultModel: authorModel,
  })

  const report = await runStrategyEvolution({
    environment: counterEnv,
    tasks,
    trainN: 8,
    holdoutN: 8,
    // WHERE the workers run — the router as an off-box tool-using agentic loop.
    worker: {
      routerBaseUrl,
      routerKey,
      model: process.env.WORKER_MODEL ?? 'gpt-4o-mini',
      innerTurns: 6,
    },
    author: { chat: authorChat, model: authorModel },
    baselines: [sample, refine],
    budget: 3,
    generations: 2,
    populationSize: 2,
    outDir: mkdtempSync(join(tmpdir(), 'strategy-evolution-')),
  })

  // The promotion decision: did the search's champion beat the gen0 champion on the fresh holdout
  // slice by a margin the task noise cannot fake?
  const v = report.verdict
  console.log(`gen0 champion:  ${report.gen0Champion.name}`)
  console.log(`final champion: ${report.finalChampion.name}`)
  console.log(`promoted:       ${v.promoted}  (${v.reason})`)
  console.log(`paired tasks:   n=${v.n}`)
  console.log(
    `held-out lift:  mean ${v.lift.mean.toFixed(3)} [${v.lift.low.toFixed(3)}, ${v.lift.high.toFixed(3)}]`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
