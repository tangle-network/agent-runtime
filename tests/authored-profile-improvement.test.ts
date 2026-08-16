import { minimumPairsForPairedDeltaTest, type ProposalFinding } from '@tangle-network/agent-eval'
import type { CampaignScenarioIdentity } from '@tangle-network/agent-eval/campaign'
import {
  AGENT_IMPROVEMENT_SOURCE_METADATA_KEY,
  type AgentProfile,
} from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'

import { canonicalCandidateDigest } from '../src/candidate-execution/digest'
import {
  type ProposeAuthoredAgentProfileImprovementOptions,
  proposeAuthoredAgentProfileImprovement,
} from '../src/intelligence/authored-profile-improvement'
import { optimizationActivationReceiptFromMetadata } from '../src/intelligence/optimization-receipt'
import { improvementFinding as fixtureFinding } from './helpers/improvement-method-fixture'
import {
  createProfileImprovementFixture,
  createProfileImprovementRunReceipt,
} from './helpers/profile-improvement-fixture'

const minimumPairedRuns = minimumPairsForPairedDeltaTest(0.95)
const { proposal_origin: _fixtureOrigin, ...fixtureAnalystFinding } =
  fixtureFinding as ProposalFinding
const productionFinding: ProposalFinding = {
  ...fixtureAnalystFinding,
  proposal_origin: 'production',
  evidence_refs: [{ kind: 'span', uri: 'span-authored-profile' }],
}

function setup() {
  const template = createProfileImprovementFixture()
  const task = template.evaluation.experiment.benchmark.tasks[0]
  if (!task) throw new Error('expected a profile improvement task')
  const { digest: _taskDigest, ...taskMaterial } = task
  const identity = 'tenant/research/profile'
  const baselineProfile: AgentProfile = {
    name: 'researcher',
    prompt: { systemPrompt: 'Investigate the question.' },
    model: { default: 'provider/old-model' },
    metadata: { lineage: 'baseline' },
  }
  const candidateProfile: AgentProfile = {
    ...baselineProfile,
    prompt: { systemPrompt: 'Investigate, verify, and cite the earliest causal failure.' },
    model: { default: 'provider/new-model', reasoningEffort: 'high' },
    harness: 'codex',
    tools: { Read: true, Bash: true },
    mcp: { literature: { command: 'literature-server' } },
    hooks: { Stop: [{ command: 'node verify-result.mjs', blocking: true }] },
    metadata: { lineage: 'human-reflection', reflectionRun: 'reflection-1' },
  }
  const stateDigest = ({
    identity: profileIdentity,
    profile,
  }: {
    identity: string
    profile: AgentProfile
  }) => canonicalCandidateDigest({ identity: profileIdentity, profile })
  const baselineStateDigest = stateDigest({ identity, profile: baselineProfile })
  const heldOutScenario: CampaignScenarioIdentity = {
    id: task.scenario.id,
    kind: task.scenario.kind,
    scenarioDigest: task.scenario.digest,
  }
  const observed: Array<{ arm: 'baseline' | 'candidate'; profile: AgentProfile }> = []
  const options: ProposeAuthoredAgentProfileImprovementOptions = {
    runId: 'authored-profile-run-1',
    budgetUsd: minimumPairedRuns * 2,
    source: {
      kind: 'platform-agent-profile',
      sourceIdentity: identity,
      sourceDigest: baselineStateDigest,
      sourceRevision: 1,
    },
    profile: baselineProfile,
    candidateProfile,
    candidateLineage: {
      source: 'human',
      parentDigests: [baselineStateDigest],
      runIds: ['reflection-1'],
      modelSnapshots: ['provider/new-model'],
    },
    diff: {
      id: 'human-reflection-1',
      source: {
        kind: 'frontier-author',
        artifacts: ['traces://reflection-1'],
        notes: ['A human approved the profile authored from a trace autopsy.'],
      },
    },
    findings: [productionFinding],
    stateDigest,
    benchmark: {
      tasks: [taskMaterial],
      reps: minimumPairedRuns,
      seeds: Array.from({ length: minimumPairedRuns }, (_, index) => 101 + index) as [
        number,
        ...number[],
      ],
      policy: template.evaluation.experiment.policy,
    },
    executor: {
      executionRef: {
        kind: 'agent-profile-improvement-execution-ref',
        identity: 'authored-profile-runner',
        digest: canonicalCandidateDigest({ runner: 'authored-profile-runner', revision: 1 }),
      },
      measure: async (input) => {
        observed.push({ arm: input.arm, profile: input.profile })
        const variation = ((input.runCell.repetition % 3) - 1) * 0.02
        return createProfileImprovementRunReceipt(
          input,
          input.arm === 'baseline' ? 0.2 : 0.8 + variation,
        )
      },
    },
    candidate: {
      label: 'human trace reflection',
      rationale: 'A complete profile authored from a cited trace autopsy.',
    },
    now: () => new Date('2026-08-16T20:00:00.000Z'),
  }
  return {
    options,
    observed,
    baselineProfile,
    candidateProfile,
    baselineStateDigest,
    heldOutScenario,
  }
}

