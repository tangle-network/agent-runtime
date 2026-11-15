/**
 * One hosted coordinator process: `runGraph` over a SQL run context with no runDir, whose only
 * entry node is a seated manager. `long` mode's seat resets 6 min out (past Runtime's seat park
 * floor); `short` mode's resets within the chain's 2 min recheck, so its node waits in place until
 * the caller cancels it. The clock is the only fake: `resume` reads it 10 min on.
 * `root-act` mode roots the graph in a caller brain that spawns the seated node and then holds one
 * real HTTP request open while that node waits on its far reset; `root-requests.jsonl` records
 * when the request reached and left the server.
 *
 * Usage: `node hosted-seat-parking.mjs <dir> <long|short|root-act> <park|early|resume>`
 */
import { appendFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import {
  createFencedSqlRunContext,
  promptHandle,
  RunParkedError,
  runGraph,
  type ToolLoopChat,
} from '../../../src/runtime/index'
import { openSql, TEST_LEASE } from '../../helpers/durability/sql-adapter'
import { durableRetainedProvider } from '../../helpers/durable-retained-provider'
import { runtimeToolDeclarations, testAgentProfile } from '../../kernel/test-agent-profile'

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
const profile = testAgentProfile('work', {
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
const abort = new AbortController()
if (mode === 'short') setTimeout(() => abort.abort(new Error('stop the in-place wait')), 1_500)
const sql = openSql(join(dir, 'run-context.sqlite'))
const context = await createFencedSqlRunContext(sql.adapter, RUN_ID, TEST_LEASE)
const journal = async () => (await context.journal.loadTree(RUN_ID)) ?? []

// The root's outside effect: a request the server answers 3 s after it arrives.
const ROOT_REQUEST_HOLD_MS = 3_000
let requestDone: Promise<void> = Promise.resolve()
const server = createServer((_req, res) => {
  const reachedAt = Date.now()
  requestDone = new Promise((resolve) => {
    setTimeout(() => {
      res.end('ok')
      appendFileSync(
        join(dir, 'root-requests.jsonl'),
        `${JSON.stringify({ reachedAt, answeredAt: Date.now() })}\n`,
      )
      resolve()
    }, ROOT_REQUEST_HOLD_MS)
  })
})
if (mode === 'root-act') await new Promise<void>((resolve) => server.listen(0, resolve))
let rootTurns = 0
const rootBrain: ToolLoopChat = async () => {
  rootTurns += 1
  if (rootTurns === 1) {
    return {
      toolCalls: [
        {
          id: 'spawn-work',
          name: 'spawn_worker',
          arguments: JSON.stringify({ profile: { name: 'work' }, task: 'Finish the seated work.' }),
        },
      ],
    }
  }
  if (rootTurns === 2) {
    const address = server.address() as { port: number }
    await (await fetch(`http://127.0.0.1:${address.port}/effect`, { method: 'POST' })).text()
  }
  return { content: 'waiting for the seated work', toolCalls: [] }
}
const graph =
  mode === 'root-act'
    ? {
        nodes: [
          {
            id: 'lead',
            profile: testAgentProfile('lead', {
              harness: 'cli-base',
              tools: runtimeToolDeclarations('spawn_worker'),
            }),
          },
          { id: 'work', profile },
        ],
        edges: [
          {
            kind: 'delegates' as const,
            from: 'lead',
            to: 'work',
            directive: promptHandle('delegates/worker-brief/v1'),
            maxTraversals: 1,
          },
        ],
      }
    : {
        nodes: [{ id: 'work', profile }],
        edges: [],
        entry: [{ node: 'work', task: 'Finish the seated work.' }],
      }
try {
  const outcome = await runGraph(
    {
      ...graph,
      deliverable: { describe: 'the seated work', check: () => true },
      budget: { maxIterations: 20, maxTokens: 10_000, deadlineMs: 3_600_000 },
    },
    {
      ...(mode === 'root-act' ? { brain: rootBrain } : {}),
      runId: RUN_ID,
      runContext: context,
      ...(phase === 'park' ? {} : { resume: true }),
      parking: { afterMs: 30 },
      now,
      backend,
      selectSeat: async () => {
        selections += 1
        if (phase === 'resume') return { seat: 'ready-seat', backend }
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
      signal: abort.signal,
    },
  )
  process.stdout.write(
    `${JSON.stringify({
      kind: 'settled',
      result: outcome.result.kind,
      reason: 'reason' in outcome.result ? outcome.result.reason : undefined,
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
  // A root request still open when the run parked would answer after this point; record it.
  if (mode === 'root-act') {
    await requestDone
    server.closeAllConnections()
    server.close()
  }
}
