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
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type AgenticTask,
  refine,
  runStrategyEvolution,
  sample,
  strategyAuthorSystemPrompt,
} from '@tangle-network/agent-runtime/kernel'
import { counterEnv, counterTask } from '../strategy-suite/counter-env'

// ── The domain ──────────────────────────────────────────────────────────────
// `counterEnv` (the shared toy `Environment` + its own deployable check) lives in
// ../strategy-suite/counter-env.ts so this file shows only its DISTINCT concept: the
// disjoint-slice task supplier + the held-out promotion gate.

// ── The task supplier — DISJOINT slices by offset ───────────────────────────
// The engine calls this with (0, trainN) for the practice set and (trainN + holdoutOffset, holdoutN)
// for the held-back exam. Returning ids keyed on the offset is what keeps the two sets disjoint, so a
// good holdout score cannot be memorization of the practice tasks.

const tasks = async (offset: number, n: number): Promise<AgenticTask[]> =>
  Array.from({ length: n }, (_, i) => counterTask(`counter-${offset + i}`))

async function main(): Promise<void> {
  const routerKey = process.env.TANGLE_API_KEY
  if (!routerKey)
    throw new Error('set TANGLE_API_KEY (the worker + the author both call the router)')
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const authorModel = process.env.AUTHOR_MODEL ?? 'deepseek-v4-flash'

  const report = await runStrategyEvolution({
    environment: counterEnv,
    tasks,
    trainN: 8,
    holdoutN: 8,
    // WHERE the workers run — the router as an off-box tool-using agentic loop.
    worker: {
      routerBaseUrl,
      routerKey,
      workerProfile: routerProfile(
        'strategy-worker',
        process.env.WORKER_MODEL ?? 'deepseek-v4-flash',
        undefined,
        6,
      ),
    },
    author: {
      profile: routerProfile('strategy-author', authorModel, strategyAuthorSystemPrompt),
      executor: { backend: 'router', routerBaseUrl, routerKey },
    },
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

function routerProfile(
  name: string,
  model: string,
  systemPrompt?: string,
  maxTurns?: number,
): AgentProfile {
  return {
    name,
    harness: 'cli-base',
    model: {
      provider: 'tangle-router',
      default: model,
      ...(maxTurns !== undefined ? { metadata: { maxTurns } } : {}),
    },
    ...(systemPrompt ? { prompt: { systemPrompt } } : {}),
  }
}
