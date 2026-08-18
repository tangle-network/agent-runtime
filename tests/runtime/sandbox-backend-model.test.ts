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
  it('sends the exact profile model instead of permitting an environmental default', () => {
    const options = buildBackendOptions(profile, undefined)

    expect(options.backend?.type).toBe('opencode')
    expect(options.backend?.profile).toBe(profile)
    expect(options.backend?.model?.model).toBe('zai-coding-plan/glm-5.2')
  })

  it('preserves compatible model transport settings while pinning the model identity', () => {
    const options = buildBackendOptions(profile, {
      backend: {
        type: 'opencode',
        model: {
          model: 'zai-coding-plan/glm-5.2',
          baseUrl: 'https://router.example.test/v1',
        },
      },
    })

    expect(options.backend?.model).toEqual({
      model: 'zai-coding-plan/glm-5.2',
      baseUrl: 'https://router.example.test/v1',
    })
  })

  it('refuses a conflicting override before creating a sandbox', () => {
    expect(() =>
      buildBackendOptions(profile, {
        backend: {
          type: 'opencode',
          model: { model: 'openai-compat/deepseek/deepseek-v4-flash' },
        },
      }),
    ).toThrow(/conflicts with AgentProfile model/)
  })
})
