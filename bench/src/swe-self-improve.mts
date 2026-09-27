/**
 * SWE-bench self-improvement: a frontier worker over the SWE-bench `Environment`, with
 * `runStrategyEvolution` searching strategies on disjoint train, selection and test slices. The
 * author reads train results only, strategies are ranked on the private selection slice, and the
 * claim runs once on the sealed test slice. CONTAMINATION CAVEAT applies (public fixes may be
 * memorized) — reported, never claimed clean.
 *
 *   CALIBRATE first (cost gate):  TANGLE_API_KEY=… CALIBRATE=1 N=3 tsx bench/src/swe-self-improve.mts
 *   Full run:                     TANGLE_API_KEY=… TRAIN_N=4 SELECTION_N=12 TEST_N=12 tsx bench/src/swe-self-improve.mts
 *
 * The run directory is kept (`OUT_DIR`, default `.swe-run`): its ledger is the checkpoint, so the
 * same command continues an interrupted search.
 */
import { join } from 'node:path'
import { type AgentProfile, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import {
  refine,
  runAgentic,
  runStrategyEvolution,
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

  const trainN = Number(process.env.TRAIN_N ?? 4)
  const selectionN = Number(process.env.SELECTION_N ?? 12)
  const testN = Number(process.env.TEST_N ?? 12)
  const all = await tasks(0, trainN + selectionN + testN)
  const report = await runStrategyEvolution({
    environment,
    train: all.slice(0, trainN),
    selection: all.slice(trainN, trainN + selectionN),
    test: all.slice(trainN + selectionN),
    claim: {
      use: 'comparison',
      population: { id: 'swe-bench-verified', description: 'SWE-bench Verified instances' },
      samplingFrame: 'consecutive SWE-bench Verified instances from the loaded pool',
      independentUnit: 'id',
      generalization: 'new-units',
      minimumEffect: Number(process.env.MIN_EFFECT ?? 0.15),
    },
    executionRef: canonicalCandidateDigest({
      environment: 'bench/src/swe-bench-env.ts',
      harness: 'swebench-docker',
      innerTurns,
    }),
    worker: { routerBaseUrl, routerKey, workerProfile },
    author: {
      profile: authorProfile(authorModel, 'swe-strategy-author'),
      executor: { backend: 'router', routerBaseUrl, routerKey },
      fallbackProfile: authorProfile(
        process.env.AUTHOR_FALLBACK ?? 'deepseek-v4-flash',
        'swe-strategy-author-fallback',
      ),
    },
    root: refine,
    budget: Number(process.env.BUDGET ?? 2),
    maxExpansions: Number(process.env.EXPANSIONS ?? 4),
    outDir: join(process.cwd(), process.env.OUT_DIR ?? '.swe-run'),
  })

  const shipped = report.claim.finalists.find((f) => f.nodeId === report.claim.selected)?.test
  console.log('\n═══ SWE-bench SELF-IMPROVEMENT — claimed on a SEALED test slice (CONTAMINATION-flagged) ═══')
  console.log(`worker=${workerModel}  author=${authorModel}  ledger=${report.ledger}`)
  console.log(`strategies:  ${report.strategies.map((s) => `${s.name} (${s.status})`).join(', ')}`)
  console.log(`selected:    ${report.selected.name}`)
  console.log(`DECISION:    ${report.decision}  (${report.reason})`)
  if (shipped) {
    console.log(`test lift:   ${shipped.delta.toFixed(3)}  [${shipped.interval[0].toFixed(3)}, ${shipped.interval[1].toFixed(3)}]  n=${shipped.pairs}`)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
