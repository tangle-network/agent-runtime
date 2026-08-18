/**
 * Hillclimb a modern benchmark, end to end:
 *
 *   pick the benchmark (SWE-bench-Live as an `Environment`)
 *     → baseline tournament (gen0: `sample` vs `refine` at equal budget)
 *     → strategy evolution (an author model writes new strategies from losses)
 *     → held-out re-measure (the promotion gate, on tasks the search never saw)
 *     → a durable experiment record (report JSON + agent-eval ExperimentTracker).
 *
 * Every model call — worker, analyst, author — flows through one metered
 * transport with a hard dollar ceiling. The ceiling is checked before each
 * call, so the final call may overshoot by at most one completion.
 *
 * Run (the ceiling and exact prices are required; prices are $ per million tokens):
 *
 *   TANGLE_API_KEY=sk-tan-... \
 *   MAX_USD=5 PRICE_IN_PER_M=0.27 PRICE_OUT_PER_M=1.10 \
 *   pnpm tsx examples/hillclimb-benchmark/hillclimb.ts
 *
 * Knobs: WORKER_MODEL / AUTHOR_MODEL (default deepseek-v4-flash), TRAIN_N,
 * HOLDOUT_N, GENERATIONS, POP, BUDGET (rollouts per strategy per task),
 * ROUTER_BASE. Cost scales with TRAIN_N × BUDGET × strategies — start small.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ExperimentTracker, fileExperimentStore } from '@tangle-network/agent-eval/experiment'
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  refine,
  runStrategyEvolution,
  sample,
  strategyAuthorSystemPrompt,
} from '@tangle-network/agent-runtime/kernel'
import { fetchSweLiveTasks, sweLiveEnv } from './swe-live-env'

function requiredNumberEnv(name: string): number {
  const raw = process.env[name]
  const value = Number(raw)
  if (!raw || !Number.isFinite(value) || value <= 0) {
    throw new Error(`set ${name} to a positive number (got ${raw ?? 'nothing'})`)
  }
  return value
}

async function main(): Promise<void> {
  const routerKey = process.env.TANGLE_API_KEY
  if (!routerKey)
    throw new Error('set TANGLE_API_KEY (worker, analyst, and author all call the router)')
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const maxUsd = requiredNumberEnv('MAX_USD')
  const priceInPerM = requiredNumberEnv('PRICE_IN_PER_M')
  const priceOutPerM = requiredNumberEnv('PRICE_OUT_PER_M')
  const workerModel = process.env.WORKER_MODEL ?? 'deepseek-v4-flash'
  const authorModel = process.env.AUTHOR_MODEL ?? 'deepseek-v4-flash'
  const trainN = Number(process.env.TRAIN_N ?? 6)
  const holdoutN = Number(process.env.HOLDOUT_N ?? 8)

  // ── The metered transport: one ceiling over every leg ────────────────────
  // Cost is metered from each response's usage at the configured catalog
  // rates; the billed price can differ, so treat MAX_USD as an estimate-based
  // hard stop, not an invoice. A response without usage fails loudly.
  const spend = { usd: 0, calls: 0 }
  const complete = async (
    body: Record<string, unknown>,
    request?: { readonly headers: Readonly<Record<string, string>>; readonly signal?: AbortSignal },
  ): Promise<unknown> => {
    if (spend.usd >= maxUsd) {
      throw new Error(
        `cost ceiling reached: $${spend.usd.toFixed(2)} spent of MAX_USD=$${maxUsd} after ${spend.calls} calls — raise MAX_USD or lower TRAIN_N/GENERATIONS/BUDGET`,
      )
    }
    const response = await fetch(`${routerBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${routerKey}`,
        ...request?.headers,
      },
      body: JSON.stringify(body),
      signal: request?.signal,
    })
    if (!response.ok) throw new Error(`router ${response.status}: ${await response.text()}`)
    const json = (await response.json()) as {
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const usage = json.usage
    if (typeof usage?.prompt_tokens !== 'number' || typeof usage?.completion_tokens !== 'number') {
      throw new Error('router response carried no token usage — the ceiling cannot be metered')
    }
    spend.usd += (usage.prompt_tokens * priceInPerM + usage.completion_tokens * priceOutPerM) / 1e6
    spend.calls += 1
    return json
  }

  const outDir = join(
    process.cwd(),
    '.hillclimb-runs',
    new Date().toISOString().replace(/[:.]/g, '-'),
  )
  mkdirSync(outDir, { recursive: true })

  // ── Baseline → search → held-out gate, in one call ───────────────────────
  // gen0 races the fixed baselines (`sample`, `refine`) — that tournament IS
  // the baseline measurement. Each generation an author model writes candidate
  // strategies from the incumbent's losses. The verdict re-measures gen0's
  // champion and the final champion fresh, paired, on the held-out slice.
  const report = await runStrategyEvolution({
    environment: sweLiveEnv,
    tasks: fetchSweLiveTasks,
    trainN,
    holdoutN,
    worker: {
      routerBaseUrl,
      routerKey,
      workerProfile: routerProfile('swe-live-worker', workerModel, undefined, 12),
      complete,
    },
    author: {
      profile: routerProfile('swe-live-author', authorModel, strategyAuthorSystemPrompt),
      executor: { backend: 'router', routerBaseUrl, routerKey, complete },
    },
    baselines: [sample, refine],
    budget: Number(process.env.BUDGET ?? 2),
    generations: Number(process.env.GENERATIONS ?? 2),
    populationSize: Number(process.env.POP ?? 2),
    outDir,
  })

  // ── The durable experiment record ────────────────────────────────────────
  const reportPath = join(outDir, 'evolution-report.json')
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')

  const tracker = new ExperimentTracker({
    store: fileExperimentStore(join(outDir, 'experiments.json')),
  })
  const holdoutScore = (name: string): number => {
    const summary = report.holdout.perStrategy[name]
    if (!summary) throw new Error(`holdout report carries no strategy named ${name}`)
    return summary.score * 100
  }
  await tracker.create({
    id: 'gen0-champion',
    label: `baseline champion: ${report.gen0Champion.name}`,
    changeSummary: 'fixed baselines raced at equal budget',
  })
  await tracker.addRep('gen0-champion', {
    score: holdoutScore(report.gen0Champion.name),
    runId: `${report.gen0Champion.name}@holdout`,
    evidence: [{ kind: 'artifact', uri: `file://${reportPath}` }],
  })
  await tracker.create({
    id: 'evolved-champion',
    label: `evolved champion: ${report.finalChampion.name}`,
    parentId: 'gen0-champion',
    changeSummary: 'authored strategies, tournament-selected across generations',
  })
  const evolved = await tracker.addRep('evolved-champion', {
    score: holdoutScore(report.finalChampion.name),
    passed: report.verdict.promoted,
    runId: `${report.finalChampion.name}@holdout`,
    evidence: [{ kind: 'artifact', uri: `file://${reportPath}` }],
  })

  const v = report.verdict
  console.log(`gen0 champion:   ${report.gen0Champion.name}`)
  console.log(`final champion:  ${report.finalChampion.name}`)
  console.log(`promoted:        ${v.promoted}  (${v.reason})`)
  console.log(
    `held-out lift:   mean ${v.lift.mean.toFixed(3)} [${v.lift.low.toFixed(3)}, ${v.lift.high.toFixed(3)}], n=${v.n}`,
  )
  console.log(
    `spend:           $${spend.usd.toFixed(2)} over ${spend.calls} calls (ceiling $${maxUsd})`,
  )
  console.log(`experiment log:  ${join(outDir, 'experiments.json')} (verdict: ${evolved.verdict})`)
  console.log(`full report:     ${reportPath}`)
}

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

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
