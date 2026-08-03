/**
 * HumanEval deployable-verifier gate — the thesis test the answer-oracle benches
 * (aec-bench, finsearch) could not reach.
 *
 * The repo's deployable self-consistency selector LOSES on both aec-bench (−9.4pp)
 * and finsearch (−8.2pp): diversity opens a large ORACLE ceiling, but the selector
 * cannot capture it because those benches verify by RECOMPUTING the gold answer (an
 * oracle, not a deployable check). Code+tests is the deployable-checker regime — the
 * agent runs the task's provided tests (which it legitimately has in production) and
 * keeps a passer. This file asks: at EQUAL k, does diverse@k + a deployable
 * verifier-grounded pick beat random@k + the same pick, and beat blind@1?
 *
 * SCOPE — read the numbers as a LOWER BOUND. Here a "shot" is a single STATELESS
 * completion (one router call, `maxTurns=0`, NO `AgentProfile` / sandbox / keystone —
 * it calls the router directly). That is the *degenerate* rollout (HARNESS.md's
 * "Terminology"): it isolates the SELECTOR with the generator unable to self-correct,
 * so it measures the selector's value at its MAXIMUM. A real rollout (an `AgentProfile`
 * through `runAgentRounds`, `maxTurns>0` over a persistent workspace) self-verifies by
 * iterating, which shrinks the external selector's job — that is the next experiment,
 * not this one. A positive result here is the science (the selector works in a
 * deployable-checker regime), not the product.
 *
 * Two paired arms over the SAME tasks (each "shot" = one stateless completion):
 *   random@K  — K identical-base-prompt completions/task (the compute control)
 *   diverse@K — K completions, the i-th prefixed with composeStrategies(base, K)[i]
 *
 * The DEPLOYABLE CHECKER runs each candidate against the task's own `test` in an
 * isolated `--network=none` python:3.12-slim container (hard timeout) — exit 0 = pass.
 * No gold `canonical_solution` is ever shown to the model or the selector.
 *
 * Metrics (paired across the same tasks):
 *   blind pass@1       — first attempt passes
 *   random-pass@k      — verifierGroundedSelect over the K random shots passes
 *   diverse-pass@k     — verifierGroundedSelect over the K diverse shots passes
 *   oracle@k           — any of the K passes (the ceiling)
 *   self-consistency@k — selfConsistencySelect (answer-clustering, NOT the checker)
 *                        over the diverse shots — the direct contrast with the
 *                        −8/−9pp answer-oracle selector.
 * Each delta carries a 95% paired-bootstrap CI.
 *
 *   N=20 K=4 npx tsx src/humaneval-gate.mts
 */

import { composeStrategies } from './directives'
import { basePrompt, type CheckResult, extractCode, type HumanEvalTask, loadHumanEval, runChecker } from './benchmarks/humaneval'
import type { RouterConfig } from '@tangle-network/agent-runtime/kernel'
import { runBenchRouterTurn } from './router-turn'
import { selfConsistencySelect, verifierGroundedSelect } from './selector'
import { type PairedLift, pairedLift, pool } from './stats.mts'

const dockerImage = 'python:3.12-slim'
const dockerTimeoutMs = Number(process.env.DOCKER_TIMEOUT_MS ?? 20000)

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

interface Attempt {
  code: string
  pass: number
}

