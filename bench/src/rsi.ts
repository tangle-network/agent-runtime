/**
 * The RSI driver experiment, instantiated. The whole thing in one file: pick a
 * benchmark adapter, pick the steer POLICIES (the arms), run them through the one
 * flow at equal compute, read the result. Everything else is the library
 * (src/experiment.ts). Adding a benchmark is one import; adding a policy is one
 * steer function.
 *
 *   BENCH=swe-bench N=20 ROUNDS=3 tsx src/rsi.ts
 *
 * Caveat: `blind`/`random` are independent fresh attempts (the compute control).
 * A `continue` / "build on your prior work" policy is only meaningful with
 * CONTINUED-SESSION execution (the kernel reusing one box across turns); the loop
 * is fresh-box-per-attempt today, so it would degrade to a re-attempt. The
 * prompt-steering policies below (critical-audit, aggressive-push) are live now.
 */
import { Sandbox } from '@tangle-network/sandbox'
import { createAecBenchAdapter } from './benchmarks/aec-bench'
import { createAppWorldAdapter } from './benchmarks/appworld'
import { createCommit0Adapter } from './benchmarks/commit0'
import { createFinsearchcompAdapter } from './benchmarks/finsearchcomp'
import { createProgrambenchAdapter } from './benchmarks/programbench'
import { createSweBenchAdapter } from './benchmarks/swe-bench'
import type { BenchmarkAdapter } from './benchmarks/types'
import { type Arm, analystArm, arm, llmAnalyst, randomArm, runExperiment, sandboxAgentRun } from './experiment'

const must = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`env ${k} is required`)
  return v
}

// The benchmark roster. Long-horizon adapters slot in here as one entry each; the
// loop below never changes. aec-bench carries a graded correctable middle band
// with a deterministic (non-oracle) judge — the candidate for the open
// diverse-strategy-vs-blind gate that SWE-bench (0 headroom) did not satisfy.
const ADAPTERS: Record<string, () => BenchmarkAdapter> = {
  'swe-bench': createSweBenchAdapter,
  finsearchcomp: createFinsearchcompAdapter,
  'aec-bench': createAecBenchAdapter,
  commit0: createCommit0Adapter,
  programbench: createProgrambenchAdapter,
  appworld: createAppWorldAdapter,
}

async function main() {
  const make = ADAPTERS[process.env.BENCH ?? 'swe-bench']
  if (!make) throw new Error(`unknown BENCH=${process.env.BENCH} (have: ${Object.keys(ADAPTERS).join(', ')})`)
  const adapter = make()
  const model = process.env.WORKER_MODEL ?? 'gpt-5'
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('TANGLE_API_KEY')
  const rounds = Number(process.env.ROUNDS ?? 3)
  const router = { routerBaseUrl, routerKey, model }
  const client = new Sandbox({
    baseUrl: process.env.SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools',
    apiKey: routerKey,
    timeoutMs: 1_200_000,
  } as never)

  // The steer policies under test. Each is an arm = a steer f(rootPrompt, history).
  const policies: [Arm, ...Arm[]] = [
    randomArm('blind'), // compute control: independent retries, no steer
    analystArm('critical-audit', llmAnalyst(router)), // audit the prior attempt, steer on the findings
    arm('aggressive-push', (root, _h, r) =>
      r === 0 ? root : `${root}\n\nShip the most complete working end-to-end result NOW. Prefer done over polish; finish it.`),
  ]

  const corpus = process.env.CORPUS ?? `${process.cwd()}/corpus/rsi-${adapter.name}.jsonl`
  const r = await runExperiment({
    adapter,
    sandboxClient: client,
    agentRun: sandboxAgentRun({ model, routerBaseUrl, routerKey }),
    arms: policies,
    model,
    rounds,
    n: Number(process.env.N ?? 10),
    ids: process.env.IDS ? process.env.IDS.split(',') : undefined,
    concurrency: Number(process.env.CONCURRENCY ?? 3),
    ...(adapter.output ? { output: adapter.output } : {}),
    corpusPath: corpus,
  })

  const pct = (x: number) => (r.n > 0 ? `${((x / r.n) * 100).toFixed(1)}%` : 'n/a')
  console.log(`\n=== ${adapter.name}: ${r.arms.length} policies x rounds=${rounds} (clean n=${r.n}, excluded ${r.errored}) ===`)
  console.log(`  blind (1 attempt): ${pct(r.blind)}`)
  for (const a of r.arms) {
    const tag = a.label === r.arms[0]?.label ? '  <- compute control' : `  delta vs control ${((a.deltaVsControl / Math.max(r.n, 1)) * 100).toFixed(1)}pp`
    console.log(`  ${a.label}@${rounds}: ${pct(a.resolved)}${tag}`)
  }
  console.log(`corpus: ${corpus}  ->  paired CI + BH via: tsx src/corpus-report.mts ${corpus}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
