/**
 * The corpus flywheel A/B — primed-vs-cold at equal compute. THE across-run experiment
 * (docs/research/layer-across-run.md): does run N+1 improve because the system learned
 * from run N?
 *
 * Two arms over the SAME task stream, same order, canonical depth (Supervisor + observe):
 *   cold    — every run fresh (the baseline as measured at +16.4pp vs breadth).
 *   primed  — before each run, query the corpus (trace-derived facts accumulated by the
 *             analyst's observe() pass on PRIOR runs) and fold the top-k into the task's
 *             systemPrompt; after each run, observe() appends new facts. Zero extra LLM
 *             calls (the analyst already runs); priming is prompt text — equal compute.
 *
 * Reported: per-position scores, paired lift, the SLOPE (first-half vs second-half lift —
 * the flywheel signature is a GROWING advantage), fact uptake counts, and a frozen
 * HOLDOUT: a disjoint slice run primed-from-the-accumulated-corpus vs cold (does the
 * learned knowledge transfer to fresh tasks?).
 *
 * Falsifiers designed in (layer-across-run.md): context pollution (cap k, report dose),
 * stale/instance facts (the gym DB resets per task — only PROCEDURAL facts can help),
 * judge leakage (observe() is structurally trace-only), worker disregard (uptake column).
 *
 *   docker run -d --rm --name eops -p 8006:8005 shivakrishnareddyma225/enterpriseops-gym-mcp-itsm:latest
 *   EOPS_GYM_DBS_DIR=… N=16 HOLDOUT=4 K_FACTS=3 WORKER_MODEL=deepseek-v4-pro tsx src/eops-corpus-ab.mts
 */
import { type AgenticOptions, type AgenticTask, FileCorpus, runAgentic } from '@tangle-network/agent-runtime/loops'
import { createEopsSurface, eopsTaskFromRow } from './agentic-eops'
import { type PairedLift, pairedLift } from './stats.mts'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

async function loadItsmTasks(n: number, offset = 0): Promise<AgenticTask[]> {
  const url = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent('ServiceNow-AI/EnterpriseOps-Gym')}&config=oracle&split=itsm&offset=${offset}&length=${n}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`EOPS HF rows HTTP ${res.status}`)
  const body = (await res.json()) as { rows?: Array<{ row: Parameters<typeof eopsTaskFromRow>[0] }> }
  return (body.rows ?? []).slice(0, n).map(({ row }) => eopsTaskFromRow(row))
}

