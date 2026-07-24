import {
  inMemoryCampaignStorage,
  type OptimizationMethod,
} from '@tangle-network/agent-eval/campaign'
import type { JudgeConfig, Scenario } from '@tangle-network/agent-eval/contract'
import { type AgentProfile, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import type { StructuralRolloutPolicy } from '../runtime/structural-rollout'
import { improve } from './improve'
import {
  applyRolloutPolicyToProfile,
  normalizeRolloutPolicy,
  parseRolloutPolicy,
  ROLLOUT_POLICY_EXTENSION,
  serializeRolloutPolicy,
  structuralRolloutPolicyFromProfile,
} from './rollout-policy'

describe('rollout policy profile coordinate', () => {
  it('serializes, parses, and applies an exact policy without mutating the profile', () => {
    const policy: StructuralRolloutPolicy = {
      k: 3,
      repairRounds: 1,
      testgen: 0,
      diverse: false,
      temperature: 0.2,
    }
    const profile: AgentProfile = { name: 'fixture' }
    const serialized = serializeRolloutPolicy(policy)
    const next = applyRolloutPolicyToProfile(profile, parseRolloutPolicy(serialized)!)

    expect(structuralRolloutPolicyFromProfile(next)).toEqual(policy)
    expect(profile.extensions).toBeUndefined()
  })

  it('fills omitted dials and rejects corrupt policy values', () => {
    const profile: AgentProfile = {
      extensions: { [ROLLOUT_POLICY_EXTENSION]: { k: 1 } },
    }
    expect(structuralRolloutPolicyFromProfile(profile)).toEqual({
      k: 1,
      repairRounds: 2,
      testgen: 6,
    })

    for (const bad of [{ k: 0 }, { k: 1.5 }, { repairRounds: -1 }, { testgen: 'six' }]) {
      expect(
        structuralRolloutPolicyFromProfile({
          extensions: { [ROLLOUT_POLICY_EXTENSION]: bad as never },
        }),
      ).toBeUndefined()
    }
    expect(normalizeRolloutPolicy(null)).toBeUndefined()
    expect(normalizeRolloutPolicy([1, 2])).toBeUndefined()
  })
})

interface PolicyScenario extends Scenario {
  kind: 'fixture'
}

interface PolicyArtifact {
  policy?: StructuralRolloutPolicy
}

const train: PolicyScenario[] = [{ id: 'train', kind: 'fixture' }]
const selection: PolicyScenario[] = [{ id: 'selection', kind: 'fixture' }]
const testCases: PolicyScenario[] = [
  { id: 'test-a', kind: 'fixture' },
  { id: 'test-b', kind: 'fixture' },
]
const executionRef = canonicalCandidateDigest({ fixture: 'rollout-policy-method' })

const judge: JudgeConfig<PolicyArtifact, PolicyScenario> = {
  name: 'k',
  dimensions: [{ key: 'quality', description: 'selection breadth' }],
  score: ({ artifact }) => {
    const quality = (artifact.policy?.k ?? 0) / 10
    return { dimensions: { quality }, composite: quality, notes: '' }
  },
}

function policyMethod(
  policy: StructuralRolloutPolicy,
): OptimizationMethod<PolicyScenario, PolicyArtifact> {
  return {
    name: 'external-policy-search',
    async optimize() {
      return {
        winnerSurface: serializeRolloutPolicy(policy),
        cost: { totalCostUsd: 0, accountingComplete: true, incompleteReasons: [] },
      }
    },
  }
}

describe("improve surface 'rollout-policy'", () => {
  it('applies a complete method result to profile.extensions', async () => {
    const profile: AgentProfile = {
      name: 'fixture-agent',
      extensions: {
        [ROLLOUT_POLICY_EXTENSION]: { k: 5, repairRounds: 2, testgen: 6 },
      },
    }
    const result = await improve(profile, {
      surface: 'rollout-policy',
      executionRef,
      method: policyMethod({ k: 7, repairRounds: 2, testgen: 6 }),
      trainScenarios: train,
      selectionScenarios: selection,
      testScenarios: testCases,
      judges: [judge],
      agent: async (candidate) => ({ policy: structuralRolloutPolicyFromProfile(candidate) }),
      runDir: 'mem://rollout-policy-method',
      storage: inMemoryCampaignStorage(),
      resamples: 40,
      confidence: 0.95,
      expectUsage: 'off',
    })

    expect(result.decision).toBe('ship')
    expect(result.lift).toBeCloseTo(0.2, 5)
    expect(structuralRolloutPolicyFromProfile(result.candidate.profile!)).toEqual({
      k: 7,
      repairRounds: 2,
      testgen: 6,
    })
    expect(structuralRolloutPolicyFromProfile(profile)).toEqual({
      k: 5,
      repairRounds: 2,
      testgen: 6,
    })
  })

  it('rejects optimization when the profile has no active rollout policy', async () => {
    await expect(
      improve(
        { name: 'fixture-agent' },
        {
          surface: 'rollout-policy',
          executionRef,
          method: policyMethod({ k: 7, repairRounds: 2, testgen: 6 }),
          trainScenarios: train,
          selectionScenarios: selection,
          testScenarios: testCases,
          judges: [judge],
          agent: async (candidate) => ({ policy: structuralRolloutPolicyFromProfile(candidate) }),
          runDir: 'mem://rollout-policy-missing',
          storage: inMemoryCampaignStorage(),
          resamples: 40,
          confidence: 0.95,
          expectUsage: 'off',
        },
      ),
    ).rejects.toThrow(/requires an existing structural rollout policy/)
  })
})
