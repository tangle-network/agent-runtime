import { describe, expect, it } from 'vitest'
import { BackendTransportError, ConfigError, ValidationError } from '../../errors'
import {
  classifyDriverFailure,
  type DriverAttemptRecord,
  DriverAttemptsExhaustedError,
  type DriverBudgetReadout,
  type DriverProgressMark,
  runDriverWithRetry,
} from './driver-retry'

/** A pool readout with room in every channel — the case where only the driver's own failures
 *  decide whether another attempt runs. */
function budget(over: Partial<DriverBudgetReadout> = {}): DriverBudgetReadout {
  return {
    tokensLeft: 1_000_000,
    tokensKnown: true,
    usdLeft: 100,
    usdCapped: false,
    usdKnown: true,
    iterationsLeft: 100,
    deadlineMs: 0,
    reservedTokens: 0,
    ...over,
  }
}

const noProgress: DriverProgressMark = { poolTokensSpent: 0, settledCount: 0, submitted: false }

/** Drive a scripted sequence of outcomes. `null` completes the attempt; an Error rejects it. */
function scriptedDrive(outcomes: ReadonlyArray<Error | null>) {
  const attempts: number[] = []
  return {
    attempts,
    drive: async (attempt: number): Promise<void> => {
      attempts.push(attempt)
      const outcome = outcomes[attempt - 1]
      if (outcome === undefined) throw new Error(`drive called ${attempt} times; script has fewer`)
      if (outcome !== null) throw outcome
    },
  }
}

/** No real waiting: the backoff is asserted from the emitted records, never slept through. */
const instantSleep = async (): Promise<void> => undefined

describe('classifyDriverFailure', () => {
  it('treats a foreign accident as transient and a Runtime refusal as terminal', () => {
    // `pi exit unknown` — a harness process that died without saying why. The exact class the
    // retry exists for, and a plain Error is how it reaches us.
    expect(classifyDriverFailure(new Error('pi exit unknown'))).toBe('transient')
    expect(classifyDriverFailure(new ValidationError('supervisor budget exhausted'))).toBe(
      'terminal',
    )
    expect(classifyDriverFailure(new ConfigError('missing bridgeBearer'))).toBe('terminal')
  })

  it('splits a backend transport failure by status: upstream fault retries, bad request does not', () => {
    const upstream = new BackendTransportError('bridge', 'bad gateway', { status: 502 })
    const throttled = new BackendTransportError('bridge', 'slow down', { status: 429 })
    const unauthorized = new BackendTransportError('bridge', 'invalid_api_key', { status: 401 })
    const missing = new BackendTransportError('bridge', 'no such session', { status: 404 })
    expect(classifyDriverFailure(upstream)).toBe('transient')
    expect(classifyDriverFailure(throttled)).toBe('transient')
    // Retrying an identical request against a rejected credential burns the deadline for nothing.
    expect(classifyDriverFailure(unauthorized)).toBe('terminal')
    expect(classifyDriverFailure(missing)).toBe('terminal')
  })

  it('never retries an abort, whichever way it presents', () => {
    const aborted = new AbortController()
    aborted.abort('caller cancel')
    expect(classifyDriverFailure(new Error('anything'), aborted.signal)).toBe('terminal')
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    expect(classifyDriverFailure(abortError)).toBe('terminal')
  })
})

