import { describe, expect, it } from 'vitest'
import { BackendTransportError, ConfigError, ValidationError } from '../../errors'
import { CheckUnavailableError } from './continuation'
import {
  classifyDriverFailure,
  type DriverAttemptRecord,
  DriverAttemptsExhaustedError,
  type DriverBudgetReadout,
  type DriverContinuationPolicy,
  type DriverProgressMark,
  type DriverReentry,
  HarnessTurnFailedError,
  runDriverWithRetry,
  summarizeDriverAttempts,
  upstreamUnavailableSignal,
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
    // Out of capacity is neither an accident nor a decision: the driver pauses and re-enters.
    expect(classifyDriverFailure(throttled)).toBe('unavailable')
    // Retrying an identical request against a rejected credential burns the deadline for nothing.
    expect(classifyDriverFailure(unauthorized)).toBe('terminal')
    expect(classifyDriverFailure(missing)).toBe('terminal')
  })

  it('reads an HTTP status off a provider SDK error, so a refused create does not retry forever', () => {
    // A provider SDK throws its own classes, so a refused environment `create` is neither a
    // BackendTransportError nor an AgentEvalError. Measured 2026-09-16: a Tangle Sandbox create
    // refused HTTP 400 CONFIG_ERROR (the key's budget was fully reserved by a live box) retried
    // 14-22 times per node, and eleven of twelve roots showed a durable intent and nothing else
    // for 25 minutes.
    class SandboxSdkError extends Error {
      constructor(
        message: string,
        readonly status: number,
        readonly code: string,
      ) {
        super(message)
        this.name = 'SandboxError'
      }
    }

    const refused = new SandboxSdkError('Platform key delegation failed', 400, 'CONFIG_ERROR')
    const quota = new SandboxSdkError('concurrent limit reached', 403, 'QUOTA_EXCEEDED')
    const wrongState = new SandboxSdkError('sandbox is stopped', 409, 'INVALID_STATE')
    expect(classifyDriverFailure(refused)).toBe('terminal')
    expect(classifyDriverFailure(quota)).toBe('terminal')
    expect(classifyDriverFailure(wrongState)).toBe('terminal')

    // The same split the transport branch promises: the upstream having a bad moment still retries.
    expect(classifyDriverFailure(new SandboxSdkError('gateway', 502, 'UPSTREAM'))).toBe('transient')
    expect(classifyDriverFailure(new SandboxSdkError('slow down', 429, 'RATE_LIMIT'))).toBe(
      'unavailable',
    )
    expect(classifyDriverFailure(new SandboxSdkError('timeout', 408, 'TIMEOUT'))).toBe('transient')
  })

  it('classifies a failed harness outcome by its code and never by its text', () => {
    // Both measured 2026-09-17 on a tangle-sandbox director: an upstream timeout, and a platform
    // key that expired mid-turn and was renewed. A new turn succeeds in both cases.
    const timeout = new HarnessTurnFailedError('tangle-sandbox', {
      error: 'opencode execution failed: status code 524 (exit code 1)',
    })
    const expiredKey = new HarnessTurnFailedError('tangle-sandbox', {
      error: 'opencode execution failed: Invalid API key (exit code 1)',
    })
    expect(classifyDriverFailure(timeout)).toBe('transient')
    expect(classifyDriverFailure(expiredKey)).toBe('transient')
    // Text that names a deterministic class is still text; only the machine code decides.
    expect(
      classifyDriverFailure(new HarnessTurnFailedError('bridge', { error: 'capability_denied' })),
    ).toBe('transient')
    const denied = new HarnessTurnFailedError('bridge', {
      error: 'the harness may not use this tool',
      errorCode: 'capability_denied',
    })
    expect(classifyDriverFailure(denied)).toBe('terminal')
    expect(denied.message).toContain('capability_denied')
    // A turn that failed because the run was cancelled is the cancellation, not an accident.
    const cancelled = new AbortController()
    cancelled.abort()
    expect(classifyDriverFailure(timeout, cancelled.signal)).toBe('terminal')
  })

  it('keeps the historical default when a status is absent or is not an HTTP status', () => {
    // A `status` field is common on unrelated objects; only a plain integer in the HTTP range
    // decides anything, and everything else keeps retrying as it always did.
    expect(classifyDriverFailure(Object.assign(new Error('died'), { status: 'running' }))).toBe(
      'transient',
    )
    expect(classifyDriverFailure(Object.assign(new Error('died'), { status: 0 }))).toBe('transient')
    expect(classifyDriverFailure(Object.assign(new Error('died'), { status: 302 }))).toBe(
      'transient',
    )
    expect(classifyDriverFailure(Object.assign(new Error('died'), { status: 404.5 }))).toBe(
      'transient',
    )
    expect(classifyDriverFailure('a thrown string')).toBe('transient')

    // Only a thrown Error is read. `status` is an ordinary field name on settlements, run states
    // and provider-model records; a bridge child that aborts mid-turn rejects with such a value,
    // and reading it as an HTTP refusal stopped the retry that journals its paid usage.
    expect(classifyDriverFailure({ status: 400, kind: 'cancelled' })).toBe('transient')

    // A status behind a throwing getter must not take the classifier down with it.
    const hostile = new Error('hostile')
    Object.defineProperty(hostile, 'status', {
      get() {
        throw new Error('status getter exploded')
      },
    })
    expect(classifyDriverFailure(hostile)).toBe('transient')
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

describe('retained driver failure evidence', () => {
  it('retains the first provider cause when reconciliation later fails differently', async () => {
    const script = scriptedDrive([
      new RetainedExecutionPendingError(new Error('backend runtime attachments unavailable')),
      new RetainedExecutionPendingError(new Error('original environment cannot be read')),
    ])
    const records: DriverAttemptRecord[] = []
    const error = await runDriverWithRetry({
      drive: script.drive,
      progress: () => noProgress,
      budget: () => budget(),
      signal: new AbortController().signal,
      policy: { maxAttempts: 2 },
      onAttempt: (record) => void records.push(record),
      sleep: instantSleep,
    }).catch((error: unknown) => error)
    expect(records[0]?.error).toContain('backend runtime attachments unavailable')
    expect(records[1]?.error).toContain('original environment cannot be read')
    expect(error).toBeInstanceOf(DriverAttemptsExhaustedError)
    if (!(error instanceof DriverAttemptsExhaustedError)) return
    expect(error.message).toContain('backend runtime attachments unavailable')
    expect(error.message).toContain('original environment cannot be read')
    expect(script.attempts).toEqual([1, 2])
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

  it('keeps rescuing a productive crash loop until the budget it spends runs out', async () => {
    // The driver meters a little, then dies, again and again. Each attempt is progress, so no
    // count ends it: the money it spends does. Twelve crashes pass the old default of eight.
    const script = scriptedDrive(Array.from({ length: 20 }, () => new Error('stream closed')))
    let poolTokensSpent = 0
    const error = await runDriverWithRetry({
      drive: async (attempt) => {
        poolTokensSpent += 10
        await script.drive(attempt)
      },
      progress: () => ({ poolTokensSpent, settledCount: 0, submitted: false }),
      budget: () => budget({ tokensLeft: 120 - poolTokensSpent }),
      signal: new AbortController().signal,
      sleep: instantSleep,
    }).catch((e: unknown) => e)

    expect(script.attempts).toHaveLength(12)
    expect((error as DriverAttemptsExhaustedError).stop).toBe('budget-exhausted')
  })

  it('stops at an attempt ceiling the caller sets', async () => {
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
      policy: { maxAttempts: 8 },
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

  it("re-enters with Runtime's note, and stops once the contract is met", async () => {
    const script = completingDrive(1)
    const records: DriverAttemptRecord[] = []
    await runDriverWithRetry({
      drive: script.drive,
      progress: () =>
        mark({ contract: script.delivered() ? 'met' : 'unmet', submitted: script.delivered() }),
      budget: () => budget(),
      signal: new AbortController().signal,
      continuation: continuation(),
      onAttempt: (r) => void records.push(r),
      sleep: instantSleep,
    })

    expect(script.reentries).toHaveLength(2)
    expect(script.reentries[0]).toBeUndefined()
    expect(script.reentries[1]).toEqual({
      reason: 'unmet-contract',
      steer: 'continuation 1: finish primes.txt',
      continuation: 1,
    })
    expect(records[0]?.reprompted).toBe(true)
    expect(records[0]?.contract).toBe('unmet')
    expect(records[1]?.stop).toBe('completed')
    expect(records[1]?.contract).toBe('met')
  })

  it('ends the run on the first completion when the manager has no continuation', async () => {
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
    expect(records[0]?.reprompted).toBeUndefined()
  })

  it('has no count: a director that keeps moving the check keeps being sent back', async () => {
    // The check's best composite rises on every turn; the contract turns met on the 20th.
    let composite = 0
    const records: DriverAttemptRecord[] = []
    await runDriverWithRetry({
      drive: async (attempt) => {
        composite = attempt / 20
      },
      progress: () => mark({ composite, contract: composite >= 1 ? 'met' : 'unmet' }),
      budget: () => budget(),
      signal: new AbortController().signal,
      policy: { maxAttempts: 2 },
      continuation: continuation(),
      onAttempt: (r) => void records.push(r),
      sleep: instantSleep,
    })
    expect(records).toHaveLength(20)
    expect(records.at(-1)).toMatchObject({ stop: 'completed', contract: 'met' })
  })

  it("stops at the continuation's deadline", async () => {
    const script = completingDrive(99)
    const records: DriverAttemptRecord[] = []
    await runDriverWithRetry({
      drive: script.drive,
      progress: () => mark(),
      budget: () => budget(),
      now: () => (script.reentries.length === 0 ? 0 : 11),
      signal: new AbortController().signal,
      continuation: continuation({ deadlineMs: 10 }),
      onAttempt: (r) => void records.push(r),
      sleep: instantSleep,
    })
    expect(script.reentries).toEqual([undefined])
    expect(records[0]?.repromptRefusedBy).toBe('deadline')
  })

  it('lets the run deadline and an exhausted pool refuse a continuation', async () => {
    for (const [limits, refusal] of [
      [{ deadlineMs: 10 }, 'deadline'],
      [{ tokensLeft: 0 }, 'budget-exhausted'],
    ] as const) {
      const script = completingDrive(99)
      const records: DriverAttemptRecord[] = []
      await runDriverWithRetry({
        drive: script.drive,
        progress: () => mark(),
        budget: () => (script.reentries.length === 0 ? budget() : budget(limits)),
        now: () => 11,
        signal: new AbortController().signal,
        continuation: continuation(),
        onAttempt: (r) => void records.push(r),
        sleep: instantSleep,
      })
      expect(script.reentries).toEqual([undefined])
      expect(records[0]?.repromptRefusedBy).toBe(refusal)
    }
  })

  it('lets an aborted run refuse a continuation', async () => {
    const controller = new AbortController()
    const script = completingDrive(99)
    const records: DriverAttemptRecord[] = []
    await runDriverWithRetry({
      drive: async (attempt, reentry) => {
        await script.drive(attempt, reentry)
        controller.abort('caller cancel')
      },
      progress: () => mark(),
      budget: () => budget(),
      signal: controller.signal,
      continuation: continuation(),
      onAttempt: (r) => void records.push(r),
      sleep: instantSleep,
    })
    expect(records[0]?.repromptRefusedBy).toBe('aborted')
  })

  it('never re-enters a run the coordinator closed', async () => {
    const script = completingDrive(99)
    const records: DriverAttemptRecord[] = []
    let composed = 0
    await runDriverWithRetry({
      drive: script.drive,
      progress: () => mark(),
      budget: () => budget(),
      signal: new AbortController().signal,
      continuation: continuation({
        closed: () => true,
        compose: async () => {
          composed += 1
          return 'unused'
        },
      }),
      onAttempt: (r) => void records.push(r),
      sleep: instantSleep,
    })
    expect(script.reentries).toEqual([undefined])
    expect(composed).toBe(0)
    expect(records[0]?.repromptRefusedBy).toBe('closed')
  })

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

  it('pauses, never fails, when the check itself could not run', async () => {
    let calls = 0
    const records: DriverAttemptRecord[] = []
    await runDriverWithRetry({
      drive: async () => {
        calls += 1
        if (calls <= 5) throw new CheckUnavailableError('check box did not start')
      },
      progress: () => mark({ contract: calls > 5 ? 'met' : 'unmet' }),
      budget: () => budget(),
      signal: new AbortController().signal,
      policy: { maxAttempts: 1, maxConsecutiveFailures: 1 },
      continuation: continuation(),
      onAttempt: (r) => void records.push(r),
      sleep: instantSleep,
    })
    expect(calls).toBe(6)
    expect(records.slice(0, 5).map((r) => [r.classification, r.unavailableSignal])).toEqual(
      Array.from({ length: 5 }, () => ['unavailable', 'check-unavailable']),
    )
    expect(records.at(-1)).toMatchObject({ stop: 'completed', contract: 'met' })
  })
})

describe('runDriverWithRetry — continuations end when they stop making progress', () => {
  it('stops after maxBarren continued drives in a row make no progress', async () => {
    const entered: Array<DriverReentry | undefined> = []
    const records: DriverAttemptRecord[] = []
    await runDriverWithRetry({
      drive: async (_attempt, reentry) => {
        entered.push(reentry)
      },
      progress: () => mark(),
      budget: () => budget(),
      signal: new AbortController().signal,
      continuation: continuation(),
      onAttempt: (record) => void records.push(record),
      sleep: instantSleep,
    })
    expect(entered.map((reentry) => reentry?.reason)).toEqual([
      undefined,
      'unmet-contract',
      'unmet-contract',
    ])
    expect(records.at(-1)).toMatchObject({ stop: 'completed', repromptRefusedBy: 'no-progress' })
    expect(summarizeDriverAttempts(records)).toMatchObject({
      attempts: 3,
      reprompts: 2,
      failureRetries: 0,
      barrenReentries: 2,
      ended: 'completed',
      repromptRefusedBy: 'no-progress',
    })
  })

  it('counts a rise in the check composite as progress, and a flat or falling one as none', async () => {
    // Composite per completed drive: 0.2, 0.5, 0.5, 0.4. The flat and the falling turn are barren.
    const composites = [0.2, 0.5, 0.5, 0.4]
    let best: number | undefined
    const records: DriverAttemptRecord[] = []
    await runDriverWithRetry({
      drive: async (attempt) => {
        const value = composites[attempt - 1] ?? 0
        best = best === undefined ? value : Math.max(best, value)
      },
      progress: () => mark(best === undefined ? {} : { composite: best }),
      budget: () => budget(),
      signal: new AbortController().signal,
      continuation: continuation(),
      onAttempt: (record) => void records.push(record),
      sleep: instantSleep,
    })
    expect(records.map((record) => record.madeProgress)).toEqual([true, true, false, false])
    expect(records.at(-1)?.repromptRefusedBy).toBe('no-progress')
  })

  it('counts a barren drive after a failure retry toward the same bound', async () => {
    let calls = 0
    const records: DriverAttemptRecord[] = []
    await runDriverWithRetry({
      drive: async () => {
        calls += 1
        if (calls === 2) throw new Error('stream closed')
      },
      progress: () => mark(),
      budget: () => budget(),
      signal: new AbortController().signal,
      continuation: continuation(),
      onAttempt: (record) => void records.push(record),
      sleep: instantSleep,
    })
    expect(records.map((record) => record.reentry)).toEqual([
      undefined,
      'unmet-contract',
      'driver-failure',
      'unmet-contract',
    ])
    expect(records.at(-1)?.repromptRefusedBy).toBe('no-progress')
    expect(summarizeDriverAttempts(records)).toMatchObject({ reprompts: 2, failureRetries: 1 })
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

  it.each([
    { tokensLeft: 0 },
    { iterationsLeft: 0 },
    { deadlineMs: 1 },
    { usdCapped: true, usdKnown: false },
  ])('never dispatches after the caller resource boundary (%j)', (limits) => {
    const script = scriptedDrive([null])
    return runDriverWithRetry({
      drive: script.drive,
      progress: () => noProgress,
      budget: () => budget(limits),
      signal: new AbortController().signal,
      now: () => 2,
    }).then(
      () => {
        throw new Error('expected admission refusal')
      },
      (error) => {
        expect(error).toBeInstanceOf(DriverAttemptsExhaustedError)
        expect(script.attempts).toEqual([])
      },
    )
  })

  it.each(['abort', 'budget', 'deadline'] as const)(
    'rechecks %s after the note is composed',
    async (mode) => {
      const controller = new AbortController()
      let limits: Partial<DriverBudgetReadout> = {}
      const records: DriverAttemptRecord[] = []
      const script = scriptedDrive([null, null])
      await runDriverWithRetry({
        drive: script.drive,
        progress: () => mark(),
        budget: () => budget(limits),
        signal: controller.signal,
        now: () => 2,
        onAttempt: (record) => {
          records.push(record)
        },
        continuation: continuation({
          compose: async () => {
            await Promise.resolve()
            if (mode === 'abort') controller.abort()
            else limits = mode === 'budget' ? { tokensLeft: 0 } : { deadlineMs: 1 }
            return 'continue the original task'
          },
        }),
      })
      expect(script.attempts).toEqual([1])
      expect(records[0]?.repromptRefusedBy).toBe(
        mode === 'abort' ? 'aborted' : mode === 'budget' ? 'budget-exhausted' : 'deadline',
      )
    },
  )

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
  it('does not accumulate non-consecutive transport failures across completed continuations', async () => {
    let calls = 0
    const records: DriverAttemptRecord[] = []
    await runDriverWithRetry({
      drive: async () => {
        calls++
        if (calls % 2 === 1) throw new Error('temporary transport interruption')
      },
      progress: () => mark({ contract: calls >= 12 ? 'met' : 'unmet' }),
      budget: () => budget(),
      signal: new AbortController().signal,
      policy: { maxAttempts: 20, maxConsecutiveFailures: 3 },
      continuation: continuation({ maxBarren: 99 }),
      onAttempt: (record) => {
        records.push(record)
      },
      sleep: instantSleep,
    })
    expect(calls).toBe(12)
    expect(records.filter((record) => record.error).map((record) => record.retryInMs)).toEqual([
      2000, 2000, 2000, 2000, 2000, 2000,
    ])
    expect(records.at(-1)?.contract).toBe('met')
  })

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
        policy: { maxAttempts: 20, maxConsecutiveFailures: 3 },
        continuation: continuation(),
        sleep: instantSleep,
      }),
    ).rejects.toMatchObject({ stop: 'no-progress' })
    expect(calls).toBe(4)
  })

  it('bounds cumulative failures across successful turns', async () => {
    let calls = 0
    const records: DriverAttemptRecord[] = []
    await expect(
      runDriverWithRetry({
        drive: async () => {
          calls++
          if (calls % 2 === 1) throw new Error('temporary transport interruption')
        },
        progress: () => mark(),
        budget: () => budget(),
        signal: new AbortController().signal,
        policy: { maxAttempts: 4, maxConsecutiveFailures: 3 },
        continuation: continuation({ maxBarren: 99 }),
        onAttempt: (record) => {
          records.push(record)
        },
        sleep: instantSleep,
      }),
    ).rejects.toMatchObject({ stop: 'max-attempts' })
    expect(calls).toBe(7)
    expect(records.filter((record) => record.error)).toHaveLength(4)
  })
})

// The exact failure that ended four of five anomaly-referee-v3d lead lanes on 2026-09-24.
const ROUTER_QUOTA =
  'opencode execution failed: No provider served model "deepseek/deepseek-v4.1-flash" ' +
  '(provider_quota_exhausted). A provider is configured and was called. Attempted: ' +
  'deepseek/deepseek-v4.1-flash[openrouter(err)], openrouter/deepseek/deepseek-v4.1-flash' +
  '[openrouter(err)]. GET /v1/models lists the ids this router advertises. (exit code 1)'

describe('an unavailable upstream', () => {
  it('is classified from the code or status an upstream publishes for capacity', () => {
    const quota = new HarnessTurnFailedError('tangle-sandbox', { error: ROUTER_QUOTA })
    expect(classifyDriverFailure(quota)).toBe('unavailable')
    expect(upstreamUnavailableSignal(quota)).toBe('provider_quota_exhausted')

    const coded = new HarnessTurnFailedError('bridge', {
      error: 'upstream is rate limiting this model',
      errorCode: 'provider_rate_limit',
    })
    expect(upstreamUnavailableSignal(coded)).toBe('provider_rate_limit')

    // The bridge relays the router's status in its message framing, and the transport reads it.
    const bridged = new BackendTransportError(
      'bridge',
      'bridgeExecutor: bridge stream error: pi assistant turn failed',
      { status: 503 },
    )
    expect(classifyDriverFailure(bridged)).toBe('unavailable')
    expect(upstreamUnavailableSignal(bridged)).toBe('http-503')
    expect(
      classifyDriverFailure(
        new BackendTransportError('bridge', 'overloaded', { upstreamCode: 'overloaded_error' }),
      ),
    ).toBe('unavailable')

    // A harness prints the status as `status code <n>`: 503 is capacity, 524 is an accident.
    const overloaded = new HarnessTurnFailedError('tangle-sandbox', {
      error: 'opencode execution failed: status code 503 (exit code 1)',
    })
    expect(classifyDriverFailure(overloaded)).toBe('unavailable')
    expect(
      classifyDriverFailure(
        new HarnessTurnFailedError('tangle-sandbox', {
          error: 'opencode execution failed: status code 524 (exit code 1)',
        }),
      ),
    ).toBe('transient')

    // A plain Error carrying the router's code, and an SDK error carrying the status.
    expect(classifyDriverFailure(new Error(`bridge: ${ROUTER_QUOTA}`))).toBe('unavailable')
    expect(classifyDriverFailure(Object.assign(new Error('busy'), { status: 529 }))).toBe(
      'unavailable',
    )
  })

  it('reads text only toward pausing, never toward ending a run', () => {
    // Prose that mentions a quota is not a code: it keeps its earlier class.
    expect(classifyDriverFailure(new Error('the workspace quota for this tool was exceeded'))).toBe(
      'transient',
    )
    // The router's own provider credential refused is a wait for an operator, not a driver fault.
    const routerKey = new HarnessTurnFailedError('tangle-sandbox', {
      error: 'No provider served model "x" (provider_key_invalid)',
    })
    expect(classifyDriverFailure(routerKey)).toBe('unavailable')
    expect(upstreamUnavailableSignal(routerKey)).toBe('provider_key_invalid')
    // The caller's own key refused by the router stays terminal: a 401 decides before any code.
    expect(
      classifyDriverFailure(
        new BackendTransportError('bridge', 'invalid_api_key provider_key_invalid', {
          status: 401,
        }),
      ),
    ).toBe('terminal')
    // A status decides before any text: a 401 whose body quotes a capacity code stays terminal.
    expect(
      classifyDriverFailure(
        new BackendTransportError('bridge', 'provider_quota_exhausted', { status: 401 }),
      ),
    ).toBe('terminal')
    // Runtime's own refusals stay terminal whatever their text says.
    expect(classifyDriverFailure(new ValidationError('provider_quota_exhausted'))).toBe('terminal')
    const cancelled = new AbortController()
    cancelled.abort()
    expect(
      classifyDriverFailure(
        new HarnessTurnFailedError('tangle-sandbox', { error: ROUTER_QUOTA }),
        cancelled.signal,
      ),
    ).toBe('terminal')
  })

  it('pauses without spending attempts, so an outage longer than every failure bound is survived', async () => {
    const quota = () => new HarnessTurnFailedError('tangle-sandbox', { error: ROUTER_QUOTA })
    const outcomes: Array<Error | null> = [...Array.from({ length: 20 }, quota), null]
    const script = scriptedDrive(outcomes)
    const records: DriverAttemptRecord[] = []
    await runDriverWithRetry({
      drive: script.drive,
      progress: () => mark(),
      budget: () => budget(),
      signal: new AbortController().signal,
      // Either bound alone would have ended this run at its first or second refusal.
      policy: { maxAttempts: 1, maxConsecutiveFailures: 1 },
      onAttempt: (record) => void records.push(record),
      sleep: instantSleep,
    })
    expect(script.attempts).toHaveLength(21)
    const pauses = records.filter((record) => record.classification === 'unavailable')
    expect(pauses).toHaveLength(20)
    expect(pauses.every((record) => record.stop === undefined)).toBe(true)
    expect(pauses[0]?.unavailableSignal).toBe('provider_quota_exhausted')
    // 15 s doubling to the 5-minute ceiling.
    expect(pauses.slice(0, 7).map((record) => record.retryInMs)).toEqual([
      15_000, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000,
    ])
    expect(records.at(-1)).toMatchObject({ attempt: 21, stop: 'completed' })
  })

  it('re-enters a pause with the original task and counts it apart from failure retries', async () => {
    const quota = () => new HarnessTurnFailedError('tangle-sandbox', { error: ROUTER_QUOTA })
    const entered: Array<DriverReentry | undefined> = []
    const outcomes: Array<Error | null> = [quota(), quota(), new Error('stream closed'), null]
    const records: DriverAttemptRecord[] = []
    let clock = 0
    await runDriverWithRetry({
      drive: async (attempt, reentry) => {
        entered.push(reentry)
        clock += 1_000
        const outcome = outcomes[attempt - 1]
        if (outcome) throw outcome
      },
      progress: () => mark(),
      budget: () => budget(),
      now: () => clock,
      signal: new AbortController().signal,
      onAttempt: (record) => void records.push(record),
      sleep: async (ms) => {
        clock += ms
      },
    })
    expect(entered).toEqual([
      undefined,
      { reason: 'upstream-unavailable', signal: 'provider_quota_exhausted', pause: 1 },
      { reason: 'upstream-unavailable', signal: 'provider_quota_exhausted', pause: 2 },
      expect.objectContaining({ reason: 'driver-failure', retry: 1 }),
    ])
    expect(records.map((record) => record.reentry)).toEqual([
      undefined,
      'upstream-unavailable',
      'upstream-unavailable',
      'driver-failure',
    ])
    // Two refused turns of 1 s each, paused 15 s then 30 s: 47 s of infrastructure time.
    expect(summarizeDriverAttempts(records)).toMatchObject({
      attempts: 4,
      failureRetries: 1,
      unavailablePauses: 2,
      unavailableMs: 47_000,
      ended: 'completed',
    })
  })

  it('counts a refused drive that made progress as work, and only its pause as infrastructure', async () => {
    let spent = 0
    let clock = 0
    const records: DriverAttemptRecord[] = []
    await runDriverWithRetry({
      drive: async (attempt) => {
        // The first drive works 8 minutes before the refusal; the second is refused at once.
        clock += attempt === 1 ? 480_000 : 60_000
        if (attempt === 1) spent += 1_000
        if (attempt < 3) throw new HarnessTurnFailedError('tangle-sandbox', { error: ROUTER_QUOTA })
      },
      // No declared check, so the first drive's spend is progress.
      progress: () => mark({ poolTokensSpent: spent, contract: 'none' }),
      budget: () => budget(),
      now: () => clock,
      signal: new AbortController().signal,
      onAttempt: (record) => void records.push(record),
      sleep: async (ms) => {
        clock += ms
      },
    })
    // Pauses of 15 s and 30 s, plus the 60 s refused drive; the 8 working minutes are not counted.
    expect(summarizeDriverAttempts(records)).toMatchObject({
      unavailablePauses: 2,
      unavailableMs: 105_000,
    })
  })

  it('survives the intermittent outage that ended the v3d leads, where turns work between refusals', async () => {
    // Measured shape: a declared check stays unmet, some turns spend tokens before the quota
    // refuses them, others are refused at once. The earlier loop stopped this at no-progress.
    let spent = 0
    let calls = 0
    const records: DriverAttemptRecord[] = []
    await runDriverWithRetry({
      drive: async () => {
        calls += 1
        if (calls % 3 === 0) spent += 1_000_000
        if (calls < 14) throw new HarnessTurnFailedError('tangle-sandbox', { error: ROUTER_QUOTA })
      },
      progress: () => mark({ poolTokensSpent: spent }),
      budget: () => budget(),
      signal: new AbortController().signal,
      policy: { maxAttempts: 12, maxConsecutiveFailures: 3 },
      onAttempt: (record) => void records.push(record),
      sleep: instantSleep,
    })
    expect(calls).toBe(14)
    expect(records.filter((record) => record.classification === 'unavailable')).toHaveLength(13)
    expect(records.at(-1)?.stop).toBe('completed')
  })

  it('does not charge pauses against the failure allowance real failures still use', async () => {
    const quota = new HarnessTurnFailedError('tangle-sandbox', { error: ROUTER_QUOTA })
    const accident = new Error('pi exit unknown')
    const script = scriptedDrive([accident, quota, quota, quota, accident, accident])
    await expect(
      runDriverWithRetry({
        drive: script.drive,
        progress: () => noProgress,
        budget: () => budget(),
        signal: new AbortController().signal,
        policy: { maxAttempts: 3, maxConsecutiveFailures: 10 },
        sleep: instantSleep,
      }),
    ).rejects.toMatchObject({ stop: 'max-attempts' })
    // Three accidents and three pauses: the third accident, not the sixth attempt, is the limit.
    expect(script.attempts).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('restarts the pause doubling once the upstream serves a turn that makes progress', async () => {
    let spent = 0
    const outcomes = [true, true, true, 'progress', true, false] as const
    let call = 0
    const records: DriverAttemptRecord[] = []
    await runDriverWithRetry({
      drive: async () => {
        const outcome = outcomes[call]
        call += 1
        if (outcome === 'progress') spent += 100
        if (outcome !== false) {
          throw new HarnessTurnFailedError('tangle-sandbox', { error: ROUTER_QUOTA })
        }
      },
      progress: () => ({ ...noProgress, poolTokensSpent: spent }),
      budget: () => budget(),
      signal: new AbortController().signal,
      onAttempt: (record) => void records.push(record),
      sleep: instantSleep,
    })
    expect(records.slice(0, 5).map((record) => record.retryInMs)).toEqual([
      15_000, 30_000, 60_000, 15_000, 30_000,
    ])
  })

  it('ends a pause at the deadline and names the time the outage cost', async () => {
    let clock = 0
    const error = await runDriverWithRetry({
      drive: async () => {
        clock += 60_000
        throw new HarnessTurnFailedError('tangle-sandbox', { error: ROUTER_QUOTA })
      },
      progress: () => noProgress,
      budget: () => budget({ deadlineMs: 400_000 }),
      now: () => clock,
      signal: new AbortController().signal,
      sleep: async (ms) => {
        clock += ms
      },
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(DriverAttemptsExhaustedError)
    if (!(error instanceof DriverAttemptsExhaustedError)) return
    expect(error.stop).toBe('deadline')
    expect(error.attempts.every((record) => record.classification === 'unavailable')).toBe(true)
    expect(error.message).toContain('met an unavailable upstream and paused')
    expect(error.message).toContain('provider_quota_exhausted')
  })

  it('ends a pause when the run is cancelled, and honours a caller who disabled retries', async () => {
    const controller = new AbortController()
    const quota = new HarnessTurnFailedError('tangle-sandbox', { error: ROUTER_QUOTA })
    await expect(
      runDriverWithRetry({
        drive: async () => {
          throw quota
        },
        progress: () => noProgress,
        budget: () => budget(),
        signal: controller.signal,
        sleep: async () => controller.abort(new Error('operator cancel')),
      }),
    ).rejects.toMatchObject({ stop: 'aborted' })

    await expect(
      runDriverWithRetry({
        drive: async () => {
          throw quota
        },
        progress: () => noProgress,
        budget: () => budget(),
        signal: new AbortController().signal,
        policy: { enabled: false },
        sleep: instantSleep,
      }),
    ).rejects.toMatchObject({ stop: 'retry-disabled' })
  })
})
