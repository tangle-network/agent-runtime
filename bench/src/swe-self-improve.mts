/**
 * SWE-bench self-improvement — the PROPER, no-cheating run: a frontier worker over the SWE-bench
 * `Environment`, with `runStrategyEvolution` enforcing the train→freeze→holdout split (the substrate
 * draws a disjoint holdout slice and gates once — adaptive reuse is impossible). CONTAMINATION CAVEAT
 * applies (public fixes may be memorized) — reported, never claimed clean.
 *
 *   CALIBRATE first (cost gate):  TANGLE_API_KEY=… CALIBRATE=1 N=3 tsx bench/src/swe-self-improve.mts
 *   Full run:                     TANGLE_API_KEY=… TRAIN_N=6 HOLDOUT_N=8 GENERATIONS=2 tsx bench/src/swe-self-improve.mts
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  refine,
  runAgentic,
  runStrategyEvolution,
  sample,
  strategyAuthorSystemPrompt,
} from '@tangle-network/agent-runtime/kernel'
import { createSweBenchEnvironment } from './swe-bench-env'

async function main(): Promise<void> {
  const routerKey = process.env.TANGLE_API_KEY
  if (!routerKey) throw new Error('TANGLE_API_KEY required (worker + author call the router)')
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const workerModel = process.env.WORKER_MODEL ?? 'deepseek-v4-flash'
  const authorModel = process.env.AUTHOR_MODEL ?? 'deepseek-v4-flash'
  const innerTurns = Number(process.env.INNER_TURNS ?? 40)
  const workerProfile: AgentProfile = {
    name: 'swe-worker',
    harness: 'cli-base',
    model: {
      provider: 'tangle-router',
      default: workerModel,
      metadata: { maxTurns: innerTurns },
      maxVisibleOutputTokens: 8000,
    },
  }
  const authorProfile = (model: string, name: string): AgentProfile => ({
    name,
    harness: 'cli-base',
    model: {
      provider: 'tangle-router',
      default: model,
      maxVisibleOutputTokens: 8000,
    },
    prompt: { systemPrompt: strategyAuthorSystemPrompt },
  })
  const { environment, tasks } = await createSweBenchEnvironment(Number(process.env.POOL_N ?? 80))

  if (process.env.CALIBRATE === '1') {
    const n = Number(process.env.N ?? 3)
    const ts = await tasks(0, n)
    console.log(`═══ SWE-bench CALIBRATION — ${workerModel}, baseline=refine, ${n} real bugs ═══`)
    let resolved = 0
    for (const t of ts) {
      const t0 = Date.now()
      const r = await runAgentic({
        surface: environment,
        task: t,
        strategy: refine,
        routerBaseUrl,
        routerKey,
        workerProfile,
        budget: 1,
      })
      if (r.resolved) resolved++
      console.log(`  ${t.id.padEnd(32)} resolved=${r.resolved} completions=${r.completions} shots=${r.shots} (${Math.round((Date.now() - t0) / 1000)}s)`)
    }
    const band = resolved > 0 && resolved < n
    console.log(`\n>>> baseline resolved ${resolved}/${n}. ${band ? 'HEADROOM — the loop has room to improve. PROCEED.' : resolved === 0 ? 'TOO HARD / env issue — inspect before the loop.' : 'saturated at this small n — raise N.'}`)
    return
  }

  const report = await (async () => {
    const outDir = mkdtempSync(join(process.cwd(), '.swe-run-'))
    try {
      return await runStrategyEvolution({
        environment,
        tasks,
        trainN: Number(process.env.TRAIN_N ?? 6),
        holdoutN: Number(process.env.HOLDOUT_N ?? 8),
        worker: { routerBaseUrl, routerKey, workerProfile },
        author: {
          profile: authorProfile(authorModel, 'swe-strategy-author'),
          executor: { backend: 'router', routerBaseUrl, routerKey },
          fallbackProfile: authorProfile(
            process.env.AUTHOR_FALLBACK ?? 'deepseek-v4-flash',
            'swe-strategy-author-fallback',
          ),
        },
        baselines: [sample, refine],
        budget: Number(process.env.BUDGET ?? 2),
        generations: Number(process.env.GENERATIONS ?? 2),
        populationSize: Number(process.env.POP ?? 2),
        outDir,
      })
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  })()

  const v = report.verdict
  console.log('\n═══ SWE-bench SELF-IMPROVEMENT — certified on a FROZEN holdout (CONTAMINATION-flagged) ═══')
  console.log(`worker=${workerModel}  author=${authorModel}`)
  console.log(`gen0 champion:   ${report.gen0Champion.name}`)
  console.log(`final champion:  ${report.finalChampion.name}`)
  console.log(`PROMOTED:        ${v.promoted}  (${v.reason})`)
  console.log(`held-out lift:   mean ${v.lift.mean.toFixed(3)}  95% CI [${v.lift.low.toFixed(3)}, ${v.lift.high.toFixed(3)}]  n=${v.n}`)
  console.log(
    v.promoted
      ? '\n>>> The search taught the agent a strategy that resolves MORE real bugs it never trained on, beyond luck. (Report the contamination caveat: public fixes may be memorized.)'
      : '\n>>> No promotion: the evolved strategy did not beat gen0 on the fresh holdout beyond noise (honest null).',
  )
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
