/**
 * One PHASE of the SQL-backed kill-and-resume proof, as its own OS process.
 *
 * Usage: `node --import tsx sql-child.ts <dir> <phase:1|2> [killAt]`
 *
 * Identical shape to `graph-child.ts`, except the durable stores are `SqlSpawnJournal` +
 * `SqlResultBlobStore` over a REAL sqlite file (`node:sqlite`) — the run's only inheritance
 * across the process boundary is the database. Phase 1 SIGKILLs itself at `killAt`; phase 2 is a
 * brand-new process that resumes the same `runId` through the same adapter.
 */

import { DatabaseSync } from 'node:sqlite'

const [dir, phase, killAt] = process.argv.slice(2)
if (dir === undefined || (phase !== '1' && phase !== '2')) {
  throw new Error('usage: sql-child.ts <dir> <phase:1|2> [killAt]')
}

const { armKillSwitch } = await import('./kill-switch')
const { ConductorPlanner, RUN_ID, conformanceGraph, instrumentedLeafSeam, readExecLog } =
  await import('./conformance-graph')
const { openSideEffectSite, SIDE_EFFECT_TOOL_NAME, sideEffectToolSpec } = await import(
  './side-effect'
)
const { runGraph } = await import('../../../src/runtime/supervise/graph')
const { SqlResultBlobStore, SqlSpawnJournal } = await import(
  '../../../src/durable/spawn-journal-sql'
)

const db = new DatabaseSync(`${dir}/run.sqlite`)
const adapter = {
  async exec(sql: string, params: readonly unknown[] = []) {
    const res = db.prepare(sql).run(...params)
    return { rowsAffected: Number(res?.changes ?? 0) }
  },
  async query<TRow>(sql: string, params: readonly unknown[] = []): Promise<TRow[]> {
    return db.prepare(sql).all(...(params as never[])) as TRow[]
  },
}
const journal = new SqlSpawnJournal(adapter)
await journal.migrate()
const blobs = new SqlResultBlobStore(adapter)
await blobs.migrate()

const kill = armKillSwitch({
  ...(killAt === undefined ? {} : { killAt }),
  labelsFile: `${dir}/labels-phase-${phase}.log`,
  killedFile: `${dir}/killed.log`,
})
const site = openSideEffectSite(dir)
const planner = new ConductorPlanner()
let brainCalls = 0
const brain = async (messages: ReadonlyArray<Record<string, unknown>>) => {
  brainCalls += 1
  kill(`driver:turn:${brainCalls}:before`)
  const turn = planner.nextTurn(messages)
  kill(`driver:turn:${brainCalls}:after`)
  return turn
}
const result = await runGraph(conformanceGraph(), {
  runId: RUN_ID,
  workerSlots: 3,
  maxTurns: 24,
  perWorker: { maxIterations: 60, maxTokens: 500_000 },
  resume: true,
  journal,
  blobs,
  brain,
  makeLeafAgent: instrumentedLeafSeam({ dir, phase, kill }),
  extraTools: [sideEffectToolSpec()],
  executeExtraTool: async (name, args) => {
    if (name !== SIDE_EFFECT_TOOL_NAME) return null
    kill('tool:commit:before')
    const receipt = site.commit(String(args.idempotencyKey), args.payload)
    kill('tool:commit:after-effect')
    return JSON.stringify(receipt)
  },
})
db.close()
process.stdout.write(
  `${JSON.stringify({
    phase,
    kind: result.result.kind,
    ...(result.result.kind === 'winner' ? { out: result.result.out } : { out: null }),
    exec: readExecLog(dir, phase),
    escalations: planner.report().escalations,
    committedEffects: site.committedKeys(),
    driverTurns: planner.report().turns,
    ...('fatal' in planner.report() ? { fatal: planner.report().fatal } : {}),
  })}\n`,
)
