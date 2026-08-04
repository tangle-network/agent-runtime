import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { profileModelExecutionSettings } from './supervise/model-policy'

const profileWithRetry = (retry: unknown): Pick<AgentProfile, 'model'> => ({
  model: {
    provider: 'tangle-router',
    default: 'test-model',
    metadata: { retry },
  },
})

describe('AgentProfile.model.metadata.retry', () => {
  it('leaves request duration unlimited unless the caller sets a deadline', () => {
    const settings = profileModelExecutionSettings(profileWithRetry({}), 'default retry profile')

    expect(settings.retry?.requestTimeoutMs).toBe(0)
  })

  it('resolves every caller control into one immutable current policy', () => {
    const settings = profileModelExecutionSettings(
      profileWithRetry({
        maxAttempts: 3,
        initialBackoffMs: 40,
        maxBackoffMs: 90,
        jitter: 0.2,
        retryStatuses: [409, 429],
        requestTimeoutMs: 250,
      }),
      'retry profile test',
    )

    expect(settings.retry).toEqual({
      maxAttempts: 3,
      initialBackoffMs: 40,
      maxBackoffMs: 90,
      jitter: 0.2,
      retryStatuses: [409, 429],
      requestTimeoutMs: 250,
    })
    expect(Object.isFrozen(settings.retry)).toBe(true)
    expect(Object.isFrozen(settings.retry?.retryStatuses)).toBe(true)
  })

  it.each([
    ['a non-object policy', 'bad', /retry.*must be an object/u],
    ['an unknown field', { legacyRetries: 2 }, /unsupported fields: legacyRetries/u],
    ['a zero attempt total', { maxAttempts: 0 }, /maxAttempts.*positive safe integer/u],
    ['a negative initial delay', { initialBackoffMs: -1 }, /initialBackoffMs.*nonnegative/u],
    ['an oversized backoff cap', { maxBackoffMs: 2_147_483_648 }, /maxBackoffMs.*2147483647/u],
    ['jitter above one', { jitter: 1.1 }, /jitter.*0 through 1/u],
    ['a non-status value', { retryStatuses: [99] }, /retryStatuses.*100 through 599/u],
    ['duplicate statuses', { retryStatuses: [429, 429] }, /must not contain duplicates/u],
    ['a negative request deadline', { requestTimeoutMs: -1 }, /requestTimeoutMs.*nonnegative/u],
  ])('fails before execution for %s', (_label, retry, message) => {
    expect(() =>
      profileModelExecutionSettings(profileWithRetry(retry), 'invalid retry profile'),
    ).toThrow(message)
  })

  it('rejects the removed maxRetries alias instead of silently changing its meaning', () => {
    expect(() =>
      profileModelExecutionSettings(
        {
          model: {
            provider: 'tangle-router',
            default: 'test-model',
            metadata: { maxRetries: 2 },
          },
        },
        'legacy retry profile',
      ),
    ).toThrow(/unsupported AgentProfile\.model\.metadata fields: maxRetries/u)
  })
})
