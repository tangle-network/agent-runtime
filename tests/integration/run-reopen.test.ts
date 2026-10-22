import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SETTLE_RECORD_FILE,
  SettledRunDirectoryError,
  settleRecordDigest,
} from '../../src/durable/settle-record'
import { FileSpawnJournal } from '../../src/durable/spawn-journal/journal-store'
import { supervisePursuit } from '../../src/durable/supervise-pursuit'
import { cancelRun } from '../../src/runtime/supervise/run-cancellation'
import type { DriveHarness } from '../../src/runtime/supervise/supervisor-agent'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  SpawnEvent,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { testContinuation } from '../helpers/continuation'
import { runtimeToolDeclarations, testAgentProfile } from '../kernel/test-agent-profile'

/*
 * A wrong settle reopens under its own run id. Magnetar used 21 run ids from 2026-10-16 to 10-21
 * for one solve, because `supervisePursuit` refused a settled directory and `fork` and `versions`
 * each start a new run id. A reopen archives the settle record, journals who reopened it and why,
 * and resumes the same journal: settled children replay by key and earlier spend counts once.
 */

const budget: Budget = { maxIterations: 100, maxTokens: 10_000 }
const ROOT_TOKENS = 100

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function jsonRpc(url: string, name: string, args: unknown): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  if (!response.ok) throw new Error(`coordination MCP returned ${response.status}`)
  const body = await response.json()
  if (body.error || body.result?.isError) throw new Error(JSON.stringify(body))
}

