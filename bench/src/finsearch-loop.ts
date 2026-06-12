/**
 * FinSearchComp through the ONE flow (`runExperiment`) — a preset, not a runner.
 *
 * This used to hand-roll the refine loop, planners, corpus write, and aggregation.
 * All of that is now `runExperiment` (the benchmark-agnostic flow over the real
 * kernel). Here we only pick the knobs: the FinSearchComp adapter, the sandbox
 * backend, and the 3-way arm set (random@k control · hand-directive refine ·
 * GEPA-directive refine). The compute-matched control + paired stats are the
 * flow's, not a reimplementation's.
 */

import type { AgentRunSpec } from '@tangle-network/agent-runtime/loops'
import { Sandbox } from '@tangle-network/sandbox'
import { createFinsearchcompAdapter } from './benchmarks/finsearchcomp'
import { DEFAULT_SANDBOX_REFINE_DIRECTIVE, GEPA_LEARNED_DIRECTIVE } from './directives'
import { type Arm, randomArm, refineArm, runExperiment } from './experiment'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

async function main() {
  const model = process.env.WORKER_MODEL ?? 'gpt-5'
  const rounds = Number(process.env.ROUNDS ?? 3)
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  // 20-min transport timeout — a multi-turn web-research agent legitimately takes
  // minutes; a short cap guillotines deep research and understates every arm.
  const client = new Sandbox({
    baseUrl: process.env.SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools',
    apiKey: must('TANGLE_API_KEY'),
    timeoutMs: 1_200_000,
  } as never)

  const agentRun: AgentRunSpec<string> = {
    profile: { name: 'finsearch-worker', metadata: { backendType: 'opencode' } },
    name: 'finsearch-worker',
    taskToPrompt: (q) => q,
    sandboxOverrides: {
      // backend.model pins provider/model/baseUrl only — in-box model auth is the
      // box-provisioned OPENCODE_MODEL_API_KEY (foreign keys are 403'd at egress).
      backend: { type: 'opencode', model: { provider: 'openai', model, baseUrl: routerBaseUrl } },
    },
  }

  const arms: [Arm, ...Arm[]] = [
    randomArm('random'), // the REQUIRED compute control
    refineArm('refineHand', DEFAULT_SANDBOX_REFINE_DIRECTIVE),
    refineArm('refineGepa', GEPA_LEARNED_DIRECTIVE),
  ]

  const r = await runExperiment({
    adapter: createFinsearchcompAdapter(),
    sandboxClient: client,
    agentRun,
    arms,
    model,
    rounds,
    n: Number(process.env.N ?? 8),
    ids: process.env.IDS ? process.env.IDS.split(',') : undefined,
    concurrency: Number(process.env.CONCURRENCY ?? 3),
    corpusPath: process.env.CORPUS ?? `${process.cwd()}/corpus/finsearch.jsonl`,
  })

  const pct = (x: number) => (r.n > 0 ? `${((x / r.n) * 100).toFixed(1)}%` : 'n/a')
  const dlt = (x: number) => `${((x / Math.max(r.n, 1)) * 100).toFixed(1)} pp`
  console.log(`\n=== FinSearchComp THROUGH runExperiment — ${r.arms.length}-way (clean n=${r.n}, excluded ${r.errored} infra-errored, rounds=${rounds}) ===`)
  console.log(`  blind (1 attempt):          ${pct(r.blind)}  (${r.blind}/${r.n})`)
  for (const a of r.arms) {
    const tag = a.label === r.arms[0]?.label ? '  ← compute control' : ` · Δ vs control ${dlt(a.deltaVsControl)}`
    console.log(`  ${a.label}@${rounds}:  ${pct(a.resolved)}  (${a.resolved}/${r.n})${tag}`)
  }
  console.log(`  ► more-compute (control − blind):  ${dlt((r.arms[0]?.resolved ?? 0) - r.blind)}`)
  console.log('analysis: tsx src/corpus-report.mts (durable corpus + BH-FDR)')
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
})
