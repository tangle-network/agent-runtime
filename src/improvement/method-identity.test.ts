import { makeProposalFinding, type ProposalFinding } from '@tangle-network/agent-eval'
import {
  inMemoryCampaignStorage,
  type JudgeConfig,
  type OptimizationMethod,
} from '@tangle-network/agent-eval/campaign'
import type { Scenario } from '@tangle-network/agent-eval/contract'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { canonicalCandidateDigest } from '../candidate-execution/digest'
import { improve } from './improve'
import { buildMethodEvaluationIdentity } from './method-identity'
import type { ReadonlyAgentProfile } from './profile-types'

interface IdentityScenario extends Scenario {
  kind: 'identity'
  privateInput?: string
}

interface IdentityArtifact {
  improved: boolean
}

const judge: JudgeConfig<IdentityArtifact, IdentityScenario> = {
  name: 'identity-quality',
  dimensions: [{ key: 'quality', description: 'whether the selected skill improved' }],
  judgeVersion: 'identity-quality/v1',
  score: ({ artifact }) => ({
    composite: artifact.improved ? 1 : 0,
    dimensions: { quality: artifact.improved ? 1 : 0 },
    notes: '',
  }),
}

const train: IdentityScenario[] = [{ id: 'train', kind: 'identity', privateInput: 'train-a' }]
const selection: IdentityScenario[] = [
  { id: 'selection', kind: 'identity', privateInput: 'selection-a' },
]
const finalScenarios: IdentityScenario[] = [
  { id: 'final-a', kind: 'identity' },
  { id: 'final-b', kind: 'identity' },
]
const executionRef = canonicalCandidateDigest({ callback: 'identity-fixture' })
const profileDigest = canonicalCandidateDigest({ profile: 'identity-fixture' })
const finding = (claim: string): ProposalFinding =>
  makeProposalFinding({
    analyst_id: 'test',
    proposal_origin: 'production',
    severity: 'medium',
    area: 'response',
    claim,
    confidence: 1,
    evidence_refs: [],
    produced_at: new Date(0).toISOString(),
  })

