/**
 * HumanEval self-repair gate — the TOOL-USING router backend vs blind resampling
 * at equal compute, the strongest form of the steering question.
 *
 * The earlier steering gate (the rsi analyst arm) used an LLM that AUDITED the
 * prior code WITHOUT running it — and was a null (−1.2pp, n.s.). This removes that
 * weakness: the worker gets a `run_tests` tool (the deployable Docker checker), so
 * it actually RUNS the tests, sees the real failure, and fixes — execution-grounded
 * self-repair, off-box over the Tangle router's tool-calling (no sandbox). If
 * steering ever beats compute on a deployable checker, this is where it should.
 *
 *   blind@K   — K independent completions, verifier-grounded pick           (breadth/resample)
 *   repair@K  — ONE worker, up to K tool-turns: write → run_tests → fix → …  (depth/tool-grounded)
 *
 * Equal budget: one inference turn = one router completion, so both arms spend ≤K
 * completions. Both finals are judged by the SAME check() suite. Per-task {0,1}
 * outcomes, paired 95% bootstrap CI (discordant pairs = the power).
 *
 *   TANGLE_API_KEY=… N=82 K=3 OFFSET=82 WORKER_MODEL=gpt-3.5-turbo \
 *     tsx src/humaneval-repair-gate.mts
 */
import { type HumanEvalTask, basePrompt, extractCode, loadHumanEval, runChecker } from './benchmarks/humaneval'
import {
  collectAgentTurn,
  createExecutor,
  streamAgentTurn,
  type RouterConfig,
  type ToolSpec,
} from '@tangle-network/agent-runtime/kernel'
import { verifierGroundedSelect } from './selector'
import { type PairedLift, pairedLift, pool } from './stats.mts'
import { runBenchRouterTurn } from './router-turn'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

const runTestsTool: ToolSpec = {
  type: 'function',
  function: {
    name: 'run_tests',
    description:
      "Run the task's test suite against your candidate function and return PASS or the real failure output. Verify with this before giving your final answer.",
    parameters: {
      type: 'object',
      properties: { code: { type: 'string', description: 'The COMPLETE Python function definition to test (signature + body, plus any imports).' } },
      required: ['code'],
    },
  },
}

const repairSystem = [
  'You complete a Python function. You have a run_tests tool that runs the REAL test suite against your code.',
  'Workflow: write the function, call run_tests to check it, and if it fails read the error and fix the function, then call run_tests again.',
  'When run_tests reports all tests passed, reply with the final function in a single ```python block and do NOT call the tool again.',
].join(' ')

/** repair@K: one worker, up to K inference turns, steering on real test failures. */
async function repairAttempt(cfg: RouterConfig, task: HumanEvalTask, k: number): Promise<number> {
  let lastTested = ''
  const profile = {
    name: 'humaneval-repair-worker',
    model: { provider: 'tangle-router', default: cfg.model },
    prompt: { systemPrompt: repairSystem },
    tools: { run_tests: true },
  }
  const factory = createExecutor({
    backend: 'router-tools',
    routerBaseUrl: cfg.routerBaseUrl,
    routerKey: cfg.routerKey,
    model: cfg.model,
    tools: [runTestsTool],
    executeToolCall: async (name, args) => {
      if (name !== 'run_tests') return `error: unknown tool ${name}`
      const code = extractCode(String(args.code ?? ''))
      lastTested = code
      const res = await runChecker(task, code)
      return res.pass === 1
        ? 'ALL TESTS PASSED. Reply with the final function now; do not call run_tests again.'
        : `TESTS FAILED:\n${res.detail ?? 'no output'}\n\nFix the function and call run_tests again.`
    },
    maxTurns: k,
    temperature: 0.3,
  })
  const r = await collectAgentTurn(
    streamAgentTurn({ kind: 'executor', factory, profile }, basePrompt(task)),
  )
  if (r.status !== 'completed') {
    throw new Error(r.error?.message ?? `repair turn ended with status ${r.status}`)
  }
  // Judge the model's final answer; fall back to the last code it tested (it may
  // report "done" without re-pasting the passing function).
  const finalCode = extractCode(r.finalText) || lastTested
  if (!finalCode) return 0
  return (await runChecker(task, finalCode)).pass
}

