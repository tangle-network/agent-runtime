/**
 * GEPA over the ANALYST/STEERER prompt — the flywheel, on the CANONICAL loop system.
 *
 * The analyst IS the steerer: observe()'s system instruction turns an agent's trace into
 * the recommended_action that steers the next depth shot. This evolves THAT instruction
 * against the live EOPS gate, using agent-eval's GEPA primitives (NOT a hand-rolled loop):
 *   - buildReflectionPrompt / parseReflectionResponse — the reflective mutation (GEPA brain)
 *   - paretoFrontier — non-dominated selection over [maximize lift, minimize cost]
 *
 * FITNESS = the depth-vs-breadth lift on the canonical stack (Supervisor + observe()): for a
 * candidate analyst instruction, run depth (steered by it) on each task and subtract the
 * SHARED breadth baseline (computed ONCE per task — breadth has no analyst). The failing
 * tasks (low per-task lift) are the gradient the reflection reads.
 *
 *   docker run -d --rm --name eops -p 8006:8005 shivakrishnareddyma225/enterpriseops-gym-mcp-itsm:latest
 *   EOPS_GYM_DBS_DIR=<unzipped gym_dbs.zip> TANGLE_API_KEY=… \
 *     N=4 GENS=2 CHILDREN=2 MAXSHOTS=3 WORKER_MODEL=deepseek-v4-pro tsx src/eops-gepa.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { buildReflectionPrompt, paretoFrontier, parseReflectionResponse } from '@tangle-network/agent-eval'
import { defaultAnalystInstruction } from '@tangle-network/agent-runtime/loops'
import { type AgenticOptions, type AgenticTask, runAgentic } from './agentic'
import { createEopsSurface, eopsTaskFromRow } from './agentic-eops'
import { type RouterConfig, routerChatWithUsage } from './router-client'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

async function loadItsmTasks(n: number): Promise<AgenticTask[]> {
  const url = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent('ServiceNow-AI/EnterpriseOps-Gym')}&config=oracle&split=itsm&offset=0&length=${n}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`EOPS HF rows HTTP ${res.status}`)
  const body = (await res.json()) as { rows?: Array<{ row: Parameters<typeof eopsTaskFromRow>[0] }> }
  return (body.rows ?? []).slice(0, n).map(({ row }) => eopsTaskFromRow(row))
}

interface Candidate {
  id: string
  instruction: string
  gen: number
  lift?: number
  cost?: number
  perTask?: Array<{ id: string; lift: number }>
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`
const pp = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`

async function main(): Promise<void> {
  const n = Number(process.env.N ?? 4)
  const gens = Number(process.env.GENS ?? 2)
  const childCount = Number(process.env.CHILDREN ?? 2)
  const parents = Number(process.env.PARENTS ?? 2)
  const maxShots = Number(process.env.MAXSHOTS ?? 3)
  const width = Number(process.env.WIDTH ?? 3)
  const model = process.env.WORKER_MODEL ?? 'deepseek-v4-pro'
  const routerKey = must('TANGLE_API_KEY')
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const opts: AgenticOptions = { routerBaseUrl, routerKey, model, innerTurns: Number(process.env.INNER_TURNS ?? 4), temperature: 0.7 }
  const reflectCfg: RouterConfig = { routerBaseUrl, routerKey, model: process.env.REFLECT_MODEL ?? model }
  const surface = createEopsSurface(must('EOPS_GYM_DBS_DIR'))

  const tasks = await loadItsmTasks(n)
  console.error(`=== GEPA over the analyst prompt · ${tasks.length} EOPS tasks · ${model} · gens=${gens} children=${childCount} ===\n`)

  // Shared breadth baseline per task (no analyst — same for every candidate). Compute ONCE.
  // Resilient: a task whose rollouts all fail (transient gym/router infra) is SKIPPED, not
  // fatal — runAgentic is fail-loud, so we catch + drop the task and press on.
  console.error('▶ computing shared breadth baseline (once per task)…')
  const breadthByTask = new Map<string, { score: number; comps: number }>()
  const liveTasks: AgenticTask[] = []
  for (const task of tasks) {
    try {
      let breadthScore = 0
      let cB = 0
      for (let w = 0; w < width && cB < maxShots * (opts.innerTurns ?? 4); w += 1) {
        const b = await runAgentic({ ...opts, surface, task, mode: 'breadth', budget: 1 })
        cB += b.completions
        if (b.score > breadthScore) breadthScore = b.score
      }
      breadthByTask.set(task.id, { score: breadthScore, comps: cB })
      liveTasks.push(task)
      console.error(`   ${task.id.slice(-12)}: breadth ${pct(breadthScore)}`)
    } catch (e) {
      console.error(`   ${task.id.slice(-12)}: SKIP (${e instanceof Error ? e.message.slice(0, 70) : e})`)
    }
  }
  if (liveTasks.length < 2) throw new Error(`only ${liveTasks.length} task(s) survived breadth baseline — gym/router infra is down (restart the gym container)`)

  // Fitness: depth (steered by the candidate instruction) − the shared breadth baseline.
  async function fitness(instruction: string): Promise<{ lift: number; cost: number; perTask: Array<{ id: string; lift: number }> }> {
    let liftSum = 0
    let cost = 0
    const perTask: Array<{ id: string; lift: number }> = []
    let scored = 0
    for (const task of liveTasks) {
      try {
        const depth = await runAgentic({ ...opts, analystInstruction: instruction, surface, task, mode: 'depth', budget: maxShots })
        const b = breadthByTask.get(task.id)?.score ?? 0
        liftSum += depth.score - b
        cost += depth.completions
        perTask.push({ id: task.id, lift: depth.score - b })
        scored += 1
      } catch (e) {
        console.error(`     depth SKIP ${task.id.slice(-12)} (${e instanceof Error ? e.message.slice(0, 50) : e})`)
      }
    }
    return { lift: scored ? liftSum / scored : -1, cost: scored ? cost / scored : 1e9, perTask }
  }

  // Seed population: the PROVEN baseline (observe()'s default — the +16.4pp instruction)
  // FIRST, so GEPA improves from known-good, then the designer-panel steerer prompts.
  const popSeeds = (JSON.parse(readFileSync('steerers/eops-itsm-population.json', 'utf8')) as Array<{ id: string; systemPrompt: string }>)
    .slice(0, Math.max(0, Number(process.env.SEEDS ?? 4) - 1))
    .map((s) => ({ id: `seed:${s.id}`, instruction: s.systemPrompt, gen: 0 }))
  const pop: Candidate[] = [{ id: 'seed:observe-default', instruction: defaultAnalystInstruction, gen: 0 }, ...popSeeds]

  const objectives = [
    { name: 'lift', direction: 'maximize' as const, value: (c: Candidate) => c.lift ?? -1 },
    { name: 'cost', direction: 'minimize' as const, value: (c: Candidate) => c.cost ?? 1e9 },
  ]

  for (let gen = 0; gen <= gens; gen += 1) {
    console.error(`\n── generation ${gen} · scoring ${pop.filter((c) => c.lift === undefined).length} new candidate(s)`)
    for (const c of pop) {
      if (c.lift !== undefined) continue
      const f = await fitness(c.instruction)
      c.lift = f.lift
      c.cost = f.cost
      c.perTask = f.perTask
      console.error(`   ${c.id.padEnd(28)} lift ${pp(c.lift)}  cost ${c.cost.toFixed(1)}`)
    }
    const ranked = [...pop].filter((c) => c.lift !== undefined).sort((a, b) => (b.lift ?? -1) - (a.lift ?? -1))
    console.error(`   gen ${gen} best: ${ranked[0]?.id} @ ${pp(ranked[0]?.lift ?? 0)}`)
    if (gen === gens) break

    // Pareto-select parents (lift up, cost down), then reflective-mutate each.
    const frontier = paretoFrontier(pop.filter((c) => c.lift !== undefined), objectives).frontier.slice(0, parents)
    const children: Candidate[] = []
    for (const parent of frontier) {
      const sorted = [...(parent.perTask ?? [])].sort((a, b) => b.lift - a.lift)
      const top = sorted.slice(0, 2).map((t) => ({ id: t.id.slice(-12), score: t.lift }))
      const bottom = sorted.slice(-2).map((t) => ({ id: t.id.slice(-12), score: t.lift }))
      const rp = buildReflectionPrompt({
        target:
          'The SYSTEM INSTRUCTION for a trace-analyst that reads an agent\'s tool-call trace on an unfinished IT-ops task and outputs ONE concrete corrective instruction to steer the next attempt. It must never see the grader. payload MUST be the full replacement instruction string.',
        parentPayload: parent.instruction,
        topTrials: top,
        bottomTrials: bottom,
        childCount,
        mutationPrimitives: [
          'Make the diagnosis more specific (name the exact record/field/target value still wrong).',
          'Add an anti-degradation rule (freeze already-correct records; do not re-touch them).',
          'Tighten the stop condition (when to declare done vs keep acting).',
          'Add a verify-before-mutate step (read current state, then change only what is wrong).',
        ],
      })
      const resp = await routerChatWithUsage(reflectCfg, [{ role: 'user', content: rp }], { temperature: 0.8 })
      const proposals = parseReflectionResponse(resp.content, childCount)
      for (const p of proposals) {
        const instruction = typeof p.payload === 'string' ? p.payload : JSON.stringify(p.payload)
        if (instruction.trim().length < 40) continue // reject degenerate mutations
        children.push({ id: `g${gen + 1}:${parent.id.replace(/^seed:|^g\d+:/, '')}-${children.length}`, instruction, gen: gen + 1 })
      }
    }
    console.error(`   reflective-mutated ${frontier.length} parent(s) → ${children.length} child(ren)`)
    // Elitism: carry the frontier forward (already scored) + the new children.
    pop.length = 0
    pop.push(...frontier, ...children)
  }

  const scored = pop.filter((c) => c.lift !== undefined).sort((a, b) => (b.lift ?? -1) - (a.lift ?? -1))
  const best = scored[0]
  console.error(`\n${'='.repeat(72)}`)
  console.error(`GEPA RESULT · ${tasks.length} tasks · ${model}`)
  console.error('='.repeat(72))
  for (const c of scored) console.error(`  ${c.id.padEnd(30)} gen${c.gen}  lift ${pp(c.lift ?? 0)}  cost ${(c.cost ?? 0).toFixed(1)}`)
  console.error(`\n  WINNER: ${best?.id} @ lift ${pp(best?.lift ?? 0)} (gen ${best?.gen})`)
  const out = { model, tasks: tasks.length, gens, best: { id: best?.id, gen: best?.gen, lift: best?.lift, instruction: best?.instruction }, all: scored.map((c) => ({ id: c.id, gen: c.gen, lift: c.lift, cost: c.cost })) }
  const outPath = process.env.OUT ?? '/tmp/eops-gepa-result.json'
  writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.error(`  best instruction + ranking → ${outPath}`)
}

main().catch((e) => {
  console.error(`eops-gepa: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
  process.exit(1)
})