describe('runDriverWithRetry', () => {
  it('rescues a transient failure: the second attempt completes and the run never fails', async () => {
    const script = scriptedDrive([new Error('pi exit unknown'), null])
    const records: DriverAttemptRecord[] = []
    await runDriverWithRetry({
      drive: script.drive,
      progress: () => noProgress,
      budget: () => budget(),
      signal: new AbortController().signal,
      onAttempt: (r) => void records.push(r),
      sleep: instantSleep,
    })

    expect(script.attempts).toEqual([1, 2])
    expect(records[0]?.retryInMs).toBe(2_000)
    expect(records[1]?.stop).toBe('completed')
  })

  it('fails immediately on a terminal error without spending a second attempt', async () => {
    const script = scriptedDrive([new ValidationError('driveHarnessFromBackend: budget exhausted')])
    await expect(
      runDriverWithRetry({
        drive: script.drive,
        progress: () => noProgress,
        budget: () => budget(),
        signal: new AbortController().signal,
        sleep: instantSleep,
      }),
    ).rejects.toBeInstanceOf(DriverAttemptsExhaustedError)
    // One attempt: Runtime's own refusal is a decision, and re-running it just re-decides.
    expect(script.attempts).toEqual([1])
  })

  it('gives up in three attempts when the driver is dead on arrival', async () => {
    // The dotenvx-race shape: the harness dies instantly, spends nothing, settles nothing. Without
    // the no-progress ceiling this would retry against a 6-hour deadline.
    const dead = () => new Error('pi exit unknown')
    const script = scriptedDrive([dead(), dead(), dead()])
    const records: DriverAttemptRecord[] = []
    const error = await runDriverWithRetry({
      drive: script.drive,
      progress: () => noProgress,
      budget: () => budget(),
      signal: new AbortController().signal,
      onAttempt: (r) => void records.push(r),
      sleep: instantSleep,
    }).catch((e: unknown) => e)

    expect(script.attempts).toEqual([1, 2, 3])
    expect(error).toBeInstanceOf(DriverAttemptsExhaustedError)
    if (!(error instanceof DriverAttemptsExhaustedError)) return
    expect(error.stop).toBe('no-progress')
    expect(error.attempts).toHaveLength(3)
    // The message is the diagnosis the issue asked for: attempt count, stop reason, real cause.
    expect(error.message).toContain('3 attempt(s)')
    expect(error.message).toContain('no-progress')
    expect(error.message).toContain('pi exit unknown')
    // Backoff doubles across barren attempts rather than hot-looping.
    expect(records.map((r) => r.retryInMs)).toEqual([2_000, 4_000, undefined])
  })

  it('keeps rescuing a driver that is making progress between crashes', async () => {
    // Seven crashes, each after real work, then success. The barren ceiling never arms, because it
    // measures futility rather than failure count — a long productive run is not abandoned for
    // crashing repeatedly.
    const outcomes = Array.from({ length: 7 }, () => new Error('stream closed'))
    const script = scriptedDrive([...outcomes, null])
    let poolTokensSpent = 0
    await runDriverWithRetry({
      drive: async (attempt) => {
        poolTokensSpent += 1_000
        await script.drive(attempt)
      },
      progress: () => ({ poolTokensSpent, settledCount: 0, submitted: false }),
      budget: () => budget(),
      signal: new AbortController().signal,
      sleep: instantSleep,
    })
    expect(script.attempts).toHaveLength(8)
  })

  it('stops at the absolute attempt ceiling even while every attempt looks productive', async () => {
    // The pathological case the barren counter cannot see: the driver meters a little, then dies,
    // forever. Each attempt reads as progress, so only the absolute ceiling ends it before the
    // whole envelope is gone.
    const script = scriptedDrive(Array.from({ length: 20 }, () => new Error('stream closed')))
    let poolTokensSpent = 0
    const error = await runDriverWithRetry({
      drive: async (attempt) => {
        poolTokensSpent += 10
        await script.drive(attempt)
      },
      progress: () => ({ poolTokensSpent, settledCount: 0, submitted: false }),
      budget: () => budget(),
      signal: new AbortController().signal,
      sleep: instantSleep,
    }).catch((e: unknown) => e)

    expect(script.attempts).toHaveLength(8)
    expect((error as DriverAttemptsExhaustedError).stop).toBe('max-attempts')
  })

  it('refuses to retry once a dollar-capped pool has been tainted by an unknown cost', async () => {
    // The pool closes admission permanently at that point, so another attempt could only reproduce
    // the same refusal — proved from the pool's own readout, not from how the error was thrown.
    const error = await runDriverWithRetry({
      drive: scriptedDrive([new Error('bridge stream closed')]).drive,
      progress: () => noProgress,
      budget: () => budget({ usdCapped: true, usdKnown: false }),
      signal: new AbortController().signal,
      sleep: instantSleep,
    }).catch((e: unknown) => e)
    expect((error as DriverAttemptsExhaustedError).stop).toBe('budget-exhausted')
  })

  it('counts a settled child as progress even when the driver metered nothing', async () => {
    let settledCount = 0
    const script = scriptedDrive([new Error('a'), new Error('b'), new Error('c'), null])
    await runDriverWithRetry({
      drive: async (attempt) => {
        settledCount += 1
        await script.drive(attempt)
      },
      progress: () => ({ poolTokensSpent: 0, settledCount, submitted: false }),
      budget: () => budget(),
      signal: new AbortController().signal,
      sleep: instantSleep,
    })
    expect(script.attempts).toEqual([1, 2, 3, 4])
  })

  it('stops at the budget and at the deadline, naming which one', async () => {
    const exhausted = await runDriverWithRetry({
      drive: scriptedDrive([new Error('boom')]).drive,
      progress: () => noProgress,
      budget: () => budget({ tokensLeft: 0 }),
      signal: new AbortController().signal,
      sleep: instantSleep,
    }).catch((e: unknown) => e)
    expect((exhausted as DriverAttemptsExhaustedError).stop).toBe('budget-exhausted')

    const late = await runDriverWithRetry({
      drive: scriptedDrive([new Error('boom')]).drive,
      progress: () => noProgress,
      budget: () => budget({ deadlineMs: 10 }),
      now: () => 11,
      signal: new AbortController().signal,
      sleep: instantSleep,
    }).catch((e: unknown) => e)
    expect((late as DriverAttemptsExhaustedError).stop).toBe('deadline')
  })

  it('stops when the run is cancelled mid-backoff', async () => {
    const controller = new AbortController()
    const error = await runDriverWithRetry({
      drive: scriptedDrive([new Error('boom'), new Error('unreachable')]).drive,
      progress: () => noProgress,
      budget: () => budget(),
      signal: controller.signal,
      // The abort lands exactly where it does in production: while the retry is waiting.
      sleep: async () => controller.abort('caller cancel'),
    }).catch((e: unknown) => e)
    expect((error as DriverAttemptsExhaustedError).stop).toBe('aborted')
  })

  it('restores the historical first-failure-ends-the-run behavior when disabled', async () => {
    const script = scriptedDrive([new Error('pi exit unknown'), null])
    const error = await runDriverWithRetry({
      drive: script.drive,
      progress: () => noProgress,
      budget: () => budget(),
      signal: new AbortController().signal,
      policy: { enabled: false },
      sleep: instantSleep,
    }).catch((e: unknown) => e)
    expect(script.attempts).toEqual([1])
    expect((error as DriverAttemptsExhaustedError).stop).toBe('retry-disabled')
  })

  it('carries the original failure as the cause so the caller keeps the real error', async () => {
    const fault = new Error('pi exit unknown')
    const error = await runDriverWithRetry({
      drive: scriptedDrive([fault, fault, fault]).drive,
      progress: () => noProgress,
      budget: () => budget(),
      signal: new AbortController().signal,
      sleep: instantSleep,
    }).catch((e: unknown) => e)
    expect((error as DriverAttemptsExhaustedError).cause).toBe(fault)
  })
})
