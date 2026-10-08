import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import type { DriverContinuationRecord } from '../../src/runtime/supervise/driver-retry'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import { type DriveHarness, supervisorAgent } from '../../src/runtime/supervise/supervisor-agent'
import type { SupervisedResult } from '../../src/runtime/supervise/types'
import { testContinuation } from '../helpers/continuation'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

/*
 * A run settles only on a terminal condition: the deadline, a cancel, an exhausted budget, a
 * result the check accepts, or the no-progress bound. A root turn that ends, a lost stream and a
 * blocked tool are boundaries the root is re-entered across.
 *
 * Measured motive: terraform-dc f (2026-10-08) settled `no-winner/no-result-selected` 2 h 45 min
 * into an 18-hour play. Its root reported `knowledge_read` blocked, the coordinator's probe failed
 * on a transient mutation-epoch race, the run closed as blocked, and every continuation was
 * refused `closed`. The Lab then forked the play into a new run id to keep it going.
 */

async function call(url: string, name: string, args: unknown): Promise<unknown> {
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
  expect(response.ok).toBe(true)
  const body = (await response.json()) as {
    result?: { content?: Array<{ text?: string }> }
  }
  const text = body.result?.content?.[0]?.text
  return text === undefined ? undefined : JSON.parse(text)
}

/** A probe that always fails: `read_journal` refuses a negative row. */
const failingProbe = { tool: 'read_journal', arguments: { sinceRow: -1 }, error: 'epoch race' }

interface Outcome {
  readonly result: SupervisedResult<unknown>
  readonly loop: DriverContinuationRecord | undefined
}

async function run(drive: DriveHarness, maxBarren = 2): Promise<Outcome> {
  const blobs = new InMemoryResultBlobStore()
  let loop: DriverContinuationRecord | undefined
  const root = supervisorAgent(
    testAgentProfile('terminal-root', {
      harness: 'pi',
      tools: runtimeToolDeclarations('submit_result', 'read_journal', 'report_blocked'),
    }),
    {
      blobs,
      makeWorkerAgent: () => {
        throw new Error('this profile does not grant spawning')
      },
      perWorker: { maxIterations: 4, maxTokens: 1000 },
      driveHarness: drive,
      deliverable: {
        describe: 'The word done.',
        check: (out: unknown) => out === 'done',
      },
      driverRetry: { initialBackoffMs: 1, maxBackoffMs: 1 },
      continuation: testContinuation({ maxBarren }),
      onDriverLoopSettled: (record) => {
        loop = record
      },
    },
  )
  const result = await createSupervisor<unknown, unknown>().run(root, 'Deliver the word done.', {
    budget: { maxIterations: 100, maxTokens: 100_000 },
    runId: 'settle-on-terminal',
    journal: new InMemorySpawnJournal(),
    blobs,
    executors: createExecutorRegistry(),
    maxDepth: 1,
  })
  return { result, loop }
}

describe('a run settles only on a terminal condition', () => {
  it('re-enters a root whose turn ended with the check unmet, instead of settling', async () => {
    let drives = 0
    const { result, loop } = await run(async ({ coordinationMcpUrl }) => {
      drives += 1
      // Two turns end with nothing delivered; the third delivers.
      if (drives === 3) await call(coordinationMcpUrl, 'submit_result', { result: 'done' })
    })
    expect(drives).toBe(3)
    expect(result.kind).toBe('winner')
  })

  it('re-enters a root whose stream was lost mid-turn', async () => {
    let drives = 0
    const { result, loop } = await run(async ({ coordinationMcpUrl }) => {
      drives += 1
      if (drives === 1) throw new Error('sandbox event stream closed before the turn ended')
      await call(coordinationMcpUrl, 'submit_result', { result: 'done' })
    })
    expect(drives).toBe(2)
    expect(result.kind).toBe('winner')
    expect(loop?.failureRetries).toBe(1)
  })

  it('records a blocked tool and goes on: the run is not closed by it', async () => {
    let drives = 0
    const replies: unknown[] = []
    const { result, loop } = await run(async ({ coordinationMcpUrl }) => {
      drives += 1
      if (drives === 1) {
        replies.push(await call(coordinationMcpUrl, 'report_blocked', failingProbe))
        return
      }
      await call(coordinationMcpUrl, 'submit_result', { result: 'done' })
    })
    expect(replies[0]).toMatchObject({ blocked: true, probe: { tool: 'read_journal', ok: false } })
    expect(replies[0]).not.toHaveProperty('stopped')
    expect(drives).toBe(2)
    expect(result.kind).toBe('winner')
    expect(loop?.closedBy).toBe('result-accepted')
    expect(loop?.blocked).toEqual([
      expect.objectContaining({ tool: 'read_journal', reported: 'epoch race' }),
    ])
  })

  it('still ends a run whose tool stays blocked at the no-progress bound', async () => {
    let drives = 0
    const { result, loop } = await run(async ({ coordinationMcpUrl }) => {
      drives += 1
      await call(coordinationMcpUrl, 'report_blocked', failingProbe)
    }, 2)
    // The first turn, then two re-entered turns in a row without progress.
    expect(drives).toBe(3)
    expect(result.kind).toBe('no-winner')
    expect(loop?.repromptRefusedBy).toBe('no-progress')
    expect(loop?.closedBy).toBeUndefined()
    expect(loop?.blocked).toHaveLength(3)
  })
})
