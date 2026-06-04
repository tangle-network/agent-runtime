/**
 * Diagnostic probe — PROVE the keystone gate runs through the real recursive atom and show the
 * raw evidence (the spawn tree + each child's candidate + the deployable judge's verdict), so a
 * 0%/100% number is never taken on faith. Not a test; a one-off inspector.
 *
 *   BENCH=hotpotqa HOTPOTQA_FIXTURES=1 WORKER_MODEL=gpt-4.1 tsx src/keystone-gate-probe.mts
 */

import {
  fanout,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  runPersonified,
  trajectoryReport,
} from '@tangle-network/agent-runtime/loops'
import { resolveAdapter } from './adapters'
import { benchSolverRegistry, defineSolverPersona, type SolveTask } from './keystone-gate'

const must = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`env ${k} required`)
  return v
}

const adapter = resolveAdapter(process.env.BENCH ?? 'hotpotqa')
const model = process.env.WORKER_MODEL ?? 'gpt-4.1'
const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
const routerKey = must('TANGLE_API_KEY')

await adapter.preflight()
const tasks = await adapter.loadTasks({ limit: 1 })
const task = tasks[0]
if (!task) throw new Error('no task loaded')

console.log(`\n# probe: ${adapter.name} / ${task.id} / model=${model}`)
console.log(`# prompt (first 300 chars):\n${task.prompt.slice(0, 300)}\n`)

const strategies = ['Restate then answer directly.', 'Decompose into sub-steps, then answer.', 'Name the likely error, then avoid it.']
const registry = benchSolverRegistry({ adapter, routerBaseUrl, routerKey, model, temperature: 0.7 })
const persona = defineSolverPersona({ name: 'probe', model: { default: model } } as never, registry, 'probe-solver')

const journal = new InMemorySpawnJournal()
const blobs = new InMemoryResultBlobStore()
const runId = `probe:${task.id}`

const shape = fanout<unknown, string, string>(strategies, {
  itemTask: (s): SolveTask => ({ prompt: s.length > 0 ? `${task.prompt}\n\n${s}` : task.prompt, instance: task }),
  label: (_s, i) => `solve:${i}`,
})

const k = strategies.length
const result = await runPersonified<unknown, string>({
  persona,
  shape,
  task: undefined,
  budget: { maxIterations: k, maxTokens: k * 60_000 },
  shapeBudget: { fanout: k, perChild: { maxIterations: 1, maxTokens: 60_000 } },
  runId,
  journal,
  blobs,
})

console.log(`\n## SupervisedResult.kind = ${result.kind}`)
if (result.kind === 'no-winner') console.log(`   reason = ${result.reason}, downCount = ${result.downCount}`)

// The realized tree IS the proof: 1 root (runtime 'inline') + k leaves (runtime 'bench-router'),
// each with its OWN conserved spend + the deployable verdict. This can only exist if
// runPersonified → createSupervisor().run → root.act (fanout) → scope.spawn × k →
// benchSolveLeaf.execute (real router + adapter.judge) actually ran.
const report = await trajectoryReport(journal, blobs, runId, { withOutputs: true })
console.log(`\n## realized spawn tree (${report.nodes.length} nodes; total tokens ${report.total.tokens.input + report.total.tokens.output}):`)
for (const n of report.nodes) {
  const tok = n.ownSpend.tokens.input + n.ownSpend.tokens.output
  const v = n.verdict ? `valid=${n.verdict.valid} score=${n.verdict.score.toFixed(3)}` : 'no-verdict'
  console.log(`  ${n.id.padEnd(18)} runtime=${n.runtime.padEnd(12)} status=${n.status.padEnd(7)} tok=${String(tok).padStart(6)}  ${v}`)
}

console.log(`\n## per-child candidate + judge detail (the raw evidence):`)
for (const n of report.nodes) {
  if (n.runtime !== 'bench-router') continue
  const cand = typeof n.output === 'string' ? n.output : JSON.stringify(n.output)
  console.log(`\n  [${n.id}] candidate (first 280 chars):`)
  console.log(`    ${cand.slice(0, 280).replace(/\n/g, '\n    ')}`)
  if (n.verdict?.notes) console.log(`    judge: ${n.verdict.notes}`)
}
