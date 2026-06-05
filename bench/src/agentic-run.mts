/**
 * Run the general agentic primitive over EnterpriseOps — depth (sequential, same artifact) and
 * breadth (parallel), both through the keystone Supervisor. Reports the depth progress-over-shots
 * curve and a depth-vs-breadth comparison at matched compute.
 *
 *   export TANGLE_API_KEY=… EOPS_GYM_DBS_DIR=<unzipped gym_dbs.zip>   # itsm gym on :8006
 *   TASKS=4 MAX_SHOTS=5 WIDTH=5 INNER_TURNS=4 WORKER_MODEL=gpt-4.1 tsx src/agentic-run.mts
 */

import { type AgenticOptions, type AgenticTask, runAgentic } from './agentic'
import { createEopsSurface, eopsTaskFromRow } from './agentic-eops'
import { runBreadthPersonified } from './agentic-personify'

const must = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`env ${k} is required`)
  return v
}

async function loadItsmTasks(n: number): Promise<AgenticTask[]> {
  const url =
    'https://datasets-server.huggingface.co/rows?dataset=ServiceNow-AI%2FEnterpriseOps-Gym' +
    `&config=oracle&split=itsm&offset=0&length=${n}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HF rows ${res.status}`)
  const body = (await res.json()) as { rows?: Array<{ row: Parameters<typeof eopsTaskFromRow>[0] }> }
  return (body.rows ?? []).slice(0, n).map(({ row }) => eopsTaskFromRow(row))
}

async function main(): Promise<void> {
  const nTasks = Number(process.env.TASKS ?? 4)
  const maxShots = Number(process.env.MAX_SHOTS ?? 5)
  const width = Number(process.env.WIDTH ?? 5)
  const opts: AgenticOptions = {
    routerBaseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
    routerKey: must('TANGLE_API_KEY'),
    model: process.env.WORKER_MODEL ?? 'gpt-4.1',
    temperature: Number(process.env.TEMPERATURE ?? 0.7),
    innerTurns: Number(process.env.INNER_TURNS ?? 4),
  }
  const surface = createEopsSurface(must('EOPS_GYM_DBS_DIR'))
  const tasks = await loadItsmTasks(nTasks)
  console.log(`agentic primitive over EOPS: ${tasks.length} itsm tasks, ${opts.model}, maxShots=${maxShots}, width=${width}, innerTurns=${opts.innerTurns}\n`)

  const rows: Array<{ operator: number; breadth: number; cD: number; prog: number[] }> = []
  for (const [i, task] of tasks.entries()) {
    let op: Awaited<ReturnType<typeof runAgentic>>
    try {
      op = await runAgentic({ ...opts, surface, task, budget: maxShots }) // OPERATOR via the keystone Supervisor
    } catch (e) {
      console.log(`  task ${i}: OPERATOR failed — ${e instanceof Error ? e.message.slice(0, 110) : e}`)
      continue
    }
    // BREADTH via the existing `fanout` combinator (runPersonified) — best-of-width fresh rollouts.
    const breadth = await runBreadthPersonified(surface, task, opts, width)
    rows.push({ operator: op.score, breadth: breadth.score, cD: op.completions, prog: op.progression })
    console.log(
      `  task ${i} ${task.id.slice(0, 24)}: OPERATOR ${(op.score * 100).toFixed(0)}% [${op.progression.map((s) => (s * 100).toFixed(0)).join('→')}] ` +
        `${op.completions} comp  vs  BREADTH(fanout@${width}) ${(breadth.score * 100).toFixed(0)}%`,
    )
  }

  if (rows.length === 0) throw new Error('no scoreable tasks')
  const mean = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0) / rows.length
  const o = mean((r) => r.operator)
  const b = mean((r) => r.breadth)
  console.log(`\n=== n=${rows.length} (operator ~${mean((r) => r.cD).toFixed(0)} comp vs breadth fanout@${width}) ===`)
  console.log(`OPERATOR (lead steerer, same artifact): ${(o * 100).toFixed(1)}%`)
  console.log(`BREADTH  (fanout best-of):              ${(b * 100).toFixed(1)}%`)
  console.log(`VERDICT: operator ${o >= b ? 'BEATS' : 'loses to'} breadth by ${((o - b) * 100).toFixed(1)}pp`)
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
