/**
 * One hosted coordinator process: `runGraph` over a SQL run context with no runDir, whose only
 * entry node is a seated manager. `long` mode's seat resets 6 min out (past Runtime's seat park
 * floor); `short` mode's resets within the chain's 2 min recheck, so its node waits in place until
 * the caller cancels it. The clock is the only fake: `resume` reads it 10 min on.
 * `root-act` mode supervises a caller-brain root that spawns the seated node and then holds one
 * real HTTP request open while that node waits on its far reset; `root-requests.jsonl` records
 * when the request reached and left the server.
 *
 * `gate-held` runs a flow whose second entry settles into a gate; answering it holds the same request
 * open while the seated entry waits on its far reset.
 *
 * Usage: `node hosted-seat-parking.mjs <dir> <long|short|root-act|gate-held> <park|early|resume>`
 */
import { appendFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { recordValue } from '../../../src/record-value'
import {
  createFencedSqlRunContext,
  promptHandle,
  type RunGraphOptions,
  RunParkedError,
  runGraph,
  type ToolLoopChat,
} from '../../../src/runtime/index'
import type { SelectSeat } from '../../../src/runtime/supervise/seat-chain'
import { superviseWithTestBrain } from '../../../src/testing/index'
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
let cancelShortWait: ReturnType<typeof setTimeout> | undefined
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
const holdsRequest = mode === 'root-act' || mode === 'gate-held'
if (holdsRequest) await new Promise<void>((resolve) => server.listen(0, resolve))
const heldRequest = async (): Promise<void> => {
  const address = server.address() as { port: number }
  await (await fetch(`http://127.0.0.1:${address.port}/effect`, { method: 'POST' })).text()
}
let rootTurns = 0
const rootBrain: ToolLoopChat = async () => {
  rootTurns += 1
  if (rootTurns === 1) {
    return {
      toolCalls: [
        {
          id: 'spawn-work',
          name: 'spawn_worker',
          arguments: JSON.stringify({ profile, task: 'Finish the seated work.', key: 'work' }),
        },
      ],
    }
  }
  if (rootTurns === 2) await heldRequest()
  return { content: 'waiting for the seated work', toolCalls: [] }
}
// A caller-brain root under `supervise`: a rooted graph places a harness child only on a
// driverBackend, which a caller brain excludes.
const lead = testAgentProfile('lead', {
  harness: 'cli-base',
  tools: runtimeToolDeclarations('spawn_worker'),
})
const directive = promptHandle('delegates/worker-brief/v1')
const graph =
  mode === 'gate-held'
    ? {
        nodes: [
          { id: 'work', profile },
          // Seated like `work` but ready at once: a seat runs on the fixture's own backend,
          // while a seatless graph node is held to JSON output the retained provider lacks.
          { id: 'build', profile: { ...profile, name: 'build' } },
        ],
        entry: [
          { node: 'work', task: 'Finish the seated work.' },
          { node: 'build', task: 'Build it.' },
        ],
        edges: [
          { kind: 'routes' as const, from: 'build', to: 'review', directive },
          ...['approve', 'reject'].map((choice) => ({
            kind: 'routes' as const,
            from: 'review',
            to: { stop: choice },
            directive,
            when: { pointer: '/choice', equals: choice },
          })),
        ],
        gates: [{ id: 'review', question: 'Ship it?', choices: ['approve', 'reject'] }],
      }
    : {
        nodes: [{ id: 'work', profile }],
        edges: [],
        entry: [{ node: 'work', task: 'Finish the seated work.' }],
      }
const selectSeat: SelectSeat = async ({ profile: seated }) => {
  selections += 1
  if (phase === 'resume' || seated.name === 'build') return { seat: 'ready-seat', backend }
  return { resumeAt: new Date(now() + (mode === 'short' ? 300 : 360_000)).toISOString() }
}
const shared = {
  runId: RUN_ID,
  runContext: context,
  ...(phase === 'park' ? {} : { resume: true }),
  parking: { afterMs: 30 },
  now,
  backend,
  selectSeat,
  coordination: {
    authentication: {
      signingKeys: { activeKeyId: 'fixture', keys: { fixture: 'fixture-signing-key-'.repeat(4) } },
    },
    publicUrl: (address: { port: number }) => `http://127.0.0.1:${address.port}/manager`,
  },
  perWorker: { maxIterations: 2, maxTokens: 500 },
  childSettleGraceMs: 0,
  signal: abort.signal,
  hooks: {
    onEvent(event) {
      if (
        mode === 'short' &&
        event.target === 'agent.seat' &&
        recordValue(event.payload)?.phase === 'paused'
      ) {
        // Cancel after the worker's durable wait gives the parking policy a chance to hand off.
        cancelShortWait ??= setTimeout(() => abort.abort(new Error('stop the in-place wait')), 300)
      }
    },
  },
} satisfies RunGraphOptions
const deliverable = { describe: 'the seated work', check: () => true }
const budget = { maxIterations: 20, maxTokens: 10_000, deadlineMs: 3_600_000 }
try {
  const result =
    mode === 'root-act'
      ? await superviseWithTestBrain(lead, 'Finish the seated work.', {
          ...shared,
          deliverable,
          budget,
          brain: rootBrain,
        })
      : (
          await runGraph(
            { ...graph, deliverable, budget },
            {
              ...shared,
              // The gate's answer is the flow root's own outside request, made while it settles
              // `build`.
              ...(mode === 'gate-held'
                ? {
                    decideGate: async () => {
                      await heldRequest()
                      return { kind: 'choose' as const, choice: 'reject', by: 'fixture' }
                    },
                  }
                : {}),
            },
          )
        ).result
  process.stdout.write(
    `${JSON.stringify({
      kind: 'settled',
      result: result.kind,
      reason: 'reason' in result ? result.reason : undefined,
      nodes: result.tree.nodes.map((node) => ({ label: node.label, status: node.status })),
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
  clearTimeout(cancelShortWait)
  sql.database.close()
  // A root request still open when the run parked would answer after this point; record it.
  if (holdsRequest) {
    await requestDone
    server.closeAllConnections()
    server.close()
  }
}
