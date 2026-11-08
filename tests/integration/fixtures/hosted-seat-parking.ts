/**
 * One hosted coordinator process: `runGraph` over a SQL run context with no runDir, whose only
 * entry node is a seated manager. `long` mode's seat resets 6 min out (past Runtime's seat park
 * floor); `short` mode's resets 300 ms out. The clock is the only fake: `resume` reads it 10 min on.
 *
 * Usage: `node hosted-seat-parking.mjs <dir> <long|short> <park|early|resume>`
 */
import { join } from 'node:path'
import { createFencedSqlRunContext, RunParkedError, runGraph } from '../../../src/runtime/index'
import { durableRetainedProvider } from '../../helpers/durable-retained-provider'
import { openSql, TEST_LEASE } from '../../helpers/durability/sql-adapter'
import { testAgentProfile } from '../../kernel/test-agent-profile'

const [dir, mode = 'long', phase = 'park'] = process.argv.slice(2)
if (dir === undefined) throw new Error('run directory required')
const RUN_ID = 'hosted-seat-parking'
const now = () => Date.now() + (phase === 'resume' ? 600_000 : 0)
const base = durableRetainedProvider(join(dir, 'provider.json'))
const provider = {
  ...base,
  capabilities: async () => ({
    ...(await base.capabilities()),
    create: { runtimeAttachments: { mcp: true } },
  }),
}
const backend = { backend: 'provider' as const, provider }
const profile = testAgentProfile('seated-node', {
  harness: 'opencode',
  model: { provider: 'anthropic', default: 'claude-opus-4-1' },
  seats: [
    {
      harness: 'opencode',
      provider: 'anthropic',
      model: 'claude-opus-4-1',
      selector: { kind: 'all-eligible' as const },
    },
  ],
})
let selections = 0
const sql = openSql(join(dir, 'run-context.sqlite'))
const context = await createFencedSqlRunContext(sql.adapter, RUN_ID, TEST_LEASE)
const journal = async () => (await context.journal.loadTree(RUN_ID)) ?? []
try {
  const outcome = await runGraph(
    {
      nodes: [{ id: 'work', profile }],
      edges: [],
      entry: [{ node: 'work', task: 'Finish the seated work.' }],
      deliverable: { describe: 'the seated work', check: () => true },
      budget: { maxIterations: 20, maxTokens: 10_000, deadlineMs: 3_600_000 },
    },
    {
      runId: RUN_ID,
      runContext: context,
      ...(phase === 'park' ? {} : { resume: true }),
      parking: { afterMs: 30 },
      now,
      backend,
      selectSeat: async () => {
        selections += 1
        if (phase === 'resume' || (mode === 'short' && selections > 1))
          return { seat: 'ready-seat', backend }
        return { resumeAt: new Date(now() + (mode === 'long' ? 360_000 : 300)).toISOString() }
      },
      coordination: {
        authentication: {
          signingKeys: {
            activeKeyId: 'fixture',
            keys: { fixture: 'fixture-signing-key-'.repeat(4) },
          },
        },
        publicUrl: (address: { port: number }) => `http://127.0.0.1:${address.port}/manager`,
      },
      perWorker: { maxIterations: 2, maxTokens: 500 },
      childSettleGraceMs: 0,
    },
  )
  process.stdout.write(
    `${JSON.stringify({
      kind: 'settled',
      result: outcome.result.kind,
      nodes: outcome.result.tree.nodes.map((node) => ({ label: node.label, status: node.status })),
      events: await journal(),
    })}\n`,
  )
} catch (error) {
  if (!(error instanceof RunParkedError)) throw error
  process.stdout.write(
    `${JSON.stringify({
      kind: 'parked',
      runId: error.runId,
      parking: error.parking,
      selections,
      events: await journal(),
    })}\n`,
  )
} finally {
  sql.database.close()
}
