import { describe, expect, it } from 'vitest'
import { classifyDriverFailure } from './driver-attempt-evidence'
import { DISPATCH_EXECUTION_CHANGED_CODE, RetainedExecutionPendingError } from './retained-executor'

/**
 * agent-sdk #475: the provider names a dispatch contradiction
 * (`TangleDispatchExecutionChangedError`, code DISPATCH_EXECUTION_CHANGED, since
 * agent-provider-tangle 5.0.8) instead of a plain Error. A retry receives the same
 * answer — research-ucs-formalization-20260909contractv2d logged it on 107 attempts
 * over 39 minutes, all classed transient, before the run settled all-children-down.
 * This file pins the pairing: first occurrence, terminal, retained or bare.
 */
const changedError = (): Error =>
  Object.assign(
    new Error('sandbox dispatch returned an execution id different from the requested run'),
    {
      code: DISPATCH_EXECUTION_CHANGED_CODE,
      sessionId: 'session-1',
      requestedExecutionId: 'exec-requested',
      returnedExecutionId: 'exec-returned',
    },
  )

describe('a dispatch the provider contradicted', () => {
  it('classifies a bare contradiction terminal', () => {
    expect(classifyDriverFailure(changedError())).toBe('terminal')
  })

  it('classifies a retained admission pending terminal, naming the provider contract', () => {
    const pending = new RetainedExecutionPendingError(changedError(), 'admission')
    expect(pending.pendingCause).toBe('provider-contract')
    expect(classifyDriverFailure(pending)).toBe('terminal')
  })

  it('classifies the contradiction through cause chains', () => {
    const wrapped = new Error('dispatch phase failed', { cause: changedError() })
    expect(classifyDriverFailure(wrapped)).toBe('terminal')
  })

  it('still treats an ordinary dispatch failure as transient', () => {
    expect(classifyDriverFailure(new Error('sandbox dispatch failed: socket hang up'))).toBe(
      'transient',
    )
  })
})