const tags = ['eops', 'itsm', 'corpus-ab']
const pct = (x: number) => `${(x * 100).toFixed(0)}%`
const pp = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`

async function main(): Promise<void> {
  const n = Number(process.env.N ?? 16)
  const holdoutN = Number(process.env.HOLDOUT ?? 4)
  const kFacts = Number(process.env.K_FACTS ?? 3)
  const maxShots = Number(process.env.MAXSHOTS ?? 3)
  const model = process.env.WORKER_MODEL ?? 'deepseek-v4-pro'
  const corpusPath = process.env.CORPUS ?? `/tmp/eops-corpus-ab-${Date.now()}.jsonl`
  const opts: AgenticOptions = {
    routerBaseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
    routerKey: must('TANGLE_API_KEY'),
    model,
    innerTurns: Number(process.env.INNER_TURNS ?? 4),
    temperature: 0.7,
  }
  const surface = createEopsSurface(must('EOPS_GYM_DBS_DIR'))
  const corpus = new FileCorpus(corpusPath)

  const stream = await loadItsmTasks(n)
  console.error(`=== corpus A/B · primed-vs-cold · stream n=${stream.length} + holdout ${holdoutN} · ${model} · k=${kFacts} facts ===`)
  console.error(`    corpus: ${corpusPath}\n`)

  /** Top-k trace-derived facts → a prime block for the worker's system prompt. */
  async function primeBlock(): Promise<{ text: string; count: number }> {
    const facts = await corpus.query({ tags: ['audience:agent'], limit: kFacts })
    if (facts.length === 0) return { text: '', count: 0 }
    const lines = facts.map((f) => `- ${f.claim}${f.rationale ? ` (${f.rationale.slice(0, 120)})` : ''}`)
    return {
      text: `\n\nLEARNINGS FROM PRIOR RUNS (apply where relevant):\n${lines.join('\n')}`,
      count: facts.length,
    }
  }

  async function runArm(task: AgenticTask, primed: boolean): Promise<{ score: number; facts: number } | null> {
    try {
      if (!primed) {
        const r = await runAgentic({ ...opts, surface, task, mode: 'depth', budget: maxShots })
        return { score: r.score, facts: 0 }
      }
      const prime = await primeBlock()
      const primedTask: AgenticTask = { ...task, systemPrompt: `${task.systemPrompt}${prime.text}` }
      const r = await runAgentic({ ...opts, corpus, corpusTags: tags, surface, task: primedTask, mode: 'depth', budget: maxShots })
      return { score: r.score, facts: prime.count }
    } catch (e) {
      console.error(`     SKIP ${task.id.slice(-12)} (${e instanceof Error ? e.message.slice(0, 60) : e})`)
      return null
    }
  }

  // The stream: per task, cold first (no corpus contact), then primed (reads + writes).
  const rows: Array<{ cold: number; primed: number; facts: number }> = []
  for (let i = 0; i < stream.length; i += 1) {
    const task = stream[i] as AgenticTask
    const cold = await runArm(task, false)
    const primed = await runArm(task, true)
    if (!cold || !primed) continue
    rows.push({ cold: cold.score, primed: primed.score, facts: primed.facts })
    console.error(`  [${i + 1}/${stream.length}] ${task.id.slice(-12)}: cold ${pct(cold.score)}  primed ${pct(primed.score)}  (facts injected: ${primed.facts})`)
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)
  const lift = pairedLift(rows.map((r) => r.cold), rows.map((r) => r.primed))
  const half = Math.floor(rows.length / 2)
  const firstHalf = mean(rows.slice(0, half).map((r) => r.primed - r.cold))
  const secondHalf = mean(rows.slice(half).map((r) => r.primed - r.cold))

  // Frozen holdout: fresh tasks, primed from the ACCUMULATED corpus (read-only) vs cold.
  let holdout: { lift: PairedLift; n: number } | undefined
  if (holdoutN > 0) {
    console.error(`\n▶ holdout (${holdoutN} disjoint tasks, corpus read-only)…`)
    const htasks = await loadItsmTasks(holdoutN, stream.length)
    const hrows: Array<{ cold: number; primed: number }> = []
    for (const task of htasks) {
      const cold = await runArm(task, false)
      if (!cold) continue
      // read-only priming: query + inject, but do NOT pass the corpus (no writes).
      try {
        const prime = await primeBlock()
        const primedTask: AgenticTask = { ...task, systemPrompt: `${task.systemPrompt}${prime.text}` }
        const r = await runAgentic({ ...opts, surface, task: primedTask, mode: 'depth', budget: maxShots })
        hrows.push({ cold: cold.score, primed: r.score })
        console.error(`   ${task.id.slice(-12)}: cold ${pct(cold.score)}  primed ${pct(r.score)}`)
      } catch {
        /* skip */
      }
    }
    if (hrows.length >= 2) holdout = { lift: pairedLift(hrows.map((r) => r.cold), hrows.map((r) => r.primed)), n: hrows.length }
  }

  const sig = (l: PairedLift) => (l.low > 0 ? 'SIGNIF +' : l.high < 0 ? 'SIGNIF -' : 'n.s.')
  console.error(`\n${'='.repeat(74)}`)
  console.error(`CORPUS A/B RESULT · stream n=${rows.length} · ${model} · k=${kFacts}`)
  console.error('='.repeat(74))
  console.error(`  cold   ${pct(mean(rows.map((r) => r.cold)))}    primed ${pct(mean(rows.map((r) => r.primed)))}`)
  console.error(`  primed − cold (paired, B=10000)  ${pp(lift.point)}  CI [${pp(lift.low)}, ${pp(lift.high)}]  disc=${lift.discordant}  ${sig(lift)}`)
  console.error(`  SLOPE: first-half lift ${pp(firstHalf)} → second-half lift ${pp(secondHalf)}  ${secondHalf > firstHalf ? '(growing — the flywheel signature)' : '(not growing)'}`)
  if (holdout) console.error(`  HOLDOUT (${holdout.n} fresh tasks, accumulated corpus): ${pp(holdout.lift.point)}  CI [${pp(holdout.lift.low)}, ${pp(holdout.lift.high)}]  ${sig(holdout.lift)}`)
  console.error(`  corpus facts accumulated: see ${corpusPath}`)
}

main().catch((e) => {
  console.error(`eops-corpus-ab: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
  process.exit(1)
})