interface TaskOutcome {
  taskId: string
  randomAttempts: Attempt[]
  diverseAttempts: Attempt[]
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const pp = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`

async function main(): Promise<void> {
  const n = Number(process.env.N ?? 20)
  const k = Number(process.env.K ?? 4)
  const offset = Number(process.env.OFFSET ?? 0)
  const model = process.env.WORKER_MODEL ?? 'deepseek-v4-flash'
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('TANGLE_API_KEY')
  const solveConcurrency = Number(process.env.CONCURRENCY ?? 8)
  const dockerConcurrency = Number(process.env.DOCKER_CONCURRENCY ?? 6)

  if (!Number.isInteger(n) || n < 1) throw new Error(`N must be a positive integer, got ${process.env.N}`)
  if (!Number.isInteger(k) || k < 1) throw new Error(`K must be a positive integer, got ${process.env.K}`)
  if (!Number.isInteger(offset) || offset < 0) throw new Error(`OFFSET must be a non-negative integer, got ${process.env.OFFSET}`)

  const cfg: RouterConfig = { routerBaseUrl, routerKey, model }

  console.log(`=== HumanEval deployable-verifier gate · N=${n} K=${k} offset=${offset} model=${model} ===`)
  console.log(`  router=${routerBaseUrl}  docker=${dockerImage} (--network=none, timeout ${dockerTimeoutMs}ms)`)
  console.log(
    '  regime: STATELESS single completions (maxTurns=0, no AgentProfile/sandbox) — the selector no-self-correction LOWER BOUND, not a rollout/product number',
  )

  const tasks = await loadHumanEval(n, offset)
  console.log(`loaded ${tasks.length} HumanEval task(s): ${tasks.map((t) => t.taskId).join(', ')}`)

  // Build the full work set: per task, K random + K diverse solve calls.
  type Unit = { taskIdx: number; arm: 'random' | 'diverse'; shot: number; prompt: string }
  const units: Unit[] = []
  for (let ti = 0; ti < tasks.length; ti += 1) {
    const task = tasks[ti] as HumanEvalTask
    const base = basePrompt(task)
    const diverse = composeStrategies(base, k)
    for (let s = 0; s < k; s += 1) {
      units.push({ taskIdx: ti, arm: 'random', shot: s, prompt: base })
      units.push({ taskIdx: ti, arm: 'diverse', shot: s, prompt: diverse[s] as string })
    }
  }
  console.log(`\n▶ solving ${units.length} attempts (${tasks.length} tasks × ${k} shots × 2 arms) via router, conc=${solveConcurrency}`)

  const codes = await pool(units, solveConcurrency, async (u) => {
    const res = await runBenchRouterTurn(
      {
        routerBaseUrl: cfg.routerBaseUrl,
        routerKey: cfg.routerKey,
        profile: {
          name: 'humaneval-gate-worker',
          model: { provider: 'tangle-router', default: cfg.model },
        },
        temperature: Number(process.env.TEMPERATURE ?? '0.8'),
      },
      u.prompt,
    )
    return extractCode(res.finalText)
  })

  console.log(`▶ running ${codes.length} candidates through the Docker deployable checker, conc=${dockerConcurrency}`)
  const passes = await pool(units, dockerConcurrency, (u, i) => runChecker(tasks[u.taskIdx] as HumanEvalTask, codes[i] as string))

  // Regroup into per-task arms, preserving shot order.
  const outcomes: TaskOutcome[] = tasks.map((t) => ({ taskId: t.taskId, randomAttempts: [], diverseAttempts: [] }))
  units.forEach((u, i) => {
    const att: Attempt = { code: codes[i] as string, pass: (passes[i] as CheckResult).pass }
    const o = outcomes[u.taskIdx] as TaskOutcome
    if (u.arm === 'random') o.randomAttempts[u.shot] = att
    else o.diverseAttempts[u.shot] = att
  })

  // Per-task {0,1} outcomes for each metric, aligned across the same tasks.
  const blind: number[] = []
  const randomAtK: number[] = []
  const diverseAtK: number[] = []
  const oracleAtK: number[] = []
  const selfConsistencyAtK: number[] = []

  for (const o of outcomes) {
    const rPasses = o.randomAttempts.map((a) => a.pass)
    const dPasses = o.diverseAttempts.map((a) => a.pass)
    // blind = first random shot (one-shot baseline)
    blind.push((o.randomAttempts[0] as Attempt).pass)
    // random@k = verifier-grounded pick over the K random shots
    randomAtK.push((o.randomAttempts[verifierGroundedSelect(rPasses)] as Attempt).pass)
    // diverse@k = verifier-grounded pick over the K diverse shots
    diverseAtK.push((o.diverseAttempts[verifierGroundedSelect(dPasses)] as Attempt).pass)
    // oracle@k = any diverse shot passes (the ceiling the diverse arm opens)
    oracleAtK.push(dPasses.some((p) => p > 0) ? 1 : 0)
    // self-consistency@k = answer-clustering pick over the diverse shots (the
    // −8/−9pp answer-oracle selector; uses code text, NOT the checker).
    const scIdx = selfConsistencySelect(o.diverseAttempts.map((a) => a.code))
    selfConsistencyAtK.push((o.diverseAttempts[scIdx] as Attempt).pass)
  }

  const rate = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length

  const blindRate = rate(blind)
  const randomRate = rate(randomAtK)
  const diverseRate = rate(diverseAtK)
  const oracleRate = rate(oracleAtK)
  const scRate = rate(selfConsistencyAtK)
  // oracle ceiling of the RANDOM arm — for the diverse-vs-random ceiling contrast.
  const randomOracleRate = rate(outcomes.map((o) => (o.randomAttempts.some((a) => a.pass > 0) ? 1 : 0)))

  console.log(`\n${'='.repeat(78)}`)
  console.log(`RESULTS · HumanEval · n=${tasks.length} tasks · k=${k} · model=${model}`)
  console.log('='.repeat(78))
  console.log(`  blind pass@1               ${pct(blindRate)}`)
  console.log(`  random-pass@k (verifier)   ${pct(randomRate)}`)
  console.log(`  diverse-pass@k (verifier)  ${pct(diverseRate)}`)
  console.log(`  oracle@k (diverse, any)    ${pct(oracleRate)}    [random-arm oracle ${pct(randomOracleRate)}]`)
  console.log(`  self-consistency@k         ${pct(scRate)}    (answer-clustering selector over the diverse set)`)

  const liftDiverseVsRandom = pairedLift(randomAtK, diverseAtK)
  const liftRandomVsBlind = pairedLift(blind, randomAtK)
  const liftDiverseVsBlind = pairedLift(blind, diverseAtK)
  const liftScVsRandom = pairedLift(randomAtK, selfConsistencyAtK)
  const liftDiverseVsScVerifier = pairedLift(selfConsistencyAtK, diverseAtK)

  const row = (label: string, l: PairedLift) =>
    console.log(
      `  ${label.padEnd(34)} ${pp(l.point).padStart(7)}   CI [${pp(l.low)}, ${pp(l.high)}]   (paired ${l.pairs}, discordant ${l.discordant})`,
    )

  console.log(`\n  PAIRED LIFTS (95% bootstrap CI, B=10000):`)
  row('diverse@k − random@k (verifier)', liftDiverseVsRandom)
  row('random@k − blind (compute)', liftRandomVsBlind)
  row('diverse@k − blind (total)', liftDiverseVsBlind)
  row('self-consistency@k − random@k', liftScVsRandom)
  row('verifier-pick − sc-pick (diverse)', liftDiverseVsScVerifier)

  const sig = (l: PairedLift) => (l.low > 0 ? 'POSITIVE (CI excludes 0)' : l.high < 0 ? 'NEGATIVE (CI excludes 0)' : 'n.s. (CI spans 0)')
  console.log(`\n  VERDICT:`)
  console.log(`    diverse@k beats blind@1?       ${liftDiverseVsBlind.point > 0 ? 'yes' : 'no'} (${pp(liftDiverseVsBlind.point)}, ${sig(liftDiverseVsBlind)})`)
  console.log(`    diverse@k beats random@k @k?   ${liftDiverseVsRandom.point > 0 ? 'yes' : 'no'} (${pp(liftDiverseVsRandom.point)}, ${sig(liftDiverseVsRandom)})`)
  console.log(`    is the diversity ceiling capturable with a deployable checker?`)
  console.log(`      diverse oracle ${pct(oracleRate)} → verifier-pick ${pct(diverseRate)} (gap ${pp(oracleRate - diverseRate)});`)
  console.log(`      contrast: the SAME diverse set under the answer-clustering selector resolves ${pct(scRate)} (verifier−sc ${pp(diverseRate - scRate)}).`)
}

main().catch((err) => {
  console.error(`humaneval-gate: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
