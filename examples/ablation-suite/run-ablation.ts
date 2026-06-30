/**
 * run-ablation — the continuous vs ralph vs supervisor three-way on a contamination-proof oscillation
 * eval, with the full cost-aware autopsy (resolve, score, tokens, calls, shots, $, latency, per-tool).
 *
 * This is the harness behind the headline result (supervisor +20.8pp over a single agent at n=24 on a
 * weak model; see README.md). The three arms:
 *   - continuous (`refine`)      one worker, carries its conversation across shots.
 *   - ralph (`ralph` strategy)   one persistent file, FRESH context each round.
 *   - supervisor (`driverSteer`) a driver brain spawning serial workers, with the failuresAnalyst.
 *
 * Run:  TANGLE_API_KEY=…  tsx examples/ablation-suite/run-ablation.ts
 *   ARMS=cal        regime check first (continuous only — does it still FAIL? if it aces the eval there
 *                   is no middle band for the supervisor to win in; bump difficulty before spending).
 *   EVAL=verkit     swap the synthetic eval for the real-library reconstruction (verkit-env).
 *   HOLDOUT_N / BUDGET / WORKER_MODEL / DRIVER_MODEL / MAX_TOKENS / OFFSET override the defaults.
 */
import { printAutopsy, runAblation } from './ablation'
import { longCodingEnv, longCodingTasks } from './long-coding-env-lite'
import { persistentSurface } from './persistent-surface'
import { verkitEnv, verkitTasks } from './verkit-env'

const routerKey = process.env.TANGLE_API_KEY
if (!routerKey) throw new Error('TANGLE_API_KEY required')
const base = process.env.ROUTER_BASE_URL ?? 'https://router.tangle.tools/v1'
const workerModel = process.env.WORKER_MODEL ?? 'deepseek-v4-flash'
const driverModel = process.env.DRIVER_MODEL ?? 'deepseek-v4-flash'
const [env, tasks] =
  process.env.EVAL === 'verkit' ? [verkitEnv, verkitTasks] : [longCodingEnv, longCodingTasks]
const deltas =
  process.env.ARMS === 'cal'
    ? []
    : [
        { name: 'ralph', knob: { topology: 'ralph' as const } },
        { name: 'driver-steer', knob: { driverSteer: true as const } },
      ]

const results = await runAblation({
  environment: persistentSurface(env),
  tasks,
  holdoutOffset: Number(process.env.OFFSET ?? 0),
  holdoutN: Number(process.env.HOLDOUT_N ?? 8),
  base: { topology: 'single', budget: Number(process.env.BUDGET ?? 12) },
  deltas,
  worker: {
    routerBaseUrl: base,
    routerKey,
    model: workerModel,
    maxTokens: Number(process.env.MAX_TOKENS ?? 4000),
    innerTurns: 6,
  },
  supervisor: { model: driverModel },
  onArm: (r) =>
    console.log(
      `  ${r.name.padEnd(14)} resolve=${(100 * r.resolve).toFixed(0)}% score=${r.scoreMean.toFixed(2)} $${r.costUsd.toFixed(3)} (n=${r.n})`,
    ),
})
printAutopsy(results)
