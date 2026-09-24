import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSqlRunContext } from '../../../src/runtime/supervise/sql-run-context'
import { runGraph } from '../../../src/runtime/supervise/graph'
import { ConductorPlanner, conformanceGraph, instrumentedLeafSeam, RUN_ID } from './conformance-graph'
import { sideEffectToolSpec, SIDE_EFFECT_TOOL_NAME } from './side-effect'
import { openSqlite } from './sqlite-adapter'

const [file, killAt = '-'] = process.argv.slice(2)
if (!file) throw new Error('usage: sql-graph-child.ts <database> [killAt]')
// Deliberately disjoint local directories: the only inheritance is SQL, not runDir.
const dir = await mkdtemp(join(tmpdir(), 'sql-graph-host-'))
const { db, close } = openSqlite(file)
const labels = new Set<string>()
const kill = (label: string) => {
  labels.add(label)
  if (label === killAt) process.kill(process.pid, 'SIGKILL')
}
try {
  const context = await createSqlRunContext(db, { runId: RUN_ID, leaseMs: 1000 })
  await db.exec('CREATE TABLE IF NOT EXISTS test_effects (effect_key TEXT PRIMARY KEY, payload TEXT NOT NULL)')
  const append = context.journal.appendEvent.bind(context.journal)
  const seen = new Set<string>()
  context.journal.appendEvent = async (root, event) => {
    const label = `${event.kind}:${event.id === RUN_ID ? 'root' : 'child'}`
    const first = !seen.has(label)
    seen.add(label)
    if (first) kill(`journal:before:${label}`)
    await append(root, event)
    if (first) kill(`journal:after:${label}`)
  }
  const planner = new ConductorPlanner()
  let turns = 0
  const result = await runGraph(conformanceGraph(), {
    runId: RUN_ID,
    runContext: context,
    workerSlots: 3,
    maxTurns: 24,
    perWorker: { maxIterations: 60, maxTokens: 500_000 },
    brain: async (messages) => {
      turns += 1
      kill(`driver:turn:${turns}:before`)
      const reply = planner.nextTurn(messages as ReadonlyArray<Record<string, unknown>>)
      kill(`driver:turn:${turns}:after`)
      return reply
    },
    makeLeafAgent: instrumentedLeafSeam({ dir, phase: 'sql', kill }),
    extraTools: [sideEffectToolSpec()],
    executeExtraTool: async (name, args) => {
      if (name !== SIDE_EFFECT_TOOL_NAME) return null
      kill('tool:commit:before')
      const key = String(args.idempotencyKey)
      const result = await db.exec('INSERT INTO test_effects (effect_key, payload) VALUES (?, ?) ON CONFLICT (effect_key) DO NOTHING', [key, JSON.stringify(args.payload)])
      kill('tool:commit:after-effect')
      return JSON.stringify({ committed: result.rowsAffected === 1, key })
    },
  })
  const events = await context.journal.loadTree(RUN_ID)
  const effects = await db.query<{ effect_key: string }>('SELECT effect_key FROM test_effects ORDER BY effect_key')
  process.stdout.write(`${JSON.stringify({ kind: result.result.kind, out: result.result.kind === 'winner' ? result.result.out : null, labels: [...labels], events, effects, escalations: planner.report().escalations })}\n`)
  await context.close()
} finally {
  close()
  await rm(dir, { recursive: true, force: true })
}
