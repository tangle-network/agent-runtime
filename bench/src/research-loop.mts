/**
 * Stateful research leaderboard — the research benches run through the REAL kernel
 * (`runExperiment` → `runLoop` + `createDriver`), NOT the flat one-shot RAG pool.
 * Same retrieve→answer body as `research-gate.mts` (shared `runResearchShot`), but driven
 * over `ROUNDS` with analyst steering: each round the arm reshapes the prompt from the
 * prior round's trace, so this is the multi-round, resumable-by-steer DEPTH regime — the
 * thing the one-shot leaderboard is not. The executor is router-backed (off-sandbox), so
 * search works and the kernel never touches a box (see router-executor.ts).
 *
 *   dotenvx run -f ~/company/devops/secrets/.env.keys -f ~/company/devops/secrets/agent-state.env -- \
 *     env BENCH=finsearchcomp MODEL=gpt-4o-mini SEARCH=you N=10 ROUNDS=3 CONCURRENCY=3 \
 *     JUDGE_MODEL=gpt-4o-mini CORPUS=/tmp/research-loop-you.jsonl tsx src/research-loop.mts
 *   tsx src/corpus-report.mts <armA.jsonl> <armB.jsonl>   # paired-bootstrap across arms
 */
import { ADAPTERS } from './adapters'
import { type Arm, analystArm, answerOutput, arm, llmAnalyst, randomArm, runExperiment, sandboxAgentRun } from './experiment'
import type { ShotCfg } from './research-shot'
import { routerSandboxClient } from './router-executor'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

async function main(): Promise<void> {
  const benchName = process.env.BENCH ?? 'finsearchcomp'
  const makeAdapter = ADAPTERS[benchName]
  if (!makeAdapter) throw new Error(`unknown BENCH=${benchName} (have: ${Object.keys(ADAPTERS).join(', ')})`)

  const model = process.env.MODEL ?? process.env.WORKER_MODEL ?? 'gpt-4o-mini'
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('TANGLE_API_KEY')
  const search = process.env.SEARCH ?? 'you'
  const rounds = Number(process.env.ROUNDS ?? 3)
  const n = Number(process.env.N ?? 10)
  const concurrency = Number(process.env.CONCURRENCY ?? 3)
  if (!Number.isInteger(rounds) || rounds < 1) throw new Error(`ROUNDS must be a positive integer, got ${process.env.ROUNDS}`)
  if (!Number.isInteger(n) || n < 1) throw new Error(`N must be a positive integer, got ${process.env.N}`)

  const cfg: ShotCfg = {
    model,
    search,
    maxResults: Number(process.env.SEARCH_MAX_RESULTS ?? 5),
    fetchTopK: Number(process.env.FETCH_TOP_K ?? 3),
    temperature: Number(process.env.TEMPERATURE ?? 0.7),
    routerBaseUrl,
    routerKey,
    timeoutMs: process.env.SHOT_TIMEOUT_MS ? Number(process.env.SHOT_TIMEOUT_MS) : 600_000,
  }
  const router = { routerBaseUrl, routerKey, model }

  // The steer policies under test — arm[0] is the compute control (independent retries).
  const policies: [Arm, ...Arm[]] = [
    randomArm('blind'), // compute control: ROUNDS independent shots, no steer
    analystArm('critical-audit', llmAnalyst(router)), // audit the prior answer, steer the next search+answer
    arm('aggressive-push', (root, _h, r) =>
      r === 0
        ? root
        : `${root}\n\nYour prior answer was incomplete or imprecise. Search again with a more specific query, then COMMIT a single more precise final value now.`),
  ]

  const adapter = makeAdapter()
  console.log(
    `=== research LOOP (router executor · real kernel) · bench=${benchName} · model=${model} · search=${search} · N=${n} ROUNDS=${rounds} conc=${concurrency} ===`,
  )
  await adapter.preflight()

  const corpus = process.env.CORPUS ?? `${process.cwd()}/corpus/research-loop-${adapter.name}-${search}.jsonl`
  const r = await runExperiment({
    adapter,
    sandboxClient: routerSandboxClient(cfg),
    agentRun: sandboxAgentRun({ model, routerBaseUrl }),
    arms: policies,
    model,
    rounds,
    n,
    ids: process.env.IDS ? process.env.IDS.split(',') : undefined,
    concurrency,
    output: answerOutput,
    corpusPath: corpus,
  })

  const pct = (x: number) => (r.n > 0 ? `${((x / r.n) * 100).toFixed(1)}%` : 'n/a')
  console.log(`\n=== ${adapter.name}: ${r.arms.length} policies × rounds=${rounds} (clean n=${r.n}, excluded ${r.errored}) ===`)
  console.log(`  blind (1 round): ${pct(r.blind)}`)
  for (const a of r.arms) {
    const tag =
      a.label === r.arms[0]?.label
        ? '  <- compute control'
        : `  delta vs control ${((a.deltaVsControl / Math.max(r.n, 1)) * 100).toFixed(1)}pp`
    console.log(`  ${a.label}@${rounds}: ${pct(a.resolved)}${tag}`)
  }
  console.log(`corpus: ${corpus}  ->  paired CI + BH via: tsx src/corpus-report.mts ${corpus}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
})
