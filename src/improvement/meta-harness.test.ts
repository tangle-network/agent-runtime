import type { Scenario } from '@tangle-network/agent-eval/contract'
import { type AgentProfile, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { ConfigError } from '../errors'
import { createProfileImprovementHarness } from './profile-improvement-harness'
import {
  PROMPT_INSTRUCTION_COMPONENT_PREFIX,
  promptInstructionsProfileComponents,
} from './prompt-instructions-profile-components'

interface FixtureScenario extends Scenario {
  kind: 'fixture'
}

const baselineProfile = (): AgentProfile => ({
  name: 'meta-harness-fixture',
  prompt: {
    systemPrompt: 'Keep this system prompt unchanged.',
    instructions: ['Inspect the evidence.', 'State uncertainty explicitly.'],
  },
  metadata: { owner: 'test' },
})

describe('promptInstructionsProfileComponents', () => {
  it('maps ordered instructions to stable labels and changes no unrelated profile field', () => {
    const profile = baselineProfile()
    const components = promptInstructionsProfileComponents.read(profile)

    expect(components).toEqual({
      [`${PROMPT_INSTRUCTION_COMPONENT_PREFIX}000000`]: 'Inspect the evidence.',
      [`${PROMPT_INSTRUCTION_COMPONENT_PREFIX}000001`]: 'State uncertainty explicitly.',
    })

    const candidate = promptInstructionsProfileComponents.apply(profile, {
      [`${PROMPT_INSTRUCTION_COMPONENT_PREFIX}000000`]: 'Inspect every cited artifact.',
      [`${PROMPT_INSTRUCTION_COMPONENT_PREFIX}000001`]: 'Report calibrated uncertainty.',
    })

    expect(candidate.prompt).toEqual({
      systemPrompt: 'Keep this system prompt unchanged.',
      instructions: ['Inspect every cited artifact.', 'Report calibrated uncertainty.'],
    })
    expect(candidate.metadata).toEqual({ owner: 'test' })
    expect(profile.prompt?.instructions).toEqual([
      'Inspect the evidence.',
      'State uncertainty explicitly.',
    ])
  })

  it('refuses missing instructions and component-key drift', () => {
    expect(() => promptInstructionsProfileComponents.read({ name: 'empty-instructions' })).toThrow(
      /must contain at least one instruction/,
    )

    expect(() =>
      promptInstructionsProfileComponents.apply(baselineProfile(), {
        [`${PROMPT_INSTRUCTION_COMPONENT_PREFIX}000001`]: 'wrong first key',
      }),
    ).toThrow(/expected component/)
  })
})

describe('createProfileImprovementHarness', () => {
  it('binds an immutable baseline and canonical identity once', () => {
    const source = baselineProfile()
    const executionRef = canonicalCandidateDigest({ fixture: 'bound-executor-v1' })
    const harness = createProfileImprovementHarness<FixtureScenario, string>({
      profile: source,
      executionRef,
      agent: async () => 'unused',
    })

    source.prompt!.instructions![0] = 'mutated after construction'

    expect(harness.executionRef).toBe(executionRef)
    expect(harness.profile.prompt?.instructions?.[0]).toBe('Inspect the evidence.')
    expect(harness.profileDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(Object.isFrozen(harness)).toBe(true)
    expect(Object.isFrozen(harness.profile)).toBe(true)
  })

  it('fails before a run for invalid profile or execution identity', () => {
    expect(() =>
      createProfileImprovementHarness<FixtureScenario, string>({
        profile: null as never,
        executionRef: canonicalCandidateDigest({ fixture: 'valid' }),
        agent: async () => 'unused',
      }),
    ).toBeInstanceOf(ConfigError)

    expect(() =>
      createProfileImprovementHarness<FixtureScenario, string>({
        profile: baselineProfile(),
        executionRef: 'not-a-digest' as never,
        agent: async () => 'unused',
      }),
    ).toBeInstanceOf(ConfigError)
  })
})
