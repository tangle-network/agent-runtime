import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type Budget,
  type DriveHarness,
  FileSpawnJournal,
  type SupervisedResult,
  supervise,
} from '@tangle-network/agent-runtime/kernel'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { testContinuation } from '../helpers/continuation'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

/*
 * A run ends when its check passes, when it is cancelled, or on a budget the caller set, and each
 * ending carries its own name. Measured 2026-10-21 over 259 runs: 93 settled on the play's
 * wall-clock deadline and were labelled `budget-exhausted` with a median 99.8% of their tokens
 * left, and 61 of the 62 `terminal-error` loops were that deadline cutting a turn.
 */

/** The deadline those runs carried: the Discovery play's 8 hours (`driver-retry.ts` header). */
const OLD_DEFAULT_DEADLINE_MS = 8 * 3_600_000

const budget: Budget = { maxIterations: 100, maxTokens: 100_000 }

async function call(url: string, name: string, args: unknown): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: name,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  expect(response.ok).toBe(true)
}

/** A continuation policy with no clock of its own. */
function noDeadlineContinuation() {
  const { deadline: _deadline, ...policy } = testContinuation()
  return policy
}

const directories: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function runRoot(options: {
  readonly runId: string
  readonly budget: Budget
  readonly drive: DriveHarness
  readonly signal?: AbortSignal
}): Promise<{
  readonly result: SupervisedResult<unknown>
  /** Every driver-attempt row the root's loop journaled, in order. */
  readonly stops: ReadonlyArray<string | undefined>
}> {
  const directory = await mkdtemp(join(tmpdir(), 'run-endings-'))
  directories.push(directory)
  const journal = new FileSpawnJournal(join(directory, 'spawn-journal.jsonl'))
  let drives = 0
  let returned = 0
  const drive: DriveHarness = async (input) => {
    drives += 1
    try {
      await options.drive(input)
    } finally {
      returned += 1
    }
  }
  const stopsOf = async () =>
    ((await journal.loadTree(options.runId)) ?? []).flatMap((event) =>
      event.kind === 'driver-attempt' ? [event.record.stop] : [],
    )
  const result = await supervise(
    testAgentProfile('ending-root', { tools: runtimeToolDeclarations('submit_result') }),
    'Deliver the word done.',
    {
      runId: options.runId,
      budget: options.budget,
      journal,
      deliverable: { describe: 'The word done.', check: (out: unknown) => out === 'done' },
      continuation: noDeadlineContinuation(),
      driverRetry: { initialBackoffMs: 1, maxBackoffMs: 1 },
      driveHarness: drive,
      makeLeafAgent: () => {
        throw new Error('this root does not spawn')
      },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
  )
  // An abort settles the run without waiting for the root's turn: the cut drive returns after,
  // and its loop journals the attempt then. Read the journal once every drive has recorded.
  await vi.waitFor(
    async () => {
      expect(returned).toBe(drives)
      expect(await stopsOf()).toHaveLength(drives)
    },
    { timeout: 10_000 },
  )
  return { result, stops: await stopsOf() }
}

/** Resolve once `signal` aborts. */
function aborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve()
    else signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

describe('a run ends on its check, a cancel or a budget, and names the ending', () => {
  it('with no deadline, stays open past twice the old default and settles on its check', async () => {
    // The clock at the process boundary is fake and runs with real time, so short waits fire.
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    const startedAt = Date.now()
    const turns: Array<{ readonly at: number; readonly abortedAfterWait?: boolean }> = []
    const { result, stops } = await runRoot({
      runId: 'no-deadline',
      budget,
      drive: async ({ coordinationMcpUrl, scope }) => {
        if (turns.length === 0) {
          // The first turn works for 16 hours on the run's clock and delivers nothing.
          await vi.advanceTimersByTimeAsync(2 * OLD_DEFAULT_DEADLINE_MS)
          turns.push({ at: Date.now(), abortedAfterWait: scope.signal.aborted })
          return
        }
        turns.push({ at: Date.now() })
        await call(coordinationMcpUrl, 'submit_result', { result: 'done' })
      },
    })

    expect(turns).toHaveLength(2)
    expect(turns[0]!.abortedAfterWait).toBe(false)
    expect(turns[1]!.at - startedAt).toBeGreaterThanOrEqual(2 * OLD_DEFAULT_DEADLINE_MS)
    expect(result.kind).toBe('winner')
    expect(result.continuation?.ended).toBe('completed')
    // The first turn was continued (no stop); the second completed with the check met.
    expect(stops).toEqual([undefined, 'completed'])
  })

  it("settles a run whose deadline expires mid-turn as 'deadline', not 'budget-exhausted'", async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    let turns = 0
    const { result, stops } = await runRoot({
      runId: 'deadline-expires',
      budget: { ...budget, deadlineMs: 60_000 },
      drive: async ({ scope }) => {
        turns += 1
        const cut = aborted(scope.signal)
        await vi.advanceTimersByTimeAsync(61_000)
        await cut
        throw new Error('the turn was cut by its abort')
      },
    })

    expect(turns).toBe(1)
    expect(result).toMatchObject({ kind: 'no-winner', reason: 'deadline' })
    expect(stops).toEqual(['deadline'])
  })

  it("records a cancelled live run as ended 'aborted', never 'terminal-error'", async () => {
    const operator = new AbortController()
    let turns = 0
    const { result, stops } = await runRoot({
      runId: 'cancelled-live',
      budget,
      signal: operator.signal,
      drive: async ({ scope }) => {
        turns += 1
        const cut = aborted(scope.signal)
        operator.abort(new Error('operator stopped the run'))
        await cut
        throw new Error('the turn was cut by its abort')
      },
    })

    expect(turns).toBe(1)
    // A caller's cancellation is the `cancelled` arm; its driver loop ended `aborted`.
    expect(result).toMatchObject({ kind: 'no-winner', reason: 'cancelled' })
    expect(stops).toEqual(['aborted'])
  })
})