/** A leaf that settles `done` at once and spends 5 input and 5 output tokens. */
function deliveringLeaf(acts: { count: number }): Agent<unknown, unknown> {
  const result: ExecutorResult<unknown> = {
    outRef: 'reopen:child',
    out: { child: 'done' },
    verdict: { valid: true, score: 1 },
    spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
  }
  const executor: Executor<unknown> = {
    runtime: 'reopen-test-worker',
    execute() {
      acts.count += 1
      return (async function* () {
        yield { kind: 'iteration' } as UsageEvent
        yield { kind: 'tokens', input: 5, output: 5 } as UsageEvent
        yield { kind: 'cost', usd: 0, usdKnown: true, provenance: 'provider-receipt' } as UsageEvent
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: () => result,
  }
  const spec: AgentSpec = { profile: testAgentProfile('child'), harness: null, executor }
  return { name: 'child', act: async () => result.out, executorSpec: spec } as Agent<
    unknown,
    unknown
  > & { executorSpec: AgentSpec }
}

interface Harness {
  readonly runDir: string
  readonly runId: string
  /** What each root drive does after it spawned the keyed child and saw it settle. */
  mode: 'wait-for-cancel' | 'submit'
  /** Resolves when the current segment's root is waiting for a cancel. */
  waiting: Promise<void>
  readonly acts: { count: number }
  readonly events: () => Promise<SpawnEvent[]>
  readonly run: (extra?: Record<string, unknown>) => ReturnType<typeof supervisePursuit>
}

async function harness(runId: string): Promise<Harness> {
  const runDir = await mkdtemp(join(tmpdir(), 'run-reopen-'))
  directories.push(runDir)
  const journal = new FileSpawnJournal(join(runDir, 'spawn-journal.jsonl'))
  let markWaiting = () => {}
  let segmentDrives = 0
  const state: Harness = {
    runDir,
    runId,
    mode: 'wait-for-cancel',
    waiting: Promise.resolve(),
    acts: { count: 0 },
    events: async () => (await journal.loadTree(runId)) ?? [],
    run: (extra = {}) => {
      segmentDrives = 0
      state.waiting = new Promise<void>((resolve) => {
        markWaiting = resolve
      })
      const { deadline: _deadline, ...continuation } = testContinuation({ maxBarren: 2 })
      return supervisePursuit(
        testAgentProfile('reopen-root', {
          harness: 'codex',
          tools: runtimeToolDeclarations('spawn_worker', 'submit_result'),
        }),
        'Deliver the word done.',
        {
          pursuitId: 'pursuit:reopen',
          runId,
          runDir,
          budget,
          perWorker: { maxIterations: 4, maxTokens: 1_000 },
          makeWorkerAgent: () => deliveringLeaf(state.acts),
          deliverable: { describe: 'The word done.', check: (out: unknown) => out === 'done' },
          continuation,
          driveHarness: drive,
          ...extra,
        },
      )
    },
  }
  // Each segment's first drive spawns the keyed child and ends its turn; the next drive, woken by
  // the child's settlement (or sent back by the unmet check after a replay), acts on `mode`.
  const drive: DriveHarness = async ({ coordinationMcpUrl, scope }) => {
    segmentDrives += 1
    if (segmentDrives > 1) {
      if (state.mode === 'submit') {
        await jsonRpc(coordinationMcpUrl, 'submit_result', { result: 'done' })
        return
      }
      markWaiting()
      await new Promise<void>((resolve) => {
        if (scope.signal.aborted) resolve()
        else scope.signal.addEventListener('abort', () => resolve(), { once: true })
      })
      throw new Error('the root stopped with its run')
    }
    await scope.meter({
      iterations: 1,
      tokens: { input: ROOT_TOKENS, output: 0 },
      usd: 0,
      ms: 1,
    })
    await jsonRpc(coordinationMcpUrl, 'spawn_worker', {
      profile: testAgentProfile('child'),
      task: 'settle at once',
      label: 'child',
      key: 'child-1',
    })
  }
  return state
}

function reopenedRows(events: readonly SpawnEvent[]) {
  return events.filter(
    (event): event is Extract<SpawnEvent, { kind: 'reopened' }> => event.kind === 'reopened',
  )
}

function settleBytes(runDir: string): string {
  return readFileSync(join(runDir, SETTLE_RECORD_FILE), 'utf8')
}

describe('supervisePursuit reopen', () => {
  it('reopens a settled run under its own id, replays its keyed child, and counts spend once', async () => {
    const run = await harness('reopen-run')

    // 1. The run settles on a named cancel after its keyed child settled `done`.
    let pending = run.run()
    await run.waiting
    cancelRun(run.runDir, 'stop-1', { operator: 'op-a', reason: 'wrong settle' })
    const first = await pending
    expect(first.result).toMatchObject({ kind: 'no-winner', reason: 'cancelled', operator: 'op-a' })
    expect(run.acts.count).toBe(1)
    const firstSettle = settleBytes(run.runDir)

    // 2. Without reopen the settled directory is still refused.
    await expect(run.run()).rejects.toBeInstanceOf(SettledRunDirectoryError)

    // 3. A reopen archives the settle record, journals one row, and keeps the run id.
    pending = run.run({
      reopen: { operator: 'op-b', reason: 'settled by mistake', operationId: 'reopen-1' },
    })
    await run.waiting
    expect(readFileSync(join(run.runDir, 'settles', '1.json'), 'utf8')).toBe(firstSettle)
    expect(reopenedRows(await run.events())).toEqual([
      expect.objectContaining({
        id: run.runId,
        operator: 'op-b',
        reason: 'settled by mistake',
        operationId: 'reopen-1',
        prior: {
          kind: 'no-winner',
          reason: 'cancelled',
          digest: settleRecordDigest(JSON.parse(firstSettle)),
          archivedAs: 'settles/1.json',
        },
        seq: 0,
      }),
    ])
    // The settled cancel was moved aside, so a new operation is accepted.
    cancelRun(run.runDir, 'stop-2', { operator: 'op-c', reason: 'stop again' })
    const second = await pending
    expect(second.result).toMatchObject({
      kind: 'no-winner',
      reason: 'cancelled',
      operator: 'op-c',
    })
    expect(run.acts.count).toBe(1)
    const secondSettle = settleBytes(run.runDir)

    // 4. A reopen with a larger budget and no deadline records it, and the run then wins.
    const larger: Budget = { maxIterations: 100, maxTokens: 20_000 }
    run.mode = 'submit'
    const third = await run.run({
      reopen: {
        operator: 'op-b',
        reason: 'give it room',
        operationId: 'reopen-2',
        budget: larger,
      },
    })
    expect(readFileSync(join(run.runDir, 'settles', '2.json'), 'utf8')).toBe(secondSettle)
    const rows = reopenedRows(await run.events())
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({ operationId: 'reopen-2', budget: larger, seq: 1 })
    expect(third.result.kind).toBe('winner')
    expect(run.acts.count).toBe(1)
    // Three root segments of 100 tokens and the one child's 5 + 5, each counted once.
    expect(third.result.spentTotal.tokens).toMatchObject({ input: 3 * ROOT_TOKENS + 5, output: 5 })
    expect(readdirSync(join(run.runDir, 'settles')).sort()).toEqual(['1.json', '2.json'])
  }, 30_000)

  it('refuses a changed budget without reopen.budget, and finishes an interrupted reopen once', async () => {
    const run = await harness('reopen-interrupted')
    run.mode = 'submit'
    const first = await run.run()
    expect(first.result.kind).toBe('winner')
    const settled = settleBytes(run.runDir)

    // 6. A reopen interrupted after its archive and journal row: the call finishes it.
    mkdirSync(join(run.runDir, 'settles'))
    writeFileSync(join(run.runDir, 'settles', '1.json'), settled)
    await new FileSpawnJournal(join(run.runDir, 'spawn-journal.jsonl')).appendEvent(run.runId, {
      kind: 'reopened',
      id: run.runId,
      operator: 'op-b',
      reason: 'interrupted',
      operationId: 'reopen-x',
      prior: {
        kind: 'winner',
        digest: settleRecordDigest(JSON.parse(settled)),
        archivedAs: 'settles/1.json',
      },
      seq: 0,
      at: new Date().toISOString(),
    })
    const finished = await run.run({
      reopen: { operator: 'op-b', reason: 'interrupted', operationId: 'reopen-x' },
    })
    expect(finished.result.kind).toBe('winner')
    expect(readdirSync(join(run.runDir, 'settles'))).toEqual(['1.json'])
    expect(reopenedRows(await run.events())).toHaveLength(1)

    // 5. A changed budget needs reopen.budget: the resume contract refuses it.
    await expect(
      run.run({
        budget: { maxIterations: 100, maxTokens: 30_000 },
        reopen: { operator: 'op-b', reason: 'more room', operationId: 'reopen-y' },
      }),
    ).rejects.toThrow(/resume budget mismatch/u)
  }, 30_000)

  it('refuses a reopen with nothing to reopen or without an operator', async () => {
    const run = await harness('reopen-refused')
    await expect(
      run.run({ reopen: { operator: 'op-b', reason: 'nothing', operationId: 'reopen-1' } }),
    ).rejects.toThrow(/nothing to reopen; resume it/u)
    await expect(
      run.run({ reopen: { operator: ' ', reason: 'why', operationId: 'reopen-1' } }),
    ).rejects.toThrow(/reopen.operator/u)
  })
})
