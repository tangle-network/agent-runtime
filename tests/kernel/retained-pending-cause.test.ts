/**
 * #1204: one reason string used to cover a safety refusal and a provider contract violation.
 * The cause is now classified from the typed error's STRUCTURE and carried as a value. Every
 * shape below is one the runtime or the Sandbox SDK actually produces; none is invented.
 */
import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../src/errors'
import { RetainedRunProviderContractError } from '../../src/runtime/retained-run-binding'
import {
  classifyRetainedPendingCause,
  RetainedExecutionPendingError,
} from '../../src/runtime/supervise/retained-executor'

/** The Sandbox SDK's error shape: a `name`, a `code`, and for HTTP failures a `status`. */
const sdk = (name: string, code: string, status?: number, message = name) =>
  Object.assign(new Error(message), { name, code, ...(status === undefined ? {} : { status }) })
const zod = () => Object.assign(new Error('maximum 16384'), { name: 'ZodError', issues: [{}] })
/** What retained-run-handle.ts mints around a thrown `handle.result()`. */
const readFailed = (cause: unknown) =>
  new RetainedRunProviderContractError(cause instanceof Error ? cause.message : 'read failed', {
    code: 'RETAINED_RESULT_READ_FAILED',
    cause,
  })

describe('classifyRetainedPendingCause', () => {
  it('names a broken provider answer by its code, whatever it wraps', () => {
    for (const code of [
      'RETAINED_RESULT_SCHEMA_INVALID',
      'RETAINED_RESULT_BINDING_INVALID',
      'RETAINED_CONTROL_REF_INVALID',
      'RETAINED_NATIVE_CONTINUATION_RESULT_CHANGED',
      'RETAINED_EVENT_BINDING_INVALID',
      'RETAINED_EVENT_STREAM_INVALID',
    ]) {
      expect(
        classifyRetainedPendingCause(new RetainedRunProviderContractError('bad answer', { code })),
        code,
      ).toBe('provider-contract')
    }
    // No code is the class's own default, a contract violation; a wrapper keeps it.
    const bare = new RetainedRunProviderContractError('bare')
    expect(classifyRetainedPendingCause(new Error('outer', { cause: bare }))).toBe(
      'provider-contract',
    )
  })

  it('looks through a failed-read wrapper at what the read hit: the #1204 ambiguity itself', () => {
    // Exhibit 4: the provider cannot resolve what it admitted. A 404 AFTER admission is not a
    // rejected request; the execution may have run and nothing local can say.
    expect(classifyRetainedPendingCause(readFailed(sdk('NotFoundError', 'NOT_FOUND', 404)))).toBe(
      'unobservable',
    )
    expect(classifyRetainedPendingCause(readFailed(sdk('StateError', 'STATE', 409)))).toBe(
      'unobservable',
    )
    expect(classifyRetainedPendingCause(readFailed(sdk('TimeoutError', 'TIMEOUT', 408)))).toBe(
      'unobservable',
    )
    expect(classifyRetainedPendingCause(readFailed(new Error('provider result read lost')))).toBe(
      'unobservable',
    )
    // Exhibits 2 and 5: an HTML 502 body, a platform ServerError. The transport, not the answer.
    expect(
      classifyRetainedPendingCause(
        readFailed(sdk('ServerError', 'SERVER_ERROR', 502, '<!DOCTYPE html> 502: Bad gateway')),
      ),
    ).toBe('transport')
    expect(
      classifyRetainedPendingCause(
        readFailed(
          sdk('ServerError', 'SERVER_ERROR', undefined, 'Platform key verification unavailable'),
        ),
      ),
    ).toBe('transport')
    // The SDK's NetworkError after exhausted reconnects carries no status and no cause.
    expect(classifyRetainedPendingCause(readFailed(sdk('NetworkError', 'NETWORK_ERROR')))).toBe(
      'transport',
    )
    expect(
      classifyRetainedPendingCause(
        readFailed(Object.assign(new Error('reset'), { code: 'ECONNRESET' })),
      ),
    ).toBe('transport')
  })

  it('names a rejected request only at admission (exhibit 1)', () => {
    expect(classifyRetainedPendingCause(zod(), 'admission')).toBe('request-rejected')
    expect(
      classifyRetainedPendingCause(sdk('ValidationError', 'VALIDATION', 400), 'admission'),
    ).toBe('request-rejected')
    // The same schema failure after admission is the runtime refusing the PROVIDER's answer.
    expect(classifyRetainedPendingCause(zod(), 'execution')).toBe('provider-contract')
    // A client deadline says nothing about admission at either phase.
    expect(classifyRetainedPendingCause(sdk('TimeoutError', 'TIMEOUT', 408), 'admission')).toBe(
      'unobservable',
    )
  })

  it('reads the members of an AggregateError, not only its cause', () => {
    // retained-run-start throws AggregateError([cause, cleanupError]) with no `cause` when the
    // environment destroy also fails; the first classifiable member decides.
    const aggregate = new AggregateError([zod(), new Error('DELETE 409')], 'start failed')
    expect(classifyRetainedPendingCause(aggregate, 'admission')).toBe('request-rejected')
    // environment-provider's observation+result AggregateError: the cause is the read.
    const both = new AggregateError(
      [
        new Error('event arrived without a stable id'),
        readFailed(sdk('ServerError', 'SERVER_ERROR', 502)),
      ],
      'observation failed',
      { cause: readFailed(sdk('ServerError', 'SERVER_ERROR', 502)) },
    )
    expect(classifyRetainedPendingCause(both)).toBe('transport')
  })

  it('keeps the safety refusal for what a structure-only classifier cannot name', () => {
    // #1204 exhibits 3 and 6 are thrown by the provider as plain Errors with no code; until the
    // provider types them they land on the safe side, and nothing here pretends otherwise.
    expect(
      classifyRetainedPendingCause(new Error('Tangle session event arrived without a stable id')),
    ).toBe('unobservable')
    expect(classifyRetainedPendingCause(new Error('value exceeds its JSON bound'))).toBe(
      'unobservable',
    )
    expect(classifyRetainedPendingCause(new Error('sandbox not found'))).toBe('unobservable')
    expect(classifyRetainedPendingCause('string rejection')).toBe('unobservable')
    expect(classifyRetainedPendingCause(undefined)).toBe('unobservable')
  })

  it('never reads message text', () => {
    expect(
      classifyRetainedPendingCause(
        new Error('RetainedRunProviderContractError: 502 Bad gateway ZodError ECONNRESET'),
      ),
    ).toBe('unobservable')
  })

  it('does not infer nested recovery; the thrower states it', () => {
    expect(
      classifyRetainedPendingCause(
        new ValidationError(
          'driverExecutor: nested recovery has no original executor reconstruction',
        ),
      ),
    ).toBe('unobservable')
  })

  it('does not loop on a cyclic cause chain', () => {
    const a = new Error('a')
    const b = new Error('b', { cause: a })
    Object.assign(a, { cause: b })
    expect(classifyRetainedPendingCause(a)).toBe('unobservable')
  })
})