/** blind@K: K independent completions, verifier-grounded pick (the resample control). */
async function blindAttempts(cfg: RouterConfig, task: HumanEvalTask, k: number): Promise<number[]> {
  const base = basePrompt(task)
  const passes: number[] = []
  for (let i = 0; i < k; i += 1) {
    const res = await runBenchRouterTurn(
      {
        routerBaseUrl: cfg.routerBaseUrl,
        routerKey: cfg.routerKey,
        profile: {
          name: 'humaneval-blind-worker',
          model: { provider: 'tangle-router', default: cfg.model },
        },
        temperature: 0.8,
      },
      base,
    )
    passes.push((await runChecker(task, extractCode(res.finalText))).pass)
  }
  return passes
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const pp = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`

async function main(): Promise<void> {
  const n = Number(process.env.N ?? 82)
  const k = Number(process.env.K ?? 3)
  const offset = Number(process.env.OFFSET ?? 82)
  const model = process.env.WORKER_MODEL ?? 'deepseek-v4-flash'
  const cfg: RouterConfig = { routerBaseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1', routerKey: must('TANGLE_API_KEY'), model }
  const concurrency = Number(process.env.CONCURRENCY ?? 6)
  if (k < 2) throw new Error('K must be >= 2 (repair needs at least write + one fix)')

  console.log(`=== HumanEval self-repair gate · tool-using router worker · N=${n} K=${k} offset=${offset} model=${model} ===`)
  const tasks = await loadHumanEval(n, offset)
  console.log(`loaded ${tasks.length} task(s); running blind@${k} (resample) vs repair@${k} (run_tests-grounded), conc=${concurrency}\n`)

  const rows = await pool(tasks, concurrency, async (task, i) => {
    const blind = await blindAttempts(cfg, task, k)
    const repair = await repairAttempt(cfg, task, k)
    const blind1 = blind[0] ?? 0
    const blindK = blind[verifierGroundedSelect(blind)] ?? 0
    process.stderr.write(`  [${i + 1}/${tasks.length}] ${task.taskId}: blind@1=${blind1} blind@${k}=${blindK} repair@${k}=${repair}\n`)
    return { blind1, blindK, repair }
  })

  const blind1 = rows.map((r) => r.blind1)
  const blindK = rows.map((r) => r.blindK)
  const repairK = rows.map((r) => r.repair)
  const rate = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length

  console.log(`\n${'='.repeat(74)}`)
  console.log(`RESULTS · HumanEval self-repair · n=${tasks.length} · k=${k} · ${model}`)
  console.log('='.repeat(74))
  console.log(`  blind pass@1        ${pct(rate(blind1))}`)
  console.log(`  blind@${k} (resample) ${pct(rate(blindK))}`)
  console.log(`  repair@${k} (tools)   ${pct(rate(repairK))}`)

  const row = (label: string, l: PairedLift) =>
    console.log(`  ${label.padEnd(34)} ${pp(l.point).padStart(7)}   CI [${pp(l.low)}, ${pp(l.high)}]   (paired ${l.pairs}, discordant ${l.discordant})`)
  const sig = (l: PairedLift) => (l.low > 0 ? 'SIGNIF +' : l.high < 0 ? 'SIGNIF -' : 'n.s. (CI spans 0)')

  const repairVsBlind = pairedLift(blindK, repairK)
  const computeVsBlind1 = pairedLift(blind1, blindK)
  console.log(`\n  PAIRED LIFTS (95% bootstrap CI, B=10000):`)
  row(`repair@${k} − blind@${k} (steering)`, repairVsBlind)
  row(`blind@${k} − blind@1 (more-compute)`, computeVsBlind1)
  console.log(`\n  VERDICT:`)
  console.log(`    execution-grounded self-repair beats blind resampling @ equal k?  ${repairVsBlind.point > 0 ? 'yes' : 'no'} (${pp(repairVsBlind.point)}, ${sig(repairVsBlind)})`)
}

main().catch((err) => {
  console.error(`humaneval-repair-gate: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
  process.exit(1)
})
