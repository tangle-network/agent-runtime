import { describe, expect, it } from 'vitest'
import { BackendTransportError, ConfigError, ValidationError } from '../../errors'
import {
  classifyDriverFailure,
  type DriverAttemptRecord,
  DriverAttemptsExhaustedError,
  type DriverBudgetReadout,
  type DriverProgressMark,
  type DriverReentry,
  defaultUnmetContractSteer,
  runDriverWithRetry,
} from './driver-retry'

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

  it('settles a profile that cannot materialize after one attempt, with or without a status', () => {
    // The bridge reports a materialization failure as its own `parse_error` class; on the stream
    // path no status rides with it, and the status split alone re-drove the same deterministic
    // refusal to the attempt ceiling (#1081, 12 barren re-drives under the lab's policy).
    const materialization = new BackendTransportError(
      'bridge',
      'bridgeExecutor: bridge stream error: AgentProfile workspace materialization failed: ' +
        'Duplicate profile resource path: .opencode/skills/method-refute-v2/SKILL.md (skills, skills)',
      { upstreamCode: 'parse_error' },
    )
    expect(classifyDriverFailure(materialization)).toBe('terminal')
    expect(
      classifyDriverFailure(
        new BackendTransportError('bridge', 'harness not configured', {
          upstreamCode: 'not_configured',
        }),
      ),
    ).toBe('terminal')
    // A relayed upstream accident with no status keeps the retry-on-unknown behaviour.
    expect(
      classifyDriverFailure(
        new BackendTransportError('bridge', 'pi exit unknown', { upstreamCode: 'upstream' }),
      ),
    ).toBe('transient')
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

describe('runDriverWithRetry — progress tracks the deliverable, not the burn rate', () => {
  it('refuses to read spend and settlements as progress while a declared check is unmet', async () => {
    // The measured shape: the driver meters turns and settles children, run after run, and never
    // delivers. The old mark called every attempt productive, so the barren ceiling never armed and
    // the run retried to its absolute ceiling. Now it gives up as a dead driver does.
    const script = scriptedDrive(Array.from({ length: 8 }, () => new Error('stream closed')))
    let poolTokensSpent = 0
    let settledCount = 0
    const error = await runDriverWithRetry({
      drive: async (attempt) => {
        poolTokensSpent += 5_000
        settledCount += 1
        await script.drive(attempt)
      },
      progress: () => mark({ poolTokensSpent, settledCount }),
      budget: () => budget(),
      signal: new AbortController().signal,
      sleep: instantSleep,
    }).catch((e: unknown) => e)

    expect(script.attempts).toEqual([1, 2, 3])
    expect((error as DriverAttemptsExhaustedError).stop).toBe('no-progress')
  })

  it('counts a child that PASSED the check as progress and keeps rescuing the run', async () => {
    // The other half of the same rule: real delivery, not spend, buys another attempt.
    const script = scriptedDrive(Array.from({ length: 20 }, () => new Error('stream closed')))
    let deliveredCount = 0
    const error = await runDriverWithRetry({
      drive: async (attempt) => {
        deliveredCount += 1
        await script.drive(attempt)
      },
      progress: () => mark({ settledCount: deliveredCount, deliveredCount }),
      budget: () => budget(),
      signal: new AbortController().signal,
      sleep: instantSleep,
    }).catch((e: unknown) => e)

    expect(script.attempts).toHaveLength(8)
    expect((error as DriverAttemptsExhaustedError).stop).toBe('max-attempts')
  })

  it('leaves a caller who declares no check on the exact historical spend reading', async () => {
    const script = scriptedDrive(Array.from({ length: 20 }, () => new Error('stream closed')))
    let poolTokensSpent = 0
    const error = await runDriverWithRetry({
      drive: async (attempt) => {
        poolTokensSpent += 10
        await script.drive(attempt)
      },
      // No `contract` field at all: the shape every pre-existing caller constructs.
      progress: () => ({ poolTokensSpent, settledCount: 0, submitted: false }),
      budget: () => budget(),
      signal: new AbortController().signal,
      sleep: instantSleep,
    }).catch((e: unknown) => e)

    expect(script.attempts).toHaveLength(8)
    expect((error as DriverAttemptsExhaustedError).stop).toBe('max-attempts')
  })

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

describe('runDriverWithRetry — a completed drive whose contract is unmet', () => {
  /** A drive that completes every time, and delivers only once it has been re-prompted `after`
   *  times. Records what each attempt was re-entered with. */
  function completingDrive(after: number) {
    const reentries: Array<DriverReentry | undefined> = []
    let reprompts = 0
    return {
      reentries,
      delivered: () => reprompts >= after,
      drive: async (_attempt: number, reentry?: DriverReentry): Promise<void> => {
        reentries.push(reentry)
        if (reentry !== undefined) reprompts += 1
      },
    }
  }

  it('re-enters the SAME session with the unmet items, and stops once the contract is met', async () => {
    const script = completingDrive(1)
    const records: DriverAttemptRecord[] = []
    await runDriverWithRetry({
      drive: script.drive,
      progress: () =>
        mark({ contract: script.delivered() ? 'met' : 'unmet', submitted: script.delivered() }),
      budget: () => budget(),
      signal: new AbortController().signal,
      reprompt: { maxReprompts: 2, describe: 'primes.txt holding the first 20 primes' },
      onAttempt: (r) => void records.push(r),
      sleep: instantSleep,
    })

    expect(script.reentries).toHaveLength(2)
    // The first entry is the caller's own task; the second is the unmet-items instruction.
    expect(script.reentries[0]).toBeUndefined()
    expect(script.reentries[1]?.reason).toBe('unmet-contract')
    expect(script.reentries[1]?.reprompt).toBe(1)
    expect(script.reentries[1]?.steer).toContain('primes.txt holding the first 20 primes')
    expect(records[0]?.reprompted).toBe(true)
    expect(records[0]?.contract).toBe('unmet')
    expect(records[1]?.stop).toBe('completed')
    expect(records[1]?.contract).toBe('met')
  })

  it('ends the run on the first completion when no re-prompt is configured', async () => {
    // The measured status quo: 376 of 376 winning lab runs ended here, and the completion gate
    // could only label the result.
    const script = completingDrive(1)
    const records: DriverAttemptRecord[] = []
    await runDriverWithRetry({
      drive: script.drive,
      progress: () => mark(),
      budget: () => budget(),
      signal: new AbortController().signal,
      onAttempt: (r) => void records.push(r),
      sleep: instantSleep,
    })

    expect(script.reentries).toEqual([undefined])
    expect(records[0]?.stop).toBe('completed')
    expect(records[0]?.contract).toBe('unmet')
    expect(records[0]?.reprompted).toBeUndefined()
  })

  it('stops at the re-prompt cap rather than arguing with the harness forever', async () => {
    const script = completingDrive(99)
    const records: DriverAttemptRecord[] = []
    await runDriverWithRetry({
      drive: script.drive,
      progress: () => mark(),
      budget: () => budget(),
      signal: new AbortController().signal,
      reprompt: { maxReprompts: 2 },
      onAttempt: (r) => void records.push(r),
      sleep: instantSleep,
    })

    expect(script.reentries).toHaveLength(3)
    expect(records.map((r) => r.reprompted)).toEqual([true, true, undefined])
    expect(records[2]?.repromptRefusedBy).toBe('reprompts-exhausted')
    expect(records[2]?.stop).toBe('completed')
  })

  it('lets the deadline refuse a re-prompt — the bound the completed path never used to read', async () => {
    const script = completingDrive(99)
    const records: DriverAttemptRecord[] = []
    await runDriverWithRetry({
      drive: script.drive,
      progress: () => mark(),
      budget: () => budget({ deadlineMs: 10 }),
      now: () => 11,
      signal: new AbortController().signal,
      reprompt: { maxReprompts: 5 },
      onAttempt: (r) => void records.push(r),
      sleep: instantSleep,
    })

    expect(script.reentries).toEqual([undefined])
    expect(records[0]?.repromptRefusedBy).toBe('deadline')
  })

  it('lets an exhausted pool refuse a re-prompt', async () => {
    const script = completingDrive(99)
    const records: DriverAttemptRecord[] = []
    await runDriverWithRetry({
      drive: script.drive,
      progress: () => mark(),
      budget: () => budget({ tokensLeft: 0 }),
      signal: new AbortController().signal,
      reprompt: { maxReprompts: 5 },
      onAttempt: (r) => void records.push(r),
      sleep: instantSleep,
    })
    expect(script.reentries).toEqual([undefined])
    expect(records[0]?.repromptRefusedBy).toBe('budget-exhausted')
  })

  it('lets an aborted run refuse a re-prompt', async () => {
    const controller = new AbortController()
    controller.abort('caller cancel')
    const script = completingDrive(99)
    const records: DriverAttemptRecord[] = []
    await runDriverWithRetry({
      drive: script.drive,
      progress: () => mark(),
      budget: () => budget(),
      signal: controller.signal,
      reprompt: { maxReprompts: 5 },
      onAttempt: (r) => void records.push(r),
      sleep: instantSleep,
    })
    expect(records[0]?.repromptRefusedBy).toBe('aborted')
  })

  it('bounds re-prompts by the absolute attempt ceiling as well as by their own cap', async () => {
    const script = completingDrive(99)
    const records: DriverAttemptRecord[] = []
    await runDriverWithRetry({
      drive: script.drive,
      progress: () => mark(),
      budget: () => budget(),
      signal: new AbortController().signal,
      policy: { maxAttempts: 2 },
      reprompt: { maxReprompts: 9 },
      onAttempt: (r) => void records.push(r),
      sleep: instantSleep,
    })

    expect(script.reentries).toHaveLength(2)
    expect(records[1]?.repromptRefusedBy).toBe('max-attempts')
  })

  it('lets the caller end the run instead of re-prompting', async () => {
    const script = completingDrive(99)
    const records: DriverAttemptRecord[] = []
    await runDriverWithRetry({
      drive: script.drive,
      progress: () => mark(),
      budget: () => budget(),
      signal: new AbortController().signal,
      reprompt: { maxReprompts: 5, onUnmetContract: () => 'stop' },
      onAttempt: (r) => void records.push(r),
      sleep: instantSleep,
    })

    expect(script.reentries).toEqual([undefined])
    expect(records[0]?.repromptRefusedBy).toBe('caller-stop')
  })

  it('carries the caller-composed instruction into the live session verbatim', async () => {
    const script = completingDrive(1)
    await runDriverWithRetry({
      drive: script.drive,
      progress: () => mark({ contract: script.delivered() ? 'met' : 'unmet' }),
      budget: () => budget(),
      signal: new AbortController().signal,
      reprompt: {
        maxReprompts: 1,
        onUnmetContract: (ctx) => ({ steer: `attempt ${ctx.attempt}: finish primes.txt` }),
      },
      sleep: instantSleep,
    })
    expect(script.reentries[1]?.steer).toBe('attempt 1: finish primes.txt')
  })

  it('refuses an empty instruction rather than re-entering a session with nothing to act on', async () => {
    const script = completingDrive(99)
    const error = await runDriverWithRetry({
      drive: script.drive,
      progress: () => mark(),
      budget: () => budget(),
      signal: new AbortController().signal,
      reprompt: { maxReprompts: 1, onUnmetContract: () => ({ steer: '   ' }) },
      sleep: instantSleep,
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ValidationError)
  })

  it('retries a crashed re-prompt with the ORIGINAL task, never with the unmet-items text', async () => {
    // A drive that dies may never have read the re-prompt, so replaying it in the task's place
    // would drop the run's actual instruction.
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
      reprompt: { maxReprompts: 3 },
      sleep: instantSleep,
    })

    expect(reentries).toHaveLength(3)
    expect(reentries[1]?.reason).toBe('unmet-contract')
    expect(reentries[2]).toBeUndefined()
  })
})

describe('defaultUnmetContractSteer', () => {
  it('states the verdict, names what is owed, and reports the ledger', () => {
    const text = defaultUnmetContractSteer({
      attempt: 1,
      reprompts: 0,
      maxReprompts: 2,
      progress: mark({ settledCount: 3, deliveredCount: 0 }),
      budget: budget(),
      describe: 'primes.txt holding the first 20 primes',
    })
    expect(text).toContain('The completion check has not passed.')
    expect(text).toContain('primes.txt holding the first 20 primes')
    expect(text).toContain('Workers settled: 3. Workers that passed the check: 0.')
    expect(text).toContain('Then submit the result.')
  })

  it('says the deliverable is missing when the check describes nothing', () => {
    const text = defaultUnmetContractSteer({
      attempt: 1,
      reprompts: 0,
      maxReprompts: 1,
      progress: mark(),
      budget: budget(),
    })
    expect(text).toContain('The deliverable this run owes is still missing.')
  })
})
