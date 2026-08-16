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

  it('keeps opaque environment values out of the public material', () => {
    const first = retainedCreateMaterial({
      profile: { name: 'worker' },
      env: { PUBLIC_OR_SECRET: 'guessable-a' },
      secrets: { API_TOKEN: 'guessable-a' },
      metadata: { note: 'guessable-a' },
      providerOptions: { credential: 'guessable-a' },
      workspace: {
        repoUrl: 'https://example.com/repo.git',
        providerOptions: { credential: 'guessable-a' },
      },
      resources: { cpu: 2, providerOptions: { credential: 'guessable-a' } },
    })
    const second = retainedCreateMaterial({
      profile: { name: 'worker' },
      env: { PUBLIC_OR_SECRET: 'guessable-b' },
      secrets: { API_TOKEN: 'guessable-b' },
      metadata: { note: 'guessable-b' },
      providerOptions: { credential: 'guessable-b' },
      workspace: {
        repoUrl: 'https://example.com/repo.git',
        providerOptions: { credential: 'guessable-b' },
      },
      resources: { cpu: 2, providerOptions: { credential: 'guessable-b' } },
    })

    expect(second).toEqual(first)
    expect(canonicalCandidateDigest(second)).toBe(canonicalCandidateDigest(first))
    expect(JSON.stringify(first)).not.toContain('guessable-a')
    expect(JSON.stringify(first)).not.toContain('guessable-b')
    expect(first).toMatchObject({
      environmentVariableNames: ['PUBLIC_OR_SECRET'],
      metadataKeys: ['note'],
      providerOptionNames: ['credential'],
    })
  })

  it('changes the public admission digest when secret names change', () => {
    expect(digestForSecrets({ API_TOKEN: 'guessable-a' })).not.toBe(
      digestForSecrets({ OTHER_TOKEN: 'guessable-a' }),
    )
  })
})
