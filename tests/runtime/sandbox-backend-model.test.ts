import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { buildBackendOptions } from '../../src/runtime/sandbox-backend'

const profile = {
  name: 'exact-sandbox-worker',
  harness: 'opencode',
  model: {
    provider: 'zai-coding-plan',
    default: 'glm-5.2',
  },
} as const satisfies AgentProfile

describe('sandbox backend model truth', () => {
  it('sends the exact provider/model tuple instead of permitting an environmental default', () => {
    const options = buildBackendOptions(profile, undefined)

    expect(options.backend?.type).toBe('opencode')
    expect(options.backend?.profile).toBe(profile)
    expect(options.backend?.model).toMatchObject({
      provider: 'zai-coding-plan',
      model: 'glm-5.2',
    })
  })

  it('preserves compatible model transport settings while pinning the model identity', () => {
    const options = buildBackendOptions(profile, {
      backend: {
        type: 'opencode',
        model: {
          provider: 'zai-coding-plan',
          model: 'glm-5.2',
          baseUrl: 'https://router.example.test/v1',
        },
      },
    })

    expect(options.backend?.model).toEqual({
      provider: 'zai-coding-plan',
      model: 'glm-5.2',
      baseUrl: 'https://router.example.test/v1',
    })
  })

  it('refuses a conflicting provider override before creating a sandbox', () => {
    expect(() =>
      buildBackendOptions(profile, {
        backend: {
          type: 'opencode',
          model: { provider: 'openai-compat', model: 'glm-5.2' },
        },
      }),
    ).toThrow(/conflicts with AgentProfile provider/)
  })

  it('refuses a conflicting model override before creating a sandbox', () => {
    expect(() =>
      buildBackendOptions(profile, {
        backend: {
          type: 'opencode',
          model: {
            provider: 'zai-coding-plan',
            model: 'deepseek/deepseek-v4-flash',
          },
        },
      }),
    ).toThrow(/conflicts with AgentProfile model/)
  })
})
