import { BOOTSTRAP_GATE_MIN_N, type ProposalFinding } from '@tangle-network/agent-eval'
import type { CampaignScenarioIdentity } from '@tangle-network/agent-eval/campaign'
import {
  AGENT_IMPROVEMENT_SOURCE_METADATA_KEY,
  type AgentProfile,
} from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'

import { canonicalCandidateDigest } from '../src/candidate-execution/digest'
import {
  measureAuthoredAgentProfileImprovement,
  type ProposeAuthoredAgentProfileImprovementOptions,
  proposeAuthoredAgentProfileImprovement,
} from '../src/intelligence/authored-profile-improvement'
import { createAgentImprovementProposal } from '../src/intelligence/improvement-cycle'
import { optimizationActivationReceiptFromMetadata } from '../src/intelligence/optimization-receipt'
import { improvementFinding as fixtureFinding } from './helpers/improvement-method-fixture'
import {
  createProfileImprovementFixture,
  createProfileImprovementRunReceipt,
} from './helpers/profile-improvement-fixture'

import { trainedProfile } from './helpers/trained-profile'

const minimumPairedRuns = BOOTSTRAP_GATE_MIN_N
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

describe('trained profile release admission', () => {
  for (const arm of ['baseline', 'candidate'] as const) {
    for (const inherited of [false, true]) {
      it(`refuses ${arm} training exposure (${inherited ? 'ancestor' : 'current'}) before measurement`, async () => {
        const { options, observed, heldOutScenario } = setup()
        const key = arm === 'baseline' ? 'profile' : 'candidateProfile'
        let profile = trainedProfile(options[key], [
          {
            benchmark: 'independently-named-training-export',
            task: 'renamed-training-task',
            contentDigest: heldOutScenario.scenarioDigest,
          },
        ])
        if (inherited)
          profile = trainedProfile(profile, [
            {
              benchmark: 'fresh',
              task: 'fresh',
              contentDigest: canonicalCandidateDigest('fresh'),
            },
          ])
        options[key] = profile
        options.source.sourceDigest = options.stateDigest({
          identity: options.source.sourceIdentity,
          profile: options.profile,
        })
        options.candidateLineage.parentDigests = [options.source.sourceDigest]
        await expect(proposeAuthoredAgentProfileImprovement(options)).rejects.toThrow(
          /training exposure/,
        )
        expect(observed).toHaveLength(0)
      })
    }
  }
  it('allows fresh task content even when training task names coincide', async () => {
    const { options, observed, heldOutScenario } = setup()
    options.candidateProfile = trainedProfile(options.candidateProfile, [
      {
        benchmark: heldOutScenario.kind,
        task: heldOutScenario.id,
        contentDigest: canonicalCandidateDigest('fresh'),
      },
    ])
    const result = await proposeAuthoredAgentProfileImprovement(options)
    expect(result.proposal.evaluation.decision.outcome).toBe('ship')
    expect(observed).toHaveLength(minimumPairedRuns * 2)
  })
})

describe('authored measurement is independent of promotion', () => {
  it('returns a verified comparison that can be proposed without executing again', async () => {
    const { options, observed } = setup()
    const measured = await measureAuthoredAgentProfileImprovement(options)
    expect(measured.evaluation.decision.outcome).toBe('ship')
    expect(measured).not.toHaveProperty('proposal')
    expect(measured.measurements).toHaveLength(minimumPairedRuns)
    const calls = observed.length
    const proposal = createAgentImprovementProposal({
      runId: options.runId,
      findings: options.findings ?? [],
      evaluation: measured.evaluation,
    })
    expect(proposal.evaluation.experiment.digest).toBe(measured.experiment.digest)
    expect(observed).toHaveLength(calls)
  })

  it.each([0.2, 0.8])(
    'returns a complete non-promotable comparison for score %s',
    async (candidateScore) => {
      const { options } = setup()
      options.executor.measure = async (input) =>
        createProfileImprovementRunReceipt(input, input.arm === 'baseline' ? 0.8 : candidateScore)
      const result = await measureAuthoredAgentProfileImprovement(options)
      expect(result.evaluation.decision.outcome).not.toBe('ship')
      expect(result.measurements).toHaveLength(minimumPairedRuns)
      expect(result).not.toHaveProperty('proposal')
      expect(() =>
        createAgentImprovementProposal({
          runId: options.runId,
          findings: [],
          evaluation: result.evaluation,
        }),
      ).toThrow(/passing experiment/)
    },
  )

  it('still rejects an invalid host receipt rather than converting it into a negative research result', async () => {
    const { options } = setup()
    options.executor.measure = async (input) => ({
      ...createProfileImprovementRunReceipt(input, 0.5),
      digest: canonicalCandidateDigest({ forged: true }),
    })
    await expect(measureAuthoredAgentProfileImprovement(options)).rejects.toThrow(/digest/)
  })

  it('captures the executor and comparison identity before asynchronous measurements', async () => {
    const { options, observed } = setup()
    const original = options.executor.measure.bind(options.executor)
    const originalRunId = options.runId
    options.maxConcurrency = 1
    options.executor.measure = async (input) => {
      options.executor.measure = async () => {
        throw new Error('replacement executed')
      }
      options.runId = 'changed-while-running'
      return original(input)
    }
    const result = await measureAuthoredAgentProfileImprovement(options)
    expect(result.evaluation.provenance.runId).toBe(originalRunId)
    expect(observed).toHaveLength(minimumPairedRuns * 2)
  })

  it('does not invoke the host executor on pre-cancelled or held-out-overlap requests', async () => {
    const cancelled = setup()
    cancelled.options.signal = AbortSignal.abort(new Error('cancelled before spending'))
    await expect(measureAuthoredAgentProfileImprovement(cancelled.options)).rejects.toThrow(
      /cancelled before spending/,
    )
    expect(cancelled.observed).toHaveLength(0)
    const leaked = setup()
    leaked.options.developmentScenarios = [leaked.heldOutScenario]
    await expect(measureAuthoredAgentProfileImprovement(leaked.options)).rejects.toThrow(
      /reuses development/,
    )
    expect(leaked.observed).toHaveLength(0)
  })
})
