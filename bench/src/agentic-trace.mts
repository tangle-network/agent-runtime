/**
 * Operator trace — run ONE depth rollout and dump EVERYTHING: per shot, the steer the driver
 * injected, the tool calls the agent made + their observations, the score, and the trace-analyst's
 * verdict. So a human can read whether the steering is actually any good, not just the score.
 *
 *   TASK=2 MAX_SHOTS=5 WORKER_MODEL=gpt-4.1 tsx src/agentic-trace.mts   # TASK = itsm row index
 */

import { type AgenticOptions, type AgenticTask, type AgenticTraceEvent, runAgentic } from './agentic'
import { createEopsSurface, eopsTaskFromRow } from './agentic-eops'

const must = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`env ${k} required`)
  return v
}

const idx = Number(process.env.TASK ?? 2)
const res = await fetch(
  `https://datasets-server.huggingface.co/rows?dataset=ServiceNow-AI%2FEnterpriseOps-Gym&config=oracle&split=itsm&offset=${idx}&length=1`,
)
const body = (await res.json()) as { rows?: Array<{ row: Parameters<typeof eopsTaskFromRow>[0] }> }
const task: AgenticTask = eopsTaskFromRow(body.rows![0]!.row)

console.log(`\n############ TASK ${idx}: ${task.id} ############`)
console.log(`USER PROMPT:\n${task.userPrompt}\n`)

let lastFindings: string | undefined
const onTrace = (ev: AgenticTraceEvent) => {
  console.log(`\n────────── SHOT ${ev.shot}  (score after: ${(ev.score * 100).toFixed(0)}%) ──────────`)
  if (ev.steer) console.log(`STEER IN (from analyst):\n  ${ev.steer.replace(/\n/g, '\n  ')}\n`)
  console.log(`AGENT DID (${ev.toolCalls.length} tool calls):`)
  for (const c of ev.toolCalls) {
    console.log(`  → ${c.name}(${c.args.slice(0, 160)})`)
    console.log(`    ⟵ ${c.result.replace(/\n/g, ' ').slice(0, 200)}`)
  }
  if (ev.findings) {
    console.log(`\nANALYST SAID:\n  ${ev.findings.replace(/\n/g, '\n  ').slice(0, 900)}`)
    lastFindings = ev.findings
  }
}

const opts: AgenticOptions = {
  routerBaseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
  routerKey: must('TANGLE_API_KEY'),
  model: process.env.WORKER_MODEL ?? 'gpt-4.1',
  temperature: Number(process.env.TEMPERATURE ?? 0.7),
  innerTurns: Number(process.env.INNER_TURNS ?? 4),
  onTrace,
}

const result = await runAgentic({ ...opts, surface: createEopsSurface(must('EOPS_GYM_DBS_DIR')), task, budget: Number(process.env.MAX_SHOTS ?? 5) })
console.log(`\n############ FINAL: ${(result.score * 100).toFixed(0)}%  progression ${result.progression.map((s) => (s * 100).toFixed(0)).join('→')}  (${result.completions} completions) ############`)
void lastFindings
