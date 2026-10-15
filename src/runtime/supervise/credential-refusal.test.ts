import { describe, expect, it, vi } from 'vitest'
import { RetainedRunProviderContractError } from '../retained-run-binding'
import {
  classifyDriverFailure,
  type DriverAttemptRecord,
  DriverAttemptsExhaustedError,
  type DriverBudgetReadout,
  runDriverWithRetry,
  upstreamUnavailableSignal,
} from './driver-retry'
import { RetainedExecutionPendingError } from './retained-executor'

/** The provider command's structured refusal; no HTTP response exists on this path. */
function credentialRefusal(): Error {
  return Object.assign(new Error('Subscription credential route is unsupported'), {
    name: 'TangleCredentialRefusalError',
    code: 'model_credential_refused',
    reason: 'unsupported_route',
  })
}

const budget: DriverBudgetReadout = {
  tokensLeft: 1_000_000,
  tokensKnown: true,
  cacheBreakdownKnown: true,
  usdLeft: 100,
  usdCapped: false,
  usdKnown: true,
  iterationsLeft: 100,
  deadlineMs: 0,
  reservedTokens: 0,
}

describe('permanent credential refusal', () => {
  it('recognizes only the exact own machine code on a thrown error', () => {
    const refused = credentialRefusal()
    expect(classifyDriverFailure(refused)).toBe('terminal')
    expect(upstreamUnavailableSignal(refused)).toBeUndefined()
    expect(Reflect.has(refused, 'status')).toBe(false)
    expect(Reflect.has(refused, 'statusCode')).toBe(false)

    // The SDK class name is diagnostic; the machine code is the cross-package contract.
    expect(
      classifyDriverFailure(
        Object.assign(new Error('different wording'), {
          code: 'model_credential_refused',
        }),
      ),
    ).toBe('terminal')
    const inherited = new Error('inherited metadata')
    Object.setPrototypeOf(
      inherited,
      Object.assign(Object.create(Error.prototype), {
        code: 'model_credential_refused',
      }),
    )
    for (const error of [
      new Error('model_credential_refused unsupported_route'),
      Object.assign(new Error('class name alone'), { name: 'TangleCredentialRefusalError' }),
      Object.assign(new Error('reason alone'), { reason: 'unsupported_route' }),
      Object.assign(new Error('unknown code'), { code: 'model_credential_unknown' }),
      Object.assign(new Error('wrong case'), { code: 'MODEL_CREDENTIAL_REFUSED' }),
      Object.assign(new Error('wrong type'), { code: { value: 'model_credential_refused' } }),
      { code: 'model_credential_refused' },
      inherited,
    ]) {
      expect(classifyDriverFailure(error)).toBe('transient')
    }
  })

  it('does not turn the permanent code into a capacity pause from its diagnostic text', () => {
    const error = credentialRefusal()
    error.message = 'provider_quota_exhausted status code 503'
    expect(classifyDriverFailure(error)).toBe('terminal')
    expect(upstreamUnavailableSignal(error)).toBeUndefined()
  })

  it.each(['direct', 'retained', 'wrapped-admission', 'aggregate-admission'] as const)(
    'stops the real %s driver loop after one attempt without sleep or reconciliation',
    async (path) => {
      const refusal = credentialRefusal()
      const error =
        path === 'direct'
          ? refusal
          : new RetainedExecutionPendingError(
              path === 'wrapped-admission'
                ? new Error('provider admission wrapper', { cause: refusal })
                : path === 'aggregate-admission'
                  ? new AggregateError([refusal], 'provider admission wrapper')
                  : refusal,
              'admission',
            )
      if (error instanceof RetainedExecutionPendingError) {
        expect(error.pendingCause).toBe('request-rejected')
      }
      const records: DriverAttemptRecord[] = []
      const drive = vi.fn(async () => {
        throw error
      })
      const sleep = vi.fn(async () => undefined)
      const resolvePending = vi.fn(async () => true)
      const result = await runDriverWithRetry({
        drive,
        sleep,
        resolvePending,
        signal: new AbortController().signal,
        budget: () => budget,
        progress: () => ({ poolTokensSpent: 0, settledCount: 0, submitted: false }),
        policy: { maxAttempts: 3, transientOutageMs: 0 },
        onAttempt: (record) => void records.push(record),
      }).catch((caught: unknown) => caught)
      expect(result).toBeInstanceOf(DriverAttemptsExhaustedError)
      expect(result).toMatchObject({ stop: 'terminal-error', cause: error })
      expect(drive).toHaveBeenCalledTimes(1)
      expect(sleep).not.toHaveBeenCalled()
      expect(resolvePending).not.toHaveBeenCalled()
      expect(records).toHaveLength(1)
      expect(records[0]).toMatchObject({ classification: 'terminal', stop: 'terminal-error' })
      expect(records[0]?.retryInMs).toBeUndefined()
      expect(records[0]?.unavailableSignal).toBeUndefined()
    },
  )

  it('does not classify arbitrary or post-admission cause chains as a fresh refusal', () => {
    const refusal = credentialRefusal()
    const transparent = new Error('provider observation', { cause: refusal })
    const readFailure = new RetainedRunProviderContractError('the admitted result cannot be read', {
      code: 'RETAINED_RESULT_READ_FAILED',
      cause: refusal,
    })
    expect(classifyDriverFailure(transparent)).toBe('transient')
    for (const error of [
      new RetainedExecutionPendingError(refusal, 'execution'),
      new RetainedExecutionPendingError(transparent, 'execution'),
      new RetainedExecutionPendingError(readFailure, 'admission'),
      new RetainedExecutionPendingError(readFailure, 'execution'),
    ]) {
      expect(error.pendingCause).toBe('unobservable')
      expect(classifyDriverFailure(error)).toBe('transient')
      expect(upstreamUnavailableSignal(error)).toBeUndefined()
    }
    for (const cause of [refusal, transparent, new AggregateError([refusal])]) {
      const earlierAdmission = new RetainedExecutionPendingError(cause, 'admission')
      const nestedAdmission = new RetainedExecutionPendingError(
        new Error('another admission wrapper', { cause: earlierAdmission }),
        'admission',
      )
      expect(classifyDriverFailure(nestedAdmission)).toBe('terminal')
      const execution = new RetainedExecutionPendingError(nestedAdmission, 'execution')
      expect(execution.pendingCause).toBe('unobservable')
      expect(execution.message).toContain('requires reconciliation')
      expect(classifyDriverFailure(execution)).toBe('transient')
      const read = new RetainedRunProviderContractError('read an admitted execution', {
        code: 'RETAINED_RESULT_READ_FAILED',
        cause: nestedAdmission,
      })
      for (const rewrapped of [
        new RetainedExecutionPendingError(execution, 'admission'),
        new RetainedExecutionPendingError(read, 'admission'),
        new RetainedExecutionPendingError(read, 'execution'),
      ]) {
        expect(rewrapped.pendingCause).toBe('unobservable')
        expect(classifyDriverFailure(rewrapped)).toBe('transient')
      }
    }
  })

  it('reconciles a repeated post-admission observation even with a nested admission refusal', async () => {
    const pending = new RetainedExecutionPendingError(
      new RetainedExecutionPendingError(credentialRefusal(), 'admission'),
      'execution',
    )
    const drive = vi
      .fn()
      .mockRejectedValueOnce(pending)
      .mockRejectedValueOnce(pending)
      .mockResolvedValueOnce(undefined)
    const resolvePending = vi.fn(async () => true)
    const records: DriverAttemptRecord[] = []
    await runDriverWithRetry({
      drive,
      resolvePending,
      sleep: async () => undefined,
      signal: new AbortController().signal,
      budget: () => budget,
      progress: () => ({ poolTokensSpent: 0, settledCount: 0, submitted: false }),
      policy: { maxAttempts: 3, transientOutageMs: 0 },
      onAttempt: (record) => void records.push(record),
    })
    expect(drive).toHaveBeenCalledTimes(3)
    expect(resolvePending).toHaveBeenCalledExactlyOnceWith(pending, 2)
    expect(pending.pendingCause).toBe('unobservable')
    expect(records.map((record) => record.classification)).toEqual([
      'transient',
      'transient',
      undefined,
    ])
    expect(records[1]?.abandoned).toBe(true)
    expect(records[2]?.stop).toBe('completed')
  })

  it('preserves existing nested HTTP, schema, capacity and transport evidence', () => {
    for (const cause of [
      Object.assign(new Error('HTTP refusal', { cause: credentialRefusal() }), { status: 400 }),
      Object.assign(new Error('schema refusal', { cause: credentialRefusal() }), {
        name: 'ZodError',
      }),
      Object.assign(new Error('capacity refusal', { cause: credentialRefusal() }), {
        code: 'provider_quota_exhausted',
      }),
    ]) {
      const admission = new RetainedExecutionPendingError(cause, 'admission')
      const execution = new RetainedExecutionPendingError(admission, 'execution')
      expect(admission.pendingCause).toBe('request-rejected')
      // This patch changes only the new credential refusal's nested evidence.
      expect(execution.pendingCause).toBe('request-rejected')
      expect(classifyDriverFailure(execution)).toBe('transient')
    }
    const transport = new RetainedExecutionPendingError(
      Object.assign(new Error('network', { cause: credentialRefusal() }), { code: 'ECONNRESET' }),
      'admission',
    )
    const execution = new RetainedExecutionPendingError(transport, 'execution')
    expect(execution.pendingCause).toBe('transport')
    expect(classifyDriverFailure(execution)).toBe('transient')
  })

  it.each(['provider_quota_exhausted', 'upstream_unavailable', 'ECONNRESET'])(
    'keeps %s recoverable in direct and retained driver loops',
    async (code) => {
      const capacity = code !== 'ECONNRESET'
      for (const retained of [false, true]) {
        const cause = Object.assign(
          new Error('provider cannot serve now', {
            cause: credentialRefusal(),
          }),
          { code },
        )
        const error = retained ? new RetainedExecutionPendingError(cause, 'admission') : cause
        expect(classifyDriverFailure(error)).toBe(capacity ? 'unavailable' : 'transient')
        if (error instanceof RetainedExecutionPendingError) {
          expect(error.pendingCause).toBe(capacity ? 'request-rejected' : 'transport')
        }
        const drive = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(undefined)
        const records: DriverAttemptRecord[] = []
        const sleep = vi.fn(async () => undefined)
        await runDriverWithRetry({
          drive,
          sleep,
          signal: new AbortController().signal,
          budget: () => budget,
          progress: () => ({ poolTokensSpent: 0, settledCount: 0, submitted: false }),
          policy: { maxAttempts: 3, transientOutageMs: 0 },
          onAttempt: (record) => void records.push(record),
        })
        expect(drive).toHaveBeenCalledTimes(2)
        expect(sleep).toHaveBeenCalledTimes(1)
        expect(records[0]?.classification).toBe(capacity ? 'unavailable' : 'transient')
        expect(records[1]?.stop).toBe('completed')
      }
    },
  )
})
