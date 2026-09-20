import { describe, expect, it } from 'vitest'
import { executorFailure, executorFailureInfra } from './executor-outcome'

describe('executorFailureInfra: the envelope path stops stamping `infra: false`', () => {
  it.each([
    // The platform's lifecycle messages, each measured on the 2026-09-20 fleet corpus.
    ['terminated', undefined],
    ['Execution exceeded its time limit', undefined],
    [
      'Execution interrupted: the agent runtime restarted before the run produced a terminal result',
      undefined,
    ],
    [
      'opencode execution failed: Platform key-verification temporarily unavailable. Retry shortly.',
      undefined,
    ],
    ['opencode execution failed: Bad Gateway: bad gateway (exit code 1)', undefined],
    [
      'opencode execution failed: Cannot connect to API: Unable to connect. Is the computer able to access the url?',
      undefined,
    ],
    ['Failed to connect to Sandbox API: fetch failed', undefined],
    ['A sandbox lifecycle operation is already in progress', undefined],
    ['Tangle Sandbox event data exceeded its string bound', undefined],
    ['value exceeds its JSON bound', undefined],
    [
      'opencode execution failed: No provider served model "kimi-k2" (provider_quota_exceeded)',
      undefined,
    ],
    ['opencode execution failed: Invalid API key (exit code 1)', undefined],
    [
      'seat zai-3 is at its box cap (4 live). Raise maxBoxes in config/seats.json, or add a seat',
      undefined,
    ],
    [
      'seat zai-2: could not materialize the seat credential in box sandbox-abc (exit 1)',
      undefined,
    ],
    [
      'opencode execution failed: OpenCode exited while a model step was still in progress',
      undefined,
    ],
    // The platform's machine codes, whatever the prose says.
    ['the Sandbox interactive status failed', 'QUOTA_EXCEEDED'],
    ['Agent execution failed', 'buffer.overflow'],
    ['socket hang up', 'ECONNRESET'],
    ['Agent execution failed', 'timeout'],
  ])('answers true for the platform vocabulary: %s / %s', (error, errorCode) => {
    expect(executorFailureInfra({ error, ...(errorCode ? { errorCode } : {}) })).toBe(true)
  })

  it.each([
    'opencode execution failed: OpenCode exited after 1 failed tool call. The result was not accepted.',
    'claude-code execution failed: Process exited with code 1',
    'codex execution failed: This content was flagged for review',
    'Unable to materialize 1 profile resource(s): - tools: opencode: no verified native binary',
    'Message exceeds maximum length of 200000 characters (got 214511)',
    'Agent execution failed',
  ])('answers undefined, never false, when the envelope cannot attribute: %s', (error) => {
    expect(executorFailureInfra({ error })).toBeUndefined()
    expect(executorFailureInfra({ error, errorCode: 'RESULT_FAILURE' })).toBeUndefined()
  })

  it('reads the envelope the same way the settlement reason does', () => {
    const failure = executorFailure({
      outcome: { success: false, error: 'terminated', errorCode: 'QUOTA_EXCEEDED' },
    })
    expect(failure).toEqual({ error: 'terminated', errorCode: 'QUOTA_EXCEEDED' })
    expect(executorFailureInfra(failure!)).toBe(true)
    expect(executorFailure({ outcome: { success: true } })).toBeUndefined()
  })
})
