import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../errors'

import {
  type DriverBudgetReadout,
  type DriverContinuationPolicy,
  type DriverProgressMark,
  type DriverReentry,
  runDriverWithRetry,
} from './driver-retry'

import { RetainedExecutionPendingError } from './retained-executor'

/** A pool readout with room in every channel — the case where only the driver's own failures
 *  decide whether another attempt runs. */
function budget(over: Partial<DriverBudgetReadout> = {}): DriverBudgetReadout {
  return {
    tokensLeft: 1_000_000,
    tokensKnown: true,
    cacheBreakdownKnown: true,
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

/** A mark from a caller that DECLARED a completion check — the shape every field below is read
 *  against. `contract: 'unmet'` is the state 76.1% of the measured lab runs sat in while the old
 *  reading counted their spend as persistence. */
function mark(over: Partial<DriverProgressMark> = {}): DriverProgressMark {
  return {
    poolTokensSpent: 0,
    settledCount: 0,
    submitted: false,
    deliveredCount: 0,
    contract: 'unmet',
    ...over,
  }
}

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

describe('runDriverWithRetry', () => {
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
})

describe('runDriverWithRetry — progress tracks the deliverable, not the burn rate', () => {
  it('treats an accepted submission as progress even with the contract read a turn behind', async () => {
    const script = scriptedDrive([new Error('a'), new Error('b'), new Error('c'), null])
    let submitted = false
    await runDriverWithRetry({
      drive: async (attempt) => {
        submitted = attempt >= 3
        await script.drive(attempt)
      },
      progress: () => mark({ submitted, poolTokensSpent: 1 }),
      budget: () => budget(),
      signal: new AbortController().signal,
      sleep: instantSleep,
    })
    // Attempts 1 and 2 are barren; the submission on 3 resets the counter and buys attempt 4.
    expect(script.attempts).toEqual([1, 2, 3, 4])
  })
})

/** A continuation policy that writes a fixed note, with room in every bound unless overridden. */
function continuation(over: Partial<DriverContinuationPolicy> = {}): DriverContinuationPolicy {
  return {
    maxBarren: 2,
    deadlineMs: Number.MAX_SAFE_INTEGER,
    compose: async (context) => `continuation ${context.continuations + 1}: finish primes.txt`,
    closed: () => false,
    ...over,
  }
}

describe('runDriverWithRetry — a completed drive whose contract is unmet', () => {
  /** A drive that completes every time, and delivers only once it has been continued `after`
   *  times. Records what each attempt was re-entered with. */
  function completingDrive(after: number) {
    const reentries: Array<DriverReentry | undefined> = []
    let continued = 0
    return {
      reentries,
      delivered: () => continued >= after,
      drive: async (_attempt: number, reentry?: DriverReentry): Promise<void> => {
        reentries.push(reentry)
        if (reentry !== undefined) continued += 1
      },
    }
  }

  it('refuses an empty note rather than re-entering a session with nothing to act on', async () => {
    const script = completingDrive(99)
    const error = await runDriverWithRetry({
      drive: script.drive,
      progress: () => mark(),
      budget: () => budget(),
      signal: new AbortController().signal,
      continuation: continuation({ compose: async () => '   ' }),
      sleep: instantSleep,
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ValidationError)
  })

  it.each([0, -1, Number.POSITIVE_INFINITY, Number.NaN])(
    'refuses a continuation without a finite positive deadline (%s)',
    async (deadlineMs) => {
      const script = completingDrive(1)
      await expect(
        runDriverWithRetry({
          drive: script.drive,
          progress: () => mark(),
          budget: () => budget(),
          signal: new AbortController().signal,
          continuation: continuation({ deadlineMs }),
        }),
      ).rejects.toThrow(/finite positive deadline/u)
      expect(script.reentries).toHaveLength(0)
    },
  )

  it('retries a crashed continuation as a failure re-entry, never with the note', async () => {
    // A drive that dies may never have read the note, so replaying it in the task's place would
    // drop the run's actual instruction.
    const reentries: Array<DriverReentry | undefined> = []
    let attempts = 0
    await runDriverWithRetry({
      drive: async (_attempt, reentry) => {
        attempts += 1
        reentries.push(reentry)
        if (attempts === 2) throw new Error('stream closed')
      },
      progress: () => mark({ contract: attempts >= 3 ? 'met' : 'unmet', deliveredCount: attempts }),
      budget: () => budget(),
      signal: new AbortController().signal,
      continuation: continuation(),
      sleep: instantSleep,
    })

    expect(reentries).toHaveLength(3)
    expect(reentries[1]?.reason).toBe('unmet-contract')
    expect(reentries[2]).toEqual({ reason: 'driver-failure', failure: 'stream closed', retry: 1 })
  })
})

describe('driver admission after asynchronous callbacks', () => {
  it('never dispatches a pre-cancelled invocation', async () => {
    const controller = new AbortController()
    controller.abort(new Error('operator cancelled'))
    const script = scriptedDrive([null])
    await expect(
      runDriverWithRetry({
        drive: script.drive,
        progress: () => noProgress,
        budget: () => budget(),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ stop: 'aborted', attempts: [] })
    expect(script.attempts).toEqual([])
  })

  it('does not buy another turn if the awaited attempt observer cancels it', async () => {
    const controller = new AbortController()
    const script = scriptedDrive([null, null])
    await runDriverWithRetry({
      drive: script.drive,
      progress: () => mark(),
      budget: () => budget(),
      signal: controller.signal,
      continuation: continuation(),
      onAttempt: async () => {
        await Promise.resolve()
        controller.abort()
      },
    })
    expect(script.attempts).toEqual([1])
  })
})

describe('long-run retry streaks', () => {
  it('still stops a truly consecutive failure streak after a successful continuation', async () => {
    let calls = 0
    await expect(
      runDriverWithRetry({
        drive: async () => {
          calls++
          if (calls > 1) throw new Error('transport unavailable')
        },
        progress: () => mark(),
        budget: () => budget(),
        signal: new AbortController().signal,
        policy: { maxAttempts: 20, maxConsecutiveFailures: 3, transientOutageMs: 0 },
        continuation: continuation(),
        sleep: instantSleep,
      }),
    ).rejects.toMatchObject({ stop: 'no-progress' })
    expect(calls).toBe(4)
  })
})

/** agent-provider-tangle's `TangleCredentialCapacityError`, by structure: the subscription account
 *  owner refused a fresh dispatch before the dispatch request existed, so no HTTP status rides. */
function credentialCapacityRefusal(): Error {
  return Object.assign(new Error('Subscription account capacity is unavailable'), {
    name: 'TangleCredentialCapacityError',
    code: 'provider_quota_exhausted',
    reason: 'exhausted',
  })
}

/** The provider answered and could not resolve an execution it admitted. */
function unresolvedPending(): RetainedExecutionPendingError {
  return new RetainedExecutionPendingError(
    Object.assign(new Error('retained run not found'), { status: 404 }),
  )
}

describe('pending retained executions (terraform-dc-tokens-20261006d)', () => {
  it('abandons instead of stopping when a pending failure would end the run', async () => {
    const lost = () =>
      new RetainedExecutionPendingError(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))
    // A lost transport is never abandoned on its own: the provider may still be running it.
    const transportOnly = scriptedDrive([lost(), lost(), lost()])
    const offered: string[] = []
    const error = await runDriverWithRetry({
      drive: transportOnly.drive,
      progress: () => mark(),
      budget: () => budget(),
      signal: new AbortController().signal,
      policy: { transientOutageMs: 0 },
      sleep: instantSleep,
      resolvePending: async (failure) => {
        offered.push(failure.pendingCause)
        return true
      },
    }).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ stop: 'no-progress' })
    expect(offered).toEqual([])

    // Two transport losses, then the provider cannot resolve what it admitted: the third failure
    // would end the run, so that invocation is abandoned and its replacement completes.
    const script = scriptedDrive([lost(), lost(), unresolvedPending(), null])
    const resolved: number[] = []
    await runDriverWithRetry({
      drive: script.drive,
      progress: () => mark(),
      budget: () => budget(),
      signal: new AbortController().signal,
      policy: { transientOutageMs: 0 },
      sleep: instantSleep,
      resolvePending: async (_failure, failures) => {
        resolved.push(failures)
        return true
      },
    })
    expect(resolved).toEqual([1])
    expect(script.attempts).toEqual([1, 2, 3, 4])
  })

  it('stops a provider that loses every execution after maxConsecutiveFailures abandonments', async () => {
    const script = scriptedDrive(Array.from({ length: 30 }, () => unresolvedPending()))
    let abandoned = 0
    const error = await runDriverWithRetry({
      drive: script.drive,
      progress: () => mark(),
      budget: () => budget(),
      signal: new AbortController().signal,
      policy: { transientOutageMs: 0 },
      sleep: instantSleep,
      resolvePending: async () => {
        abandoned += 1
        return true
      },
    }).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ stop: 'pending-unresolved' })
    expect(abandoned).toBe(3)
    // Each abandonment buys the replacement a fresh streak; the fourth stuck invocation ends it.
    expect(script.attempts.length).toBeLessThan(15)
  })

  it('never stops a pending that made progress as pending-unresolved', async () => {
    // With no abandonments allowed, a pending whose drives each made progress keeps the
    // progress rule: progress earns another attempt.
    const script = scriptedDrive([unresolvedPending(), unresolvedPending(), null])
    let composite = 0
    await runDriverWithRetry({
      drive: async (attempt) => {
        composite += 1
        await script.drive(attempt)
      },
      progress: () => mark({ composite }),
      budget: () => budget(),
      signal: new AbortController().signal,
      policy: { maxConsecutiveFailures: 0, transientOutageMs: 0 },
      sleep: instantSleep,
      resolvePending: async () => true,
    })
    expect(script.attempts).toEqual([1, 2, 3])
  })

  it('keeps an owner that cannot abandon on the barren bound', async () => {
    const script = scriptedDrive([unresolvedPending(), unresolvedPending(), unresolvedPending()])
    const error = await runDriverWithRetry({
      drive: script.drive,
      progress: () => mark(),
      budget: () => budget(),
      signal: new AbortController().signal,
      policy: { transientOutageMs: 0 },
      sleep: instantSleep,
      resolvePending: async () => false,
    }).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ stop: 'no-progress' })
    expect(script.attempts).toEqual([1, 2, 3])
  })

  it('does not count time paused for capacity against the transient outage window', async () => {
    let clock = 0
    const lost = new Error('fetch failed')
    const refused = new RetainedExecutionPendingError(credentialCapacityRefusal(), 'admission')
    // One transient failure, 20 minutes of capacity refusals, then two more transient failures:
    // the transient streak itself lasted seconds, inside a one-minute window.
    const script = scriptedDrive([
      lost,
      ...Array.from({ length: 20 }, () => refused),
      lost,
      lost,
      null,
    ])
    await runDriverWithRetry({
      drive: async (attempt) => {
        clock += 1_000
        await script.drive(attempt)
      },
      progress: () => mark(),
      budget: () => budget(),
      signal: new AbortController().signal,
      policy: {
        transientOutageMs: 60_000,
        unavailablePauseMs: 60_000,
        maxUnavailablePauseMs: 60_000,
      },
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
      },
      random: () => 0,
    })
    expect(script.attempts).toHaveLength(24)
  })
})