describe('authored profile improvement', { timeout: 30_000 }, () => {
  it('measures a human-authored complete profile through the canonical proposal path', async () => {
    const fixture = setup()
    const inputLineage = structuredClone(fixture.options.candidateLineage)

    const result = await proposeAuthoredAgentProfileImprovement(fixture.options)

    expect(fixture.observed).toHaveLength(minimumPairedRuns * 2)
    expect(
      fixture.observed
        .filter((entry) => entry.arm === 'baseline')
        .every((entry) => entry.profile === fixture.baselineProfile),
    ).toBe(false)
    expect(
      fixture.observed
        .filter((entry) => entry.arm === 'baseline')
        .every(
          (entry) =>
            entry.profile.prompt?.systemPrompt === fixture.baselineProfile.prompt?.systemPrompt,
        ),
    ).toBe(true)
    expect(
      fixture.observed
        .filter((entry) => entry.arm === 'candidate')
        .every(
          (entry) =>
            entry.profile.prompt?.systemPrompt === fixture.candidateProfile.prompt?.systemPrompt,
        ),
    ).toBe(true)
    expect(result.candidateLineage).toMatchObject({
      source: 'human',
      parentDigests: [fixture.baselineStateDigest],
      runIds: ['reflection-1'],
    })
    expect(result.candidateLineage.profileDiffIds).toEqual([
      'human-reflection-1:agent-profile:reset',
      'human-reflection-1:agent-profile:set',
    ])
    expect(result.experiment.change.map((step) => step.id)).toEqual(
      result.candidateLineage.profileDiffIds,
    )
    expect(
      result.experiment.change.every(
        (step) =>
          step.source?.kind === 'frontier-author' &&
          step.metadata?.sourceIdentity === fixture.options.source.sourceIdentity &&
          step.metadata?.sourceRevision === fixture.options.source.sourceRevision,
      ),
    ).toBe(true)
    expect(fixture.options.candidateLineage).toEqual(inputLineage)
    expect(Object.hasOwn(fixture.options.candidateLineage, 'profileDiffIds')).toBe(false)
    expect(result.experiment.candidateLineage).toEqual(result.candidateLineage)
    expect(result.proposal.evaluation.decision.outcome).toBe('ship')
    expect(result.proposal.changedSurfaces).toEqual([
      'prompt',
      'tools',
      'mcp',
      'hooks',
      'agent-profile',
    ])
    expect(result.proposal.findings).toEqual([productionFinding])
    expect(result.proposal.evaluation.generationsExplored).toBeUndefined()
    expect(optimizationActivationReceiptFromMetadata(result.proposal.evaluation.metadata)).toBe(
      undefined,
    )
  })

  it('preserves import lineage without fabricating optimizer evidence', async () => {
    const fixture = setup()
    fixture.options.candidateLineage = {
      source: 'import',
      parentDigests: [fixture.baselineStateDigest],
      runIds: ['external-profile-build-1'],
    }

    const result = await proposeAuthoredAgentProfileImprovement(fixture.options)

    expect(result.candidateLineage.source).toBe('import')
    expect(optimizationActivationReceiptFromMetadata(result.proposal.evaluation.metadata)).toBe(
      undefined,
    )
  })

  it('refuses optimizer lineage and caller-supplied profile diff identities', async () => {
    const optimizer = setup()
    optimizer.options.candidateLineage = {
      source: 'optimizer',
      parentDigests: [optimizer.baselineStateDigest],
      runIds: ['optimizer-run'],
      developmentSplitDigest: canonicalCandidateDigest({ split: 'development' }),
    } as never
    await expect(proposeAuthoredAgentProfileImprovement(optimizer.options)).rejects.toThrow(
      /refuses optimizer lineage/,
    )

    const suppliedIds = setup()
    suppliedIds.options.candidateLineage = {
      source: 'human',
      profileDiffIds: ['caller-controlled-id'],
    } as never
    await expect(proposeAuthoredAgentProfileImprovement(suppliedIds.options)).rejects.toThrow(
      /derives candidateLineage\.profileDiffIds/,
    )
  })

  it('refuses forged metadata and invalid or mismatched budgets before execution', async () => {
    const forgedMetadata = setup()
    forgedMetadata.options.metadata = {
      [AGENT_IMPROVEMENT_SOURCE_METADATA_KEY]: 'caller-controlled-source',
    }
    await expect(proposeAuthoredAgentProfileImprovement(forgedMetadata.options)).rejects.toThrow(
      /reserves/,
    )
    expect(forgedMetadata.observed).toHaveLength(0)

    const invalidBudget = setup()
    invalidBudget.options.budgetUsd = Number.NaN
    await expect(proposeAuthoredAgentProfileImprovement(invalidBudget.options)).rejects.toThrow(
      /non-negative finite number/,
    )
    expect(invalidBudget.observed).toHaveLength(0)

    const mismatchedBudget = setup()
    mismatchedBudget.options.benchmark = {
      ...mismatchedBudget.options.benchmark,
      policy: {
        ...mismatchedBudget.options.benchmark.policy,
        budgetUsd: mismatchedBudget.options.budgetUsd + 1,
      },
    }
    await expect(proposeAuthoredAgentProfileImprovement(mismatchedBudget.options)).rejects.toThrow(
      /policy budgetUsd must equal/,
    )
    expect(mismatchedBudget.observed).toHaveLength(0)
  })

  it('refuses unchanged candidates, source drift, and reused held-out scenarios', async () => {
    const unchanged = setup()
    unchanged.options.candidateProfile = unchanged.baselineProfile
    await expect(proposeAuthoredAgentProfileImprovement(unchanged.options)).rejects.toThrow(
      /matches the baseline/,
    )

    const drifted = setup()
    drifted.options.source = {
      ...drifted.options.source,
      sourceDigest: canonicalCandidateDigest({ wrong: true }),
    }
    await expect(proposeAuthoredAgentProfileImprovement(drifted.options)).rejects.toThrow(
      /source digest does not match/,
    )

    const leaked = setup()
    leaked.options.developmentScenarios = [leaked.heldOutScenario]
    await expect(proposeAuthoredAgentProfileImprovement(leaked.options)).rejects.toThrow(
      /reuses development scenario/,
    )
  })
})