describe('RetainedExecutionPendingError', () => {
  it('carries the cause as a value and says which one in its message', () => {
    const contract = new RetainedExecutionPendingError(
      new RetainedRunProviderContractError('invalid', { code: 'RETAINED_RESULT_SCHEMA_INVALID' }),
    )
    expect(contract.pendingCause).toBe('provider-contract')
    expect(contract.message).toMatch(/provider contract violation; nothing to reconcile/u)
    const unknown = new RetainedExecutionPendingError(readFailed(new Error('lost')))
    expect(unknown.pendingCause).toBe('unobservable')
    expect(unknown.message).toBe(
      'retained provider execution requires reconciliation before replacement',
    )
    expect(new RetainedExecutionPendingError(contract).pendingCause).toBe('provider-contract')
  })

  it('takes a phase or an explicit cause from its thrower', () => {
    expect(new RetainedExecutionPendingError(zod(), 'admission').pendingCause).toBe(
      'request-rejected',
    )
    expect(new RetainedExecutionPendingError(zod()).pendingCause).toBe('provider-contract')
    const nested = new RetainedExecutionPendingError(new Error('opaque'), 'nested-recovery')
    expect(nested.pendingCause).toBe('nested-recovery')
    expect(nested.message).toMatch(/nested execution requires recovery/u)
  })
})
