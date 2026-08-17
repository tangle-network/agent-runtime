import {
  inMemoryCampaignStorage,
  type OptimizationMethod,
} from '@tangle-network/agent-eval/campaign'
import type {
  DispatchContext,
  JudgeConfig,
  MutableSurface,
  Scenario,
} from '@tangle-network/agent-eval/contract'
import { type AgentProfile, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { ConfigError } from '../errors'
import { createProfileImprovementHarness } from './profile-improvement-harness'
import type { ReadonlyAgentProfile } from './profile-types'
import {
  PROMPT_INSTRUCTION_COMPONENT_PREFIX,
  promptInstructionsProfileComponents,
} from './prompt-instructions-profile-components'

interface FixtureScenario extends Scenario {
  kind: 'fixture'
}

interface FixtureArtifact {
  text: string
}

const trainScenarios: FixtureScenario[] = [{ id: 'train', kind: 'fixture' }]
const selectionScenarios: FixtureScenario[] = [{ id: 'selection', kind: 'fixture' }]
const testScenarios: FixtureScenario[] = [
  { id: 'test-a', kind: 'fixture' },
  { id: 'test-b', kind: 'fixture' },
]
let runSequence = 0

const improvementJudge: JudgeConfig<FixtureArtifact, FixtureScenario> = {
  name: 'meta-harness-improvement',
  dimensions: [{ key: 'quality', description: 'candidate contains the improvement marker' }],
  score: ({ artifact }) => {
    const quality = artifact.text.includes('improved') ? 1 : 0
    return { dimensions: { quality }, composite: quality, notes: '' }
  },
}

const baselineProfile = (): AgentProfile => ({
  name: 'meta-harness-fixture',
  prompt: {
    systemPrompt: 'Keep this system prompt unchanged.',
    instructions: ['Inspect the evidence.', 'State uncertainty explicitly.'],
  },
  metadata: { owner: 'test' },
})

async function paidProfile(
  profile: ReadonlyAgentProfile,
  _scenario: FixtureScenario,
  context: DispatchContext,
): Promise<FixtureArtifact> {
  const paid = await context.cost.runPaidCall({
    channel: 'agent',
    actor: 'meta-harness-test-agent',
    model: 'deterministic-meta-harness@2026-08-16',
    maximumCharge: { externallyEnforcedMaximumUsd: 0.0001 },
    execute: async () => ({ text: profile.prompt?.systemPrompt ?? '' }),
    receipt: () => ({
      model: 'deterministic-meta-harness@2026-08-16',
      inputTokens: 1,
      outputTokens: 1,
      actualCostUsd: 0.0001,
    }),
  })
  if (!paid.succeeded) throw paid.error
  return paid.value
}

function fixedMethod(
  winnerSurface: MutableSurface,
): OptimizationMethod<FixtureScenario, FixtureArtifact> {
  return {
    name: 'meta-harness-fixed-method',
    async optimize() {
      return {
        winnerSurface,
        cost: {
          totalCostUsd: 0,
          costProvenance: { kind: 'observed', usd: 0 },
          accountingComplete: true,
          incompleteReasons: [],
        },
        durationMs: 1,
      }
    },
  }
}

function runOptions() {
  runSequence += 1
  return {
    method: fixedMethod('improved prompt'),
    surface: 'prompt' as const,
    trainScenarios,
    selectionScenarios,
    testScenarios,
    judges: [improvementJudge],
    runDir: `mem://meta-harness-${runSequence}`,
    storage: inMemoryCampaignStorage(),
    resamples: 40,
    confidence: 0.95,
  }
}

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

  it('runs the exact bound profile, executor, and run-level validator', async () => {
    const executionRef = canonicalCandidateDigest({ fixture: 'bound-executor-v2' })
    const rogueExecutionRef = canonicalCandidateDigest({ fixture: 'rogue-executor' })
    const observedProfiles: ReadonlyAgentProfile[] = []
    let boundAgentCalls = 0
    let rogueAgentCalls = 0
    let defaultValidatorCalls = 0
    let overrideValidatorCalls = 0
    const harness = createProfileImprovementHarness<FixtureScenario, FixtureArtifact>({
      profile: baselineProfile(),
      executionRef,
      agent: async (profile, scenario, context) => {
        boundAgentCalls += 1
        observedProfiles.push(profile)
        return paidProfile(profile, scenario, context)
      },
      validateCandidate: () => {
        defaultValidatorCalls += 1
      },
    })

    const result = await harness.run({
      ...runOptions(),
      executionRef: rogueExecutionRef,
      agent: async () => {
        rogueAgentCalls += 1
        return { text: 'rogue agent' }
      },
      validateCandidate: () => {
        overrideValidatorCalls += 1
      },
    } as never)

    expect(boundAgentCalls).toBeGreaterThan(0)
    expect(rogueAgentCalls).toBe(0)
    expect(defaultValidatorCalls).toBe(0)
    expect(overrideValidatorCalls).toBeGreaterThan(0)
    expect(result.lineage.executionRef).toBe(executionRef)
    expect(result.lineage.baselineProfileDigest).toBe(harness.profileDigest)
    expect(result.candidate.profile?.prompt?.systemPrompt).toBe('improved prompt')
    expect(
      observedProfiles.some(
        (profile) => profile.prompt?.systemPrompt === 'Keep this system prompt unchanged.',
      ),
    ).toBe(true)
    expect(
      observedProfiles.some((profile) => profile.prompt?.systemPrompt === 'improved prompt'),
    ).toBe(true)
  })

  it('uses the harness validator when a run does not override it', async () => {
    let defaultValidatorCalls = 0
    const harness = createProfileImprovementHarness<FixtureScenario, FixtureArtifact>({
      profile: baselineProfile(),
      executionRef: canonicalCandidateDigest({ fixture: 'bound-executor-v3' }),
      agent: paidProfile,
      validateCandidate: () => {
        defaultValidatorCalls += 1
      },
    })

    await harness.run(runOptions())

    expect(defaultValidatorCalls).toBeGreaterThan(0)
  })

  it('fails before a run for invalid profile, execution identity, agent, or validator', () => {
    expect(() =>
      createProfileImprovementHarness<FixtureScenario, string>({
        profile: null as never,
        executionRef: canonicalCandidateDigest({ fixture: 'valid' }),
        agent: async () => 'unused',
      }),
    ).toThrow(ConfigError)

    expect(() =>
      createProfileImprovementHarness<FixtureScenario, string>({
        profile: baselineProfile(),
        executionRef: 'not-a-digest' as never,
        agent: async () => 'unused',
      }),
    ).toThrow(ConfigError)

    expect(() =>
      createProfileImprovementHarness<FixtureScenario, string>({
        profile: baselineProfile(),
        executionRef: canonicalCandidateDigest({ fixture: 'valid-agent-check' }),
        agent: null as never,
      }),
    ).toThrow(ConfigError)

    expect(() =>
      createProfileImprovementHarness<FixtureScenario, string>({
        profile: baselineProfile(),
        executionRef: canonicalCandidateDigest({ fixture: 'valid-validator-check' }),
        agent: async () => 'unused',
        validateCandidate: null as never,
      }),
    ).toThrow(ConfigError)

    const harness = createProfileImprovementHarness<FixtureScenario, string>({
      profile: baselineProfile(),
      executionRef: canonicalCandidateDigest({ fixture: 'valid-run-validator-check' }),
      agent: async () => 'unused',
    })
    expect(() => harness.run({ validateCandidate: null } as never)).toThrow(ConfigError)
  })
})