describe('method evaluation identity', () => {
  it('retains frozen redacted identities for every optimizer task partition', () => {
    const identity = buildMethodEvaluationIdentity<IdentityScenario, IdentityArtifact>({
      executionRef,
      baselineProfileDigest: profileDigest,
      baselineSurface: 'same bytes',
      surface: 'skills',
      skills: { resourceName: 'skill-a' },
      findings: [],
      trainScenarios: train,
      selectionScenarios: selection,
      testScenarios: finalScenarios,
      judges: [judge],
      reps: 2,
      optimizationRunOptions: { reps: 3 },
    })

    expect(identity.scenarioPartitions).toMatchObject({
      train: [{ id: 'train', kind: 'identity', scenarioDigest: expect.stringMatching(/^sha256:/) }],
      selection: [
        { id: 'selection', kind: 'identity', scenarioDigest: expect.stringMatching(/^sha256:/) },
      ],
      finalTest: [
        { id: 'final-a', kind: 'identity', scenarioDigest: expect.stringMatching(/^sha256:/) },
        { id: 'final-b', kind: 'identity', scenarioDigest: expect.stringMatching(/^sha256:/) },
      ],
      optimizationReps: 3,
      finalTestReps: 2,
    })
    expect(JSON.stringify(identity.scenarioPartitions)).not.toContain('train-a')
    expect(Object.isFrozen(identity.scenarioPartitions)).toBe(true)
    expect(Object.isFrozen(identity.scenarioPartitions.finalTest)).toBe(true)
  })

  it('changes for every behavior-bearing development coordinate', () => {
    const baseline = buildMethodEvaluationIdentity<IdentityScenario, IdentityArtifact>({
      executionRef,
      baselineProfileDigest: profileDigest,
      baselineSurface: 'same bytes',
      surface: 'skills',
      skills: { resourceName: 'skill-a' },
      findings: [finding('missing citation')],
      trainScenarios: train,
      selectionScenarios: selection,
      testScenarios: finalScenarios,
      judges: [judge],
      reps: 1,
      optimizationRunOptions: { reps: 1 },
    }).evaluationRef
    const evaluationRef = (overrides: {
      skills?: { resourceName: string }
      findings?: ReadonlyArray<ProposalFinding>
      trainScenarios?: IdentityScenario[]
      testScenarios?: IdentityScenario[]
      judges?: JudgeConfig<IdentityArtifact, IdentityScenario>[]
      validateCandidate?: () => void
      reps?: number
      optimizationRunOptions?: { reps?: number }
    }) =>
      buildMethodEvaluationIdentity<IdentityScenario, IdentityArtifact>({
        executionRef,
        baselineProfileDigest: profileDigest,
        baselineSurface: 'same bytes',
        surface: 'skills',
        skills: { resourceName: 'skill-a' },
        findings: [finding('missing citation')],
        trainScenarios: train,
        selectionScenarios: selection,
        testScenarios: finalScenarios,
        judges: [judge],
        reps: 1,
        optimizationRunOptions: { reps: 1 },
        ...overrides,
      }).evaluationRef

    expect(evaluationRef({ skills: { resourceName: 'skill-b' } })).not.toBe(baseline)
    expect(
      evaluationRef({
        trainScenarios: [{ ...train[0]!, privateInput: 'changed-hidden-input' }],
      }),
    ).not.toBe(baseline)
    expect(
      evaluationRef({
        testScenarios: [
          { ...finalScenarios[0]!, privateInput: 'changed-final-input' },
          finalScenarios[1]!,
        ],
      }),
    ).not.toBe(baseline)
    expect(
      evaluationRef({
        judges: [{ ...judge, judgeVersion: 'identity-quality/v2' }],
      }),
    ).not.toBe(baseline)
    expect(evaluationRef({ optimizationRunOptions: { reps: 2 } })).not.toBe(baseline)
    expect(evaluationRef({ reps: 2 })).not.toBe(baseline)
    expect(evaluationRef({ validateCandidate: () => undefined })).not.toBe(baseline)
    expect(evaluationRef({ findings: [finding('different failure')] })).not.toBe(baseline)
    expect(evaluationRef({})).toBe(baseline)
  })

  it('does not reuse measurements for two same-content skills', async () => {
    const profile: AgentProfile = {
      name: 'identity-agent',
      resources: {
        failOnError: true,
        skills: [
          { kind: 'inline', name: 'skill-a', content: 'same bytes' },
          { kind: 'inline', name: 'skill-b', content: 'same bytes' },
        ],
      },
    }
    const storage = inMemoryCampaignStorage()
    let agentCalls = 0
    const method: OptimizationMethod<IdentityScenario, IdentityArtifact> = {
      name: 'identity-fixed',
      async optimize() {
        return {
          winnerSurface: 'improved bytes',
          cost: { totalCostUsd: 0, accountingComplete: true, incompleteReasons: [] },
        }
      },
    }
    const options = {
      executionRef,
      method,
      trainScenarios: train,
      selectionScenarios: selection,
      testScenarios: finalScenarios,
      judges: [judge],
      agent: async (candidate: ReadonlyAgentProfile) => {
        agentCalls += 1
        return {
          improved:
            candidate.resources?.skills?.some(
              (skill) => skill.kind === 'inline' && skill.content === 'improved bytes',
            ) === true,
        }
      },
      runDir: 'mem://same-content-skills',
      storage,
      resamples: 40,
      confidence: 0.95,
      expectUsage: 'off' as const,
    }

    await improve(profile, {
      ...options,
      surface: 'skills',
      skills: { resourceName: 'skill-a' },
    })
    const afterFirst = agentCalls
    await improve(profile, {
      ...options,
      surface: 'skills',
      skills: { resourceName: 'skill-b' },
    })

    expect(afterFirst).toBeGreaterThan(0)
    expect(agentCalls).toBeGreaterThan(afterFirst)
  })
})
