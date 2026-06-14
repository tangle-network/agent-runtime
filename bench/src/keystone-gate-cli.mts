/**
 * Run the diverse-vs-blind gate THROUGH the recursive keystone, end to end, in two lines:
 *
 *   export TANGLE_API_KEY=...        # router + the deployable judge's creds
 *   BENCH=enterpriseops-gym EOPS_FIXTURES=1 N=20 K=4 tsx src/keystone-gate-cli.mts
 *
 * The arms are equal-k by construction (both open K children; blind = K identical copies,
 * diverse = K distinct strategy directives). The deployable selector is the benchmark's OWN
 * judge — pick a benchmark whose `adapter.judge` is a runnable checker (enterpriseops-gym,
 * swe-bench, terminal-bench), NOT an LLM-judge bench (finsearchcomp), or the selector is not
 * deployable and the result does not answer the gate.
 *
 * Output is a verdict-first report: the headline delta, the per-arm resolve table, the equal-k
 * proof, and the per-task paired booleans (feed them to a paired-bootstrap + BH downstream — a
 * single CLI run is the instrument, not the significance test).
 */

import type { AgentProfile } from '@tangle-network/agent-runtime/loops'
import { resolveAdapter } from './adapters'
import { runKeystoneGate } from './keystone-gate'

const must = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`env ${k} is required`)
  return v
}

/** Four content-free, genuinely distinct solve strategies — the diverse arm. K = this length;
 *  the blind arm runs K identical copies, so the two arms are equal-k. Trim/extend to change K. */
const defaultStrategies: ReadonlyArray<string> = [
  'Restate the task in your own words, then solve it directly and concisely.',
  'Decompose the task into ordered sub-steps; solve each, then assemble the final deliverable.',
  'Identify the most likely failure mode for this task FIRST, then produce a solution that explicitly avoids it.',
  'Produce a first solution, critique it against every stated requirement, then output the corrected final version only.',
]

async function main(): Promise<void> {
  const benchKey = process.env.BENCH ?? 'enterpriseops-gym'
  const adapter = resolveAdapter(benchKey)
  const model = process.env.WORKER_MODEL ?? 'gpt-4.1'
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('TANGLE_API_KEY')
  const k = Number(process.env.K ?? defaultStrategies.length)
  const strategies = defaultStrategies.slice(0, k)
  if (strategies.length < 2) throw new Error('K must be >= 2')

  const profile = {
    name: 'keystone-gate-solver',
    model: { default: model },
    prompt: { systemPrompt: 'You are an expert agent. Produce the single best deliverable the task’s grader will accept.' },
  } as unknown as AgentProfile

  const report = await runKeystoneGate({
    adapter,
    profile,
    strategies,
    routerBaseUrl,
    routerKey,
    model,
    ...(process.env.TEMPERATURE ? { temperature: Number(process.env.TEMPERATURE) } : {}),
    n: Number(process.env.N ?? 20),
    ...(process.env.IDS ? { ids: process.env.IDS.split(',') } : {}),
    ...(process.env.SPLIT ? { split: process.env.SPLIT } : {}),
    ...(process.env.PER_CHILD_TOKENS ? { perChildTokens: Number(process.env.PER_CHILD_TOKENS) } : {}),
  })

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`
  const blind = report.arms.find((a) => a.label === 'blind')!
  const diverse = report.arms.find((a) => a.label === 'diverse')!

  console.log(`\n=== keystone gate: ${report.benchmark} (k=${report.k}, n=${report.n}) ===`)
  console.log(
    `VERDICT: diverse ${report.deltaScorePp >= 0 ? '+' : ''}${report.deltaScorePp.toFixed(1)}pp graded-score ` +
      `(binary ${report.deltaPp >= 0 ? '+' : ''}${report.deltaPp.toFixed(1)}pp) vs blind` +
      ` — equal-k=${report.equalK.withinTolerance ? 'OK' : 'VIOLATED'} (token spread ${report.equalK.spread.tokens})`,
  )
  console.log('arm      resolved  errored  resolveRate  meanScore  tokens')
  for (const a of [blind, diverse]) {
    const tok = a.totalSpend.tokens.input + a.totalSpend.tokens.output
    console.log(
      `${a.label.padEnd(8)} ${String(a.resolved).padStart(8)} ${String(a.errored).padStart(8)} ` +
        `${pct(a.resolveRate).padStart(11)}  ${pct(a.meanScore).padStart(9)}  ${tok}`,
    )
  }
  for (const a of [blind, diverse]) {
    if (a.errored > 0) console.log(`  ${a.label} first failure: ${a.sampleBlocker}`)
  }
  const erroredFrac = (blind.errored + diverse.errored) / (2 * report.n)
  if (erroredFrac > 0.2) {
    console.log(`\nWARNING: ${(erroredFrac * 100).toFixed(0)}% of runs ERRORED — this 0%/delta is NOT a clean gate result; fix the failure above first.`)
  }
  if (!report.equalK.withinTolerance) {
    console.log('\nWARNING: arms are NOT at equal compute — the delta is confounded, not a gate result.')
  }
  console.log(`\npaired (id: blind|diverse): ${report.perTask.map((t) => `${t.id}:${t.blind ? 1 : 0}|${t.diverse ? 1 : 0}`).join('  ')}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
