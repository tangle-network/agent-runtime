import { subscriptionUsageLimitSignal } from '@tangle-network/agent-runtime/kernel'
import { describe, expect, it } from 'vitest'

describe('subscriptionUsageLimitSignal', () => {
  it('moves past the Z.ai Coding Plan refusal observed from OpenCode', () => {
    expect(
      subscriptionUsageLimitSignal({
        error:
          'AI_APICallError: Usage limit reached for 5 hour. Your limit will reset at 2026-07-28 19:48:24',
      }),
    ).toBe('subscription-usage-limit')
  })

  it('does not treat a bare rate limit or an unrelated API error as a plan limit', () => {
    expect(subscriptionUsageLimitSignal({ error: '429 Too Many Requests' })).toBeUndefined()
    expect(subscriptionUsageLimitSignal({ error: 'AI_APICallError: Bad Request' })).toBeUndefined()
  })
})
