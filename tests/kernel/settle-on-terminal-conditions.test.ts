import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
} from '../../src/durable/in-memory-spawn-stores'
import { FileSpawnJournal } from '../../src/durable/spawn-journal/journal-store'
import type { DriverContinuationRecord } from '../../src/runtime/supervise/driver-attempt-evidence'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import { type DriveHarness, supervisorAgent } from '../../src/runtime/supervise/supervisor-agent'
import type { SpawnEvent, SupervisedResult } from '../../src/runtime/supervise/types'
import { testContinuation } from '../helpers/continuation'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

/*
 * A run settles only on a terminal condition: the deadline, a cancel, an exhausted budget, or a
 * result the check accepts. A root turn that ends, a lost stream, a blocked tool and a barren
 * streak are boundaries the root is re-entered across; a barren streak paces the re-entries.
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
  const cleanup: Array<() => Promise<void>> = []
  afterEach(async () => {
    vi.useRealTimers()
    for (const step of cleanup.splice(0)) await step()
  })

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

  it('paces a barren streak with pauses of 5, 10, 20 and 40 minutes and never settles on it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'barren-pause-'))
    cleanup.push(() => rm(dir, { recursive: true, force: true }))
    // The clock at the process boundary is fake. It runs with real time so ordinary short waits
    // still fire, and each barren pause is jumped as soon as its row is on the journal.
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    const pauses: Array<Extract<SpawnEvent, { kind: 'barren-pause' }>> = []
    class PacedJournal extends FileSpawnJournal {
      override async appendEvent(root: string, event: SpawnEvent): Promise<void> {
        await super.appendEvent(root, event)
        if (event.kind !== 'barren-pause') return
        pauses.push(event)
        setImmediate(() => vi.advanceTimersByTime(event.pauseMs))
      }
    }
    const journal = new PacedJournal(join(dir, 'spawn-journal.jsonl'))
    const blobs = new InMemoryResultBlobStore()
    const abort = new AbortController()
    let composite = 0.1
    const drives: Array<{ readonly startedAt: number; readonly task: string }> = []
    const root = supervisorAgent(
      testAgentProfile('barren-root', {
        harness: 'pi',
        tools: runtimeToolDeclarations('submit_result', 'read_journal'),
      }),
      {
        blobs,
        makeWorkerAgent: () => {
          throw new Error('this profile does not grant spawning')
        },
        perWorker: { maxIterations: 4, maxTokens: 1000 },
        // Drive 1 raises the composite from nothing; re-entered drives 1 to 4 deliver nothing;
        // re-entered drive 5 raises the composite; drive 6 delivers nothing; the operator stops
        // the run on drive 7.
        driveHarness: async ({ task }) => {
          drives.push({ startedAt: Date.now(), task: String(task) })
          if (drives.length === 6) composite = 0.2
          if (drives.length === 8) abort.abort(new Error('operator stopped the run'))
        },
        deliverable: {
          describe: 'The word done.',
          check: (out: unknown) => out === 'done',
          checkState: () => ({ pass: false, composite }),
        },
        driverRetry: { initialBackoffMs: 1, maxBackoffMs: 1 },
        continuation: testContinuation({ maxBarren: 1, deadline: Date.now() + 24 * 3_600_000 }),
      },
    )
    const result = await createSupervisor<unknown, unknown>().run(root, 'Deliver the word done.', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'barren-pause',
      journal,
      blobs,
      executors: createExecutorRegistry(),
      maxDepth: 1,
      signal: abort.signal,
    })
    const minutes = (ms: number) => ms / 60_000

    // One `barren-pause` row per pause, against the root: 5, 10, 20, 40, then 5 again after the
    // composite rose.
    expect(pauses.map((pause) => [pause.id, pause.streak, minutes(pause.pauseMs)])).toEqual([
      ['barren-pause', 1, 5],
      ['barren-pause', 2, 10],
      ['barren-pause', 3, 20],
      ['barren-pause', 4, 40],
      ['barren-pause', 1, 5],
    ])
    expect(pauses.map((pause) => pause.seq)).toEqual([0, 1, 2, 3, 4])
    for (const pause of pauses) {
      expect(Date.parse(pause.resumeAt) - Date.parse(pause.at)).toBeLessThanOrEqual(pause.pauseMs)
      expect(Date.parse(pause.resumeAt) - Date.parse(pause.at)).toBeGreaterThan(
        pause.pauseMs - 1_000,
      )
    }
    // The last progress is drive 1's until drive 6 raises the composite.
    expect(new Set(pauses.slice(0, 4).map((pause) => pause.lastProgressAt)).size).toBe(1)
    expect(Date.parse(pauses[4]!.lastProgressAt)).toBeGreaterThanOrEqual(drives[5]!.startedAt)

    // Each pause separates the drive it follows from the next one.
    const gaps = drives.slice(1).map((drive, index) => drive.startedAt - drives[index]!.startedAt)
    const paused = [undefined, 5, 10, 20, 40, undefined, 5]
    for (const [index, pause] of paused.entries()) {
      if (pause === undefined) expect(gaps[index]).toBeLessThan(60_000)
      else {
        expect(gaps[index]).toBeGreaterThanOrEqual(pause * 60_000)
        expect(gaps[index]).toBeLessThan((pause + 1) * 60_000)
      }
    }
    // A drive entered after a pause is told its last turns delivered nothing and how to wait.
    expect(drives[2]!.task).toContain(
      'Your last 1 turns ended with the check unmet and delivered nothing',
    )
    expect(drives[5]!.task).toContain('Runtime waited 40 minutes before this turn')
    expect(drives[5]!.task).toContain('wake or wait tool')
    expect(drives[1]!.task).not.toContain('delivered nothing')

    // The barren streak never settled the run: the operator's stop did, on the eighth drive.
    expect(drives).toHaveLength(8)
    expect(result.kind).toBe('no-winner')
    const records = ((await journal.loadTree('barren-pause')) ?? []).flatMap((event) =>
      event.kind === 'driver-attempt' ? [event.record] : [],
    )
    // Seven drives were continued, five of them after a pause; none was refused or stopped
    // before the cancel.
    expect(records.slice(0, 7).map((record) => record.barrenPauseMs)).toEqual([
      undefined,
      5 * 60_000,
      10 * 60_000,
      20 * 60_000,
      40 * 60_000,
      undefined,
      5 * 60_000,
    ])
    expect(records.slice(0, 7).every((record) => record.reprompted === true)).toBe(true)
    expect(
      records.some(
        (record) =>
          record.repromptRefusedBy !== undefined && record.repromptRefusedBy !== 'aborted',
      ),
    ).toBe(false)
  })
})
