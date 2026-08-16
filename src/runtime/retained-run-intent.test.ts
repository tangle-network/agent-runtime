import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import type { CreateAgentEnvironmentInput } from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import { retainedCreateMaterial } from './retained-run-intent'

function digestForSecrets(secrets: NonNullable<CreateAgentEnvironmentInput['secrets']>): string {
  return canonicalCandidateDigest(
    retainedCreateMaterial({
      profile: { name: 'worker' },
      secrets,
    }),
  )
}

describe('retained create admission material', () => {
  it('binds secret names without exposing or hashing secret values', () => {
    const firstSecret = 'guessable-a'
    const secondSecret = 'guessable-b'
    const first = retainedCreateMaterial({
      profile: { name: 'worker' },
      secrets: { API_TOKEN: firstSecret },
    })
    const second = retainedCreateMaterial({
      profile: { name: 'worker' },
      secrets: { API_TOKEN: secondSecret },
    })

    expect(first).toMatchObject({ secretNames: ['API_TOKEN'] })
    expect(second).toEqual(first)
    expect(digestForSecrets({ API_TOKEN: firstSecret })).toBe(
      digestForSecrets({ API_TOKEN: secondSecret }),
    )
    expect(JSON.stringify(first)).not.toContain(firstSecret)
    expect(JSON.stringify(first)).not.toContain(secondSecret)
  })

  it('changes the public admission digest when secret names change', () => {
    expect(digestForSecrets({ API_TOKEN: 'guessable-a' })).not.toBe(
      digestForSecrets({ OTHER_TOKEN: 'guessable-a' }),
    )
  })
})
