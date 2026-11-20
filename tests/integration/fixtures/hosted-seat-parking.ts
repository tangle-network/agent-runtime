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
import { setTimeout as delay } from 'node:timers/promises'
import { recordValue } from '../../../src/record-value'
import {
  createFencedSqlRunContext,
  promptHandle,
  type RunGraphOptions,
  RunParkedError,
  runGraph,
  type ToolLoopChat,
  workerFromBackend,
} from '../../../src/runtime/index'
import type { SelectSeat } from '../../../src/runtime/supervise/seat-chain'
import { superviseWithTestBrain } from '../../../src/testing/index'
import { openSql, TEST_LEASE } from '../../helpers/durability/sql-adapter'
import { durableRetainedProvider } from '../../helpers/durable-retained-provider'
import { nativeSeatProvider } from '../../helpers/native-seat-provider'
import { runtimeToolDeclarations, testAgentProfile } from '../../kernel/test-agent-profile'

const [dir, mode = 'long', phase = 'park'] = process.argv.slice(2)
if (dir === undefined) throw new Error('run directory required')
const RUN_ID = 'hosted-seat-parking'
const now = () => Date.now() + (phase === 'resume' ? 600_000 : 0)
const base =
  mode === 'gate-held'
    ? nativeSeatProvider(dir)
    : durableRetainedProvider(join(dir, 'provider.json'))
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

const PARK_AFTER_MS = 30
let announceFarSeat!: () => void
const farSeatPaused = new Promise<void>((resolve) => {
  announceFarSeat = resolve
})
let requestDone: Promise<void> = Promise.resolve()
const server = createServer((_req, res) => {
  const reachedAt = Date.now()
  requestDone = (async () => {
    if (mode === 'gate-held') await farSeatPaused
    // The gate stays open across multiple checks after the other worker is actually eligible.
    await delay(mode === 'gate-held' ? 4 * PARK_AFTER_MS : 3_000)
    res.end('ok')
    appendFileSync(
      join(dir, 'root-requests.jsonl'),
      `${JSON.stringify({ reachedAt, answeredAt: Date.now() })}\n`,
    )
  })()
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
          { id: 'build', profile: testAgentProfile('build') },
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
const selectSeat: SelectSeat = async () => {
  selections += 1
  if (phase === 'resume') return { seat: 'ready-seat', backend }
  return { resumeAt: new Date(now() + (mode === 'short' ? 300 : 360_000)).toISOString() }
}
const shared = {
  runId: RUN_ID,
  runContext: context,
  ...(phase === 'park' ? {} : { resume: true }),
  parking: { afterMs: PARK_AFTER_MS },
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
      if (event.target === 'agent.seat' && recordValue(event.payload)?.phase === 'paused') {
        if (mode === 'gate-held') announceFarSeat()
        if (mode !== 'short') return
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
                    // Only the build leaf executes. Its real process result opens the flow gate.
                    makeLeafAgent: workerFromBackend(backend, {
                      check: (out) => recordValue(out)?.content === 'native completed',
                    }),
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
