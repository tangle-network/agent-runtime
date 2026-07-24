import type { AnalystFinding } from '@tangle-network/agent-eval'
import { inMemoryCampaignStorage } from '@tangle-network/agent-eval/campaign'
import type {
  DispatchContext,
  JudgeConfig,
  MutableSurface,
  Scenario,
} from '@tangle-network/agent-eval/contract'
import {
  sealCandidateBenchmarkSuite,
  sealCandidateBenchmarkTask,
} from '@tangle-network/agent-eval/contract'
import { afterEach, describe, expect, it } from 'vitest'

import {
  canonicalCandidateDigest,
  embeddedCandidateArtifact,
} from '../src/candidate-execution/digest'
import {
  agentCandidateProfileAsAgentProfile,
  freezeGenericAgentCandidateProfile,
} from '../src/candidate-execution/profile'
import type { ImproveMethodFactory } from '../src/improvement'
import {
  createAgentImprovementActivationResult,
  executeAgentImprovementActivation,
  verifyAgentImprovementActivationResult,
} from '../src/intelligence/activation'
import {
  type AgentImprovementExperimentMaterial,
  createAgentImprovementActivation,
  createAgentImprovementProposal,
  proposeAgentImprovement,
  reviewAgentImprovementProposal,
  runAgentCandidateExperiment,
  verifyAgentImprovementActivation,
  verifyAgentImprovementProposal,
  verifyAgentImprovementReview,
  verifyCandidateExecutionEvidence,
} from '../src/intelligence/improvement-cycle'
import {
  agentImprovementTargetDigest,
  agentImprovementTargetInput,
  deriveChangedSurfaces,
} from '../src/intelligence/improvement-surfaces'
import {
  candidateBundle,
  candidateSha,
  cleanupCandidateFixtures,
  emptyCandidateSnapshot,
  redigestCandidateBundle,
} from './helpers/candidate-execution-fixture'
import {
  type CandidateExperimentFixture,
  cleanupCandidateExperimentFixtures,
  createCandidateExperimentFixture,
} from './helpers/candidate-experiment-fixture'

const finding: AnalystFinding = {
  schema_version: '1.0.0',
  finding_id: 'finding-1',
  analyst_id: 'improvement',
  produced_at: '2026-07-10T00:00:00.000Z',
  severity: 'high',
  area: 'prompt',
  claim: 'The agent omits the required answer.',
  evidence_refs: [{ kind: 'span', id: 'span-1' }],
  recommended_action: 'Return the measured answer.',
  confidence: 0.9,
  subject: 'agent-profile:prompt.systemPrompt',
}

interface ImprovementScenario extends Scenario {
  kind: 'improvement-test'
}

const improvementScenarios: ImprovementScenario[] = Array.from({ length: 12 }, (_, index) => ({
  id: `improvement-${index}`,
  kind: 'improvement-test',
}))
const improvementTrain = improvementScenarios.slice(0, 4)
const improvementSelection = improvementScenarios.slice(4, 8)
const improvementTest = improvementScenarios.slice(8)

const improvementAgent = async (
  surface: MutableSurface,
  _scenario: ImprovementScenario,
  context: DispatchContext,
): Promise<string> => {
  const paid = await context.cost.runPaidCall({
    channel: 'agent',
    actor: 'improvement-cycle-test',
    model: 'deterministic-test',
    maximumCharge: { externallyEnforcedMaximumUsd: 0.0001 },
    execute: async () => String(surface),
    receipt: () => ({
      model: 'deterministic-test',
      inputTokens: 1,
      outputTokens: 1,
      actualCostUsd: 0.0001,
    }),
  })
  if (!paid.succeeded) throw paid.error
  return paid.value
}

const improvementJudge: JudgeConfig<string, ImprovementScenario> = {
  name: 'exact-prompt',
  dimensions: [{ key: 'quality', description: 'Candidate prompt selected.' }],
  score: ({ artifact }) => {
    const composite = artifact === 'PROMOTED' ? 1 : 0
    return { dimensions: { quality: composite }, composite, notes: '' }
  },
}

const improvementMethod: ImproveMethodFactory<ImprovementScenario, string> = (context) => ({
  name: 'deterministic-complete-method',
  async optimize() {
    if (
      !context.findings.some((item) => (item as { finding_id?: string }).finding_id === 'finding-1')
    ) {
      throw new Error('analysis findings did not reach the optimization method')
    }
    return {
      winnerSurface: 'PROMOTED',
      cost: { totalCostUsd: 0, accountingComplete: true, incompleteReasons: [] },
    }
  },
})

function improvementOptions() {
  return {
    surface: 'prompt' as const,
    method: improvementMethod,
    trainScenarios: improvementTrain,
    selectionScenarios: improvementSelection,
    testScenarios: improvementTest,
    judges: [improvementJudge],
    agent: improvementAgent,
    runDir: `mem://improvement-cycle-${Math.random()}`,
    storage: inMemoryCampaignStorage(),
    resamples: 40,
    confidence: 0.95,
  }
}

afterEach(() => {
  cleanupCandidateExperimentFixtures()
  cleanupCandidateFixtures()
})

function candidateExperimentMaterial(
  experiment: CandidateExperimentFixture['experiment'],
): AgentImprovementExperimentMaterial {
  const { candidateLineage: _candidateLineage, digest: _digest, ...material } = experiment
  return material
}

describe('agent improvement lifecycle', () => {
  it('runs analysis through exact activation using only public inputs', async () => {
    const seed = createCandidateExperimentFixture()
    const profile = agentCandidateProfileAsAgentProfile(seed.experiment.baseline.profile)
    let measured: CandidateExperimentFixture | undefined
    const result = await proposeAgentImprovement({
      runId: 'public-flow-run',
      profile,
      analysis: {
        registry: {
          list: () => [{ id: 'improvement' }],
          run: async () => ({
            run_id: 'public-flow-run',
            correlation_id: 'public-flow-run',
            started_at: '2026-07-10T00:00:00.000Z',
            ended_at: '2026-07-10T00:00:01.000Z',
            findings: [finding],
            per_analyst: [],
            total_cost_usd: 0,
          }),
        },
        inputs: {},
        findingsStore: null,
        log: () => {},
      },
      improvement: improvementOptions(),
      buildExperiment: ({ improvement }) => {
        if (!improvement.candidate.profile) throw new Error('expected a profile candidate')
        const candidate = redigestCandidateBundle(seed.experiment.baseline, {
          profile: freezeGenericAgentCandidateProfile(improvement.candidate.profile),
        })
        measured = createCandidateExperimentFixture({
          baseline: seed.experiment.baseline,
          candidate,
        })
        return candidateExperimentMaterial(measured.experiment)
      },
      placeCell: (input) => {
        if (!measured) throw new Error('experiment was not built')
        return measured.placeCell(input)
      },
      now: () => new Date('2026-07-10T01:00:00.000Z'),
    })

    const review = reviewAgentImprovementProposal(result.proposal, {
      decision: 'approve',
      reviewedBy: 'operator@example.com',
      reason: 'Exact candidate passed all paired tasks.',
      now: () => new Date('2026-07-10T01:01:00.000Z'),
    })
    const activation = createAgentImprovementActivation(result.proposal, review, {
      intent: 'activate-candidate',
      targets: [{ surface: 'prompt', identity: 'tenant/default/profile' }],
      fundingOwner: 'tenant/default',
      authorizedBy: 'operator@example.com',
      expiresAt: '2026-07-10T01:07:00.000Z',
      now: () => new Date('2026-07-10T01:02:00.000Z'),
    })
    const activationResult = await executeAgentImprovementActivation(
      { proposal: result.proposal, review, activation },
      {
        transition: async (input) => {
          const target = input.targets[0]
          return createAgentImprovementActivationResult(input, {
            completedAt: '2026-07-10T01:03:00.000Z',
            outcome: {
              status: 'applied',
              transactionId: 'profile-version:2',
              targets: [
                {
                  surface: target.surface,
                  identity: target.identity,
                  beforeDigest: target.expectedBaseDigest,
                  afterDigest: target.desiredDigest,
                },
              ],
            },
          })
        },
        now: () => new Date('2026-07-10T01:03:00.000Z'),
      },
    )

    expect(result.proposal.changedSurfaces).toEqual(['prompt'])
    if (!measured) throw new Error('experiment was not built')
    expect(result.experiment.candidateLineage).toEqual({
      source: 'optimizer',
      parentDigests: [measured.experiment.baseline.digest],
      runIds: [result.improvement.lineage.runId],
      developmentSplitDigest: result.improvement.lineage.developmentSplitDigest,
    })
    expect(activation.targets[0].expectedBaseDigest).toBe(promptSurfaceDigest(measured))
    expect(activationResult.outcome.status).toBe('applied')
    expect(profile.prompt?.systemPrompt).not.toBe('PROMOTED')
    await result.improvement.dispose()
  }, 15_000)

  it('rejects an experiment that substitutes a different candidate', async () => {
    const seed = createCandidateExperimentFixture()
    const profile = agentCandidateProfileAsAgentProfile(seed.experiment.baseline.profile)

    await expect(
      proposeAgentImprovement({
        runId: 'substituted-candidate-run',
        profile,
        analysis: {
          registry: {
            list: () => [{ id: 'improvement' }],
            run: async () => ({
              run_id: 'substituted-candidate-run',
              correlation_id: 'substituted-candidate-run',
              started_at: '2026-07-10T00:00:00.000Z',
              ended_at: '2026-07-10T00:00:01.000Z',
              findings: [finding],
              per_analyst: [],
              total_cost_usd: 0,
            }),
          },
          inputs: {},
          findingsStore: null,
          log: () => {},
        },
        improvement: improvementOptions(),
        buildExperiment: ({ improvement }) => {
          if (!improvement.candidate.profile) throw new Error('expected a profile candidate')
          const substituted = {
            ...improvement.candidate.profile,
            prompt: { ...improvement.candidate.profile.prompt, systemPrompt: 'SUBSTITUTED' },
          }
          const candidate = redigestCandidateBundle(seed.experiment.baseline, {
            profile: freezeGenericAgentCandidateProfile(substituted),
          })
          return candidateExperimentMaterial(
            createCandidateExperimentFixture({
              baseline: seed.experiment.baseline,
              candidate,
            }).experiment,
          )
        },
        placeCell: () => {
          throw new Error('substituted candidates must fail before execution')
        },
      }),
    ).rejects.toThrow(/does not contain the improvement winner/)
  })

  it.each<
    [string, (material: AgentImprovementExperimentMaterial) => AgentImprovementExperimentMaterial]
  >([
    [
      'caller-supplied optimizer lineage',
      (material) =>
        Object.assign(material, {
          candidateLineage: {
            source: 'optimizer',
            parentDigests: [material.baseline.digest],
            runIds: ['forged-optimizer-run'],
            developmentSplitDigest: candidateSha('forged-development-split'),
            profileDiffIds: ['forged-profile-diff'],
            modelSnapshots: ['forged-model-snapshot'],
          },
        }),
    ],
    [
      'caller-supplied experiment digest',
      (material) => Object.assign(material, { digest: candidateSha('forged-experiment-digest') }),
    ],
  ])('rejects %s before it executes', async (_label, tamper) => {
    const seed = createCandidateExperimentFixture()
    const profile = agentCandidateProfileAsAgentProfile(seed.experiment.baseline.profile)

    await expect(
      proposeAgentImprovement({
        runId: 'human-lineage-run',
        profile,
        analysis: {
          registry: {
            list: () => [{ id: 'improvement' }],
            run: async () => ({
              run_id: 'human-lineage-run',
              correlation_id: 'human-lineage-run',
              started_at: '2026-07-10T00:00:00.000Z',
              ended_at: '2026-07-10T00:00:01.000Z',
              findings: [finding],
              per_analyst: [],
              total_cost_usd: 0,
            }),
          },
          inputs: {},
          findingsStore: null,
          log: () => {},
        },
        improvement: improvementOptions(),
        buildExperiment: ({ improvement }) => {
          if (!improvement.candidate.profile) throw new Error('expected a profile candidate')
          const candidate = redigestCandidateBundle(seed.experiment.baseline, {
            profile: freezeGenericAgentCandidateProfile(improvement.candidate.profile),
          })
          const material = candidateExperimentMaterial(
            createCandidateExperimentFixture({
              baseline: seed.experiment.baseline,
              candidate,
            }).experiment,
          )
          return tamper(material)
        },
        placeCell: () => {
          throw new Error('caller-supplied Runtime fields must fail before execution')
        },
      }),
    ).rejects.toThrow(/must not supply Runtime-owned fields/)
  })

  it('rejects a held-out task from the optimizer development split before it executes', async () => {
    const seed = createCandidateExperimentFixture()
    const profile = agentCandidateProfileAsAgentProfile(seed.experiment.baseline.profile)

    await expect(
      proposeAgentImprovement({
        runId: 'overlapping-split-run',
        profile,
        analysis: {
          registry: {
            list: () => [{ id: 'improvement' }],
            run: async () => ({
              run_id: 'overlapping-split-run',
              correlation_id: 'overlapping-split-run',
              started_at: '2026-07-10T00:00:00.000Z',
              ended_at: '2026-07-10T00:00:01.000Z',
              findings: [finding],
              per_analyst: [],
              total_cost_usd: 0,
            }),
          },
          inputs: {},
          findingsStore: null,
          log: () => {},
        },
        improvement: improvementOptions(),
        buildExperiment: ({ improvement }) => {
          if (!improvement.candidate.profile) throw new Error('expected a profile candidate')
          const candidate = redigestCandidateBundle(seed.experiment.baseline, {
            profile: freezeGenericAgentCandidateProfile(improvement.candidate.profile),
          })
          const fixture = createCandidateExperimentFixture({
            baseline: seed.experiment.baseline,
            candidate,
          })
          const task = fixture.experiment.benchmark.tasks[0]
          if (!task) throw new Error('expected a held-out task')
          const { digest: _digest, ...taskMaterial } = task
          const heldOutTask = sealCandidateBenchmarkTask({
            ...taskMaterial,
            benchmark: {
              ...task.benchmark,
              splitDigest: improvement.lineage.developmentSplitDigest,
            },
          })
          return {
            ...candidateExperimentMaterial(fixture.experiment),
            benchmark: sealCandidateBenchmarkSuite({
              tasks: [heldOutTask],
              reps: fixture.experiment.benchmark.suite.reps,
              seeds: fixture.experiment.benchmark.suite.seeds,
            }),
          }
        },
        placeCell: () => {
          throw new Error('overlapping development and held-out work must fail before execution')
        },
      }),
    ).rejects.toThrow(/development and held-out splits must be disjoint/)
  })

  it('requires both knowledge arms to share one measured candidate identity', () => {
    const withoutKnowledge = candidateBundle()
    const reference = {
      kind: 'knowledge-improvement-candidate' as const,
      runId: 'knowledge-pair-run',
      candidateId: 'knowledge-pair-candidate',
      goalHash: candidateSha('1'),
      baseHash: candidateSha('2'),
      candidateHash: candidateSha('3'),
      evidenceHash: candidateSha('4'),
      promotionPlanHash: candidateSha('5'),
    }
    const evaluation = embeddedCandidateArtifact(Buffer.from('{"score":1}', 'utf8'))
    const baseline = redigestCandidateBundle(withoutKnowledge, {
      knowledge: {
        candidate: reference,
        snapshot: emptyCandidateSnapshot('knowledge-baseline'),
        evaluation,
      },
    })
    const candidate = redigestCandidateBundle(baseline, {
      knowledge: {
        candidate: reference,
        snapshot: emptyCandidateSnapshot('knowledge-candidate'),
        evaluation,
      },
    })

    expect(deriveChangedSurfaces(baseline, candidate)).toEqual(['knowledge'])
    expect(() => deriveChangedSurfaces(withoutKnowledge, candidate)).toThrow(
      /must share one measured candidate and evaluation identity/,
    )

    const substituted = redigestCandidateBundle(candidate, {
      knowledge: {
        ...candidate.knowledge!,
        candidate: { ...reference, baseHash: candidateSha('6') },
      },
    })
    expect(() => deriveChangedSurfaces(baseline, substituted)).toThrow(
      /must share one measured candidate and evaluation identity/,
    )
    const experiment = createCandidateExperimentFixture({ baseline, candidate }).experiment
    expect(agentImprovementTargetInput(candidate, 'knowledge')).toEqual(candidate.knowledge)
    expect(agentImprovementTargetDigest(experiment, 'candidate', 'knowledge')).toBe(
      reference.candidateHash,
    )
  })

  it('requires a code patch to extend the exact baseline repository tree', () => {
    const repository = { kind: 'github' as const, owner: 'owner', repo: 'repo' }
    const baseline = redigestCandidateBundle(candidateBundle(), {
      code: {
        kind: 'no-op',
        reason: 'proposer-no-change',
        repository,
        baseCommit: 'a'.repeat(40),
        baseTree: 'b'.repeat(40),
      },
    })
    const patch = embeddedCandidateArtifact(Buffer.from('exact patch bytes', 'utf8'))
    const candidate = redigestCandidateBundle(baseline, {
      code: {
        kind: 'git-patch',
        repository,
        baseCommit: 'a'.repeat(40),
        baseTree: 'b'.repeat(40),
        candidateTree: 'c'.repeat(40),
        patch: { format: 'git-diff-binary', artifact: patch },
      },
    })

    expect(deriveChangedSurfaces(baseline, candidate)).toEqual(['code'])

    const substituted = redigestCandidateBundle(candidate, {
      code: { ...candidate.code, baseTree: 'd'.repeat(40) },
    })
    expect(() => deriveChangedSurfaces(baseline, substituted)).toThrow(
      /exact repository tree measured by the baseline arm/,
    )
  })

  it('measures the exact paired matrix before review and activation', async () => {
    const rig = createCandidateExperimentFixture()
    const executed: string[] = []
    const result = await runAgentCandidateExperiment({
      experiment: rig.experiment,
      runId: 'paired-run-1',
      maxConcurrency: 2,
      placeCell: (input) => {
        executed.push(`${input.arm}:${input.benchmarkCell.repetition}`)
        return rig.placeCell(input)
      },
    })

    expect(executed.sort()).toEqual([
      'baseline:0',
      'baseline:1',
      'baseline:2',
      'candidate:0',
      'candidate:1',
      'candidate:2',
    ])
    expect(result.measurements).toHaveLength(3)
    expect(result.evaluation).toMatchObject({
      experiment: { digest: rig.experiment.digest },
      overall: { baseline: 0, candidate: 1, delta: 1, n: 3 },
      decision: { outcome: 'ship' },
      evaluation: { executionCostUsd: 0, searchCostUsd: 0, totalCostUsd: 0 },
    })

    const proposal = createAgentImprovementProposal({
      runId: 'paired-run-1',
      findings: [finding],
      evaluation: result.evaluation,
      now: () => new Date('2026-07-10T01:00:00.000Z'),
    })
    expect(proposal.changedSurfaces).toEqual(['prompt'])
    expect(verifyAgentImprovementProposal(proposal)).toEqual(proposal)
    const { digest: _proposalDigest, ...proposalWithoutDigest } = proposal
    const judgeDerivedProposalWithoutDigest = {
      ...proposalWithoutDigest,
      findings: proposal.findings.map((item) => ({ ...item, derived_from_judge: true })),
    }
    const judgeDerivedProposal = {
      ...judgeDerivedProposalWithoutDigest,
      digest: canonicalCandidateDigest(judgeDerivedProposalWithoutDigest),
    }
    expect(() => verifyAgentImprovementProposal(judgeDerivedProposal)).toThrow(/judge-derived/)

    expect(() =>
      reviewAgentImprovementProposal(proposal, {
        decision: 'approve',
        reviewedBy: 'operator@example.com',
        reason: 'Invalid clock order.',
        now: () => new Date('2026-07-10T00:59:00.000Z'),
      }),
    ).toThrow(/cannot predate/)

    const review = reviewAgentImprovementProposal(proposal, {
      decision: 'approve',
      reviewedBy: 'operator@example.com',
      reason: 'All three paired tasks improved.',
      now: () => new Date('2026-07-10T01:01:00.000Z'),
    })
    expect(verifyAgentImprovementReview(review)).toEqual(review)

    expect(() =>
      createAgentImprovementActivation(proposal, review, {
        intent: 'activate-candidate',
        targets: [
          {
            surface: 'prompt',
            identity: 'tenant/default/profile',
          },
        ],
        fundingOwner: 'tenant/default',
        authorizedBy: 'operator@example.com',
        expiresAt: '2026-07-10T01:07:00.000Z',
        now: () => new Date('2026-07-10T01:00:30.000Z'),
      }),
    ).toThrow(/cannot predate/)

    expect(() =>
      createAgentImprovementActivation(proposal, review, {
        intent: 'activate-candidate',
        targets: [
          {
            surface: 'prompt',
            identity: 'tenant/default/profile',
          },
        ],
        fundingOwner: 'tenant/default',
        authorizedBy: 'operator@example.com',
        expiresAt: '2026-07-10T01:02:00.000Z',
        now: () => new Date('2026-07-10T01:02:00.000Z'),
      }),
    ).toThrow(/expiry must follow/)

    const activation = createAgentImprovementActivation(proposal, review, {
      intent: 'activate-candidate',
      targets: [
        {
          surface: 'prompt',
          identity: 'tenant/default/profile',
        },
      ],
      fundingOwner: 'tenant/default',
      authorizedBy: 'operator@example.com',
      expiresAt: '2026-07-10T01:07:00.000Z',
      now: () => new Date('2026-07-10T01:02:00.000Z'),
    })
    expect(verifyAgentImprovementActivation({ proposal, review, activation })).toEqual(activation)

    const { digest: _reviewDigest, ...reviewMaterial } = review
    const prematureReviewMaterial = {
      ...reviewMaterial,
      reviewedAt: '2026-07-10T00:59:00.000Z',
    }
    const prematureReview = {
      ...prematureReviewMaterial,
      digest: canonicalCandidateDigest(prematureReviewMaterial),
    }
    const { digest: _activationDigest, ...activationMaterial } = activation
    const prematureReviewActivationMaterial = {
      ...activationMaterial,
      reviewDigest: prematureReview.digest,
    }
    const prematureReviewActivation = {
      ...prematureReviewActivationMaterial,
      digest: canonicalCandidateDigest(prematureReviewActivationMaterial),
    }
    expect(() =>
      verifyAgentImprovementActivation({
        proposal,
        review: prematureReview,
        activation: prematureReviewActivation,
      }),
    ).toThrow(/does not bind/)

    const prematureActivationMaterial = {
      ...activationMaterial,
      authorizedAt: '2026-07-10T01:00:30.000Z',
    }
    const prematureActivation = {
      ...prematureActivationMaterial,
      digest: canonicalCandidateDigest(prematureActivationMaterial),
    }
    expect(() =>
      verifyAgentImprovementActivation({ proposal, review, activation: prematureActivation }),
    ).toThrow(/does not bind/)

    const impossibleExpiryMaterial = {
      ...activationMaterial,
      expiresAt: activationMaterial.authorizedAt,
    }
    const impossibleExpiry = {
      ...impossibleExpiryMaterial,
      digest: canonicalCandidateDigest(impossibleExpiryMaterial),
    }
    expect(() =>
      verifyAgentImprovementActivation({ proposal, review, activation: impossibleExpiry }),
    ).toThrow(/expiry must follow/)
  }, 15_000)

  it('keeps protected trace identities coherent after redaction', async () => {
    const rig = createCandidateExperimentFixture({
      executionIdFor: (input) =>
        `experiment-${input.arm}-4111111111111111-${input.benchmarkCell.repetition}`,
    })
    const result = await runAgentCandidateExperiment({
      experiment: rig.experiment,
      runId: 'redacted-trace-identity',
      placeCell: rig.placeCell,
    })

    expect(result.measurements).toHaveLength(3)
    expect(result.evaluation.decision.outcome).toBe('ship')
  })

  it('runs isolated memory as a real candidate surface', async () => {
    const rig = createCandidateExperimentFixture({ candidateSurface: 'memory' })
    const result = await runAgentCandidateExperiment({
      experiment: rig.experiment,
      runId: 'memory-run-1',
      placeCell: rig.placeCell,
    })
    const proposal = createAgentImprovementProposal({
      runId: 'memory-run-1',
      findings: [finding],
      evaluation: result.evaluation,
    })

    expect(proposal.changedSurfaces).toEqual(['memory'])
    expect(result.measurements).toHaveLength(3)
    for (const measurement of result.measurements) {
      expect(measurement.baseline.receipt.memory.mode).toBe('disabled')
      expect(measurement.candidate.receipt.memory.mode).toBe('isolated')
    }
  })

  it('rejects receipt substitution and stale activation targets', async () => {
    const rig = createCandidateExperimentFixture()
    const result = await runAgentCandidateExperiment({
      experiment: rig.experiment,
      runId: 'binding-run-1',
      placeCell: rig.placeCell,
    })
    const evidence = result.measurements[0]?.candidate
    if (!evidence) throw new Error('expected candidate evidence')
    const benchmarkCell = {
      suiteDigest: rig.experiment.benchmark.suite.digest,
      taskIndex: 0,
      repetition: 0,
    }
    expect(
      verifyCandidateExecutionEvidence(evidence, {
        experiment: rig.experiment,
        arm: 'candidate',
        benchmarkCell,
        seed: 101,
      }),
    ).toEqual(evidence)
    expect(() =>
      verifyCandidateExecutionEvidence(evidence, {
        experiment: rig.experiment,
        arm: 'baseline',
        benchmarkCell,
        seed: 101,
      }),
    ).toThrow(/substituted|bind/)

    const proposal = createAgentImprovementProposal({
      runId: 'binding-run-1',
      findings: [],
      evaluation: result.evaluation,
    })
    const review = reviewAgentImprovementProposal(proposal, {
      decision: 'approve',
      reviewedBy: 'operator@example.com',
      reason: 'Exact measured candidate approved.',
    })
    expect(() =>
      createAgentImprovementActivation(proposal, review, {
        intent: 'activate-candidate',
        targets: [
          {
            surface: 'skills',
            identity: 'tenant/default/profile',
          },
        ],
        fundingOwner: 'tenant/default',
        authorizedBy: 'operator@example.com',
        expiresAt: '2026-07-10T01:07:00.000Z',
      }),
    ).toThrow(/activation targets/)
    expect(() =>
      createAgentImprovementActivation(proposal, review, {
        intent: 'activate-candidate',
        targets: [
          {
            surface: 'prompt',
            identity: 'tenant/default/profile',
          },
          {
            surface: 'prompt',
            identity: 'tenant/other/profile',
          },
        ],
        fundingOwner: 'tenant/default',
        authorizedBy: 'operator@example.com',
        expiresAt: '2026-07-10T01:07:00.000Z',
      }),
    ).toThrow(/activation targets/)
  })

  it('does not create a proposal from an inconclusive comparison', async () => {
    const rig = createCandidateExperimentFixture({ scoreFor: () => 1 })
    const result = await runAgentCandidateExperiment({
      experiment: rig.experiment,
      runId: 'no-lift-run',
      placeCell: rig.placeCell,
    })

    expect(result.evaluation.decision.outcome).not.toBe('ship')
    expect(() =>
      createAgentImprovementProposal({
        runId: 'no-lift-run',
        findings: [],
        evaluation: result.evaluation,
      }),
    ).toThrow(/passing experiment/)
  })

  it('does not activate a rejected proposal', async () => {
    const rig = createCandidateExperimentFixture()
    const result = await runAgentCandidateExperiment({
      experiment: rig.experiment,
      runId: 'rejected-run',
      placeCell: rig.placeCell,
    })
    const proposal = createAgentImprovementProposal({
      runId: 'rejected-run',
      findings: [],
      evaluation: result.evaluation,
    })
    const review = reviewAgentImprovementProposal(proposal, {
      decision: 'reject',
      reviewedBy: 'operator@example.com',
      reason: 'Not suitable for this deployment.',
    })

    expect(() =>
      createAgentImprovementActivation(proposal, review, {
        intent: 'activate-candidate',
        targets: [
          {
            surface: 'prompt',
            identity: 'tenant/default/profile',
          },
        ],
        fundingOwner: 'tenant/default',
        authorizedBy: 'operator@example.com',
        expiresAt: '2026-07-10T01:07:00.000Z',
      }),
    ).toThrow(/requires an approval/)
  })

  it('retries a lost activation response without repeating the write', async () => {
    const approved = await approvedPromptImprovement('activate-candidate')
    let stored: ReturnType<typeof createAgentImprovementActivationResult> | undefined
    let writes = 0
    let loseFirstResponse = true
    const transition = async (
      input: Parameters<typeof createAgentImprovementActivationResult>[0],
    ) => {
      expect(input.candidateBundle.digest).toBe(approved.rig.experiment.candidate.digest)
      expect(input.bundle.digest).toBe(approved.rig.experiment.candidate.digest)
      expect(input.targets[0].desiredDigest).toBe(promptSurfaceDigest(approved.rig, 'candidate'))
      expect(input.targets[0].desiredInput).toEqual(promptSurfaceInput(approved.rig, 'candidate'))
      expect(Object.isFrozen(input.targets[0].desiredInput)).toBe(true)
      if (stored) return stored
      writes += 1
      stored = createAgentImprovementActivationResult(input, {
        completedAt: '2026-07-10T01:03:01.000Z',
        outcome: {
          status: 'applied',
          transactionId: 'profile-version:2',
          targets: [
            {
              surface: input.targets[0].surface,
              identity: input.targets[0].identity,
              beforeDigest: input.targets[0].expectedBaseDigest,
              afterDigest: input.targets[0].desiredDigest,
            },
          ],
        },
      })
      if (loseFirstResponse) {
        loseFirstResponse = false
        throw new Error('response lost after commit')
      }
      return stored
    }

    const first = await executeAgentImprovementActivation(approved, {
      transition,
      now: () => new Date('2026-07-10T01:03:00.000Z'),
    })
    expect(first.outcome.status).toBe('indeterminate')

    const retry = await executeAgentImprovementActivation(approved, {
      transition,
      now: () => new Date('2026-07-10T01:04:00.000Z'),
    })
    expect(retry).toEqual(stored)
    expect(retry.outcome.status).toBe('applied')
    expect(writes).toBe(1)
  })

  it('rejects a substituted activation input', async () => {
    const approved = await approvedPromptImprovement('activate-candidate')
    const result = await executeAgentImprovementActivation(approved, {
      transition: async (input) => {
        const substituted = {
          ...input,
          targets: [
            {
              ...input.targets[0],
              desiredInput: { prompt: { systemPrompt: 'SUBSTITUTED' } },
            },
          ],
        } as typeof input
        expect(() =>
          createAgentImprovementActivationResult(substituted, {
            completedAt: '2026-07-10T01:03:01.000Z',
            outcome: { status: 'failed', code: 'TEST_ONLY', message: 'No write attempted.' },
          }),
        ).toThrow(/does not match its authorization/)
        return createAgentImprovementActivationResult(input, {
          completedAt: '2026-07-10T01:03:01.000Z',
          outcome: { status: 'failed', code: 'TEST_ONLY', message: 'No write attempted.' },
        })
      },
      now: () => new Date('2026-07-10T01:03:00.000Z'),
    })

    expect(result.outcome.status).toBe('failed')
  })

  it('records stale target state without applying the candidate', async () => {
    const approved = await approvedPromptImprovement('activate-candidate')
    const result = await executeAgentImprovementActivation(approved, {
      transition: async (input) =>
        createAgentImprovementActivationResult(input, {
          completedAt: '2026-07-10T01:03:01.000Z',
          outcome: {
            status: 'conflict',
            targets: [
              {
                surface: 'prompt',
                identity: 'tenant/default/profile',
                currentDigest: canonicalCandidateDigest('newer-profile'),
              },
            ],
          },
        }),
      now: () => new Date('2026-07-10T01:03:00.000Z'),
    })

    expect(result.outcome.status).toBe('conflict')
    expect(verifyAgentImprovementActivationResult({ ...approved, result })).toEqual(result)
  })

  it('restores the measured baseline only from the candidate state', async () => {
    const approved = await approvedPromptImprovement('restore-baseline')
    const result = await executeAgentImprovementActivation(approved, {
      transition: async (input) => {
        expect(input.candidateBundle.digest).toBe(approved.rig.experiment.candidate.digest)
        expect(input.bundle.digest).toBe(approved.rig.experiment.baseline.digest)
        expect(input.targets[0]).toMatchObject({
          expectedBaseDigest: promptSurfaceDigest(approved.rig, 'candidate'),
          desiredDigest: promptSurfaceDigest(approved.rig, 'baseline'),
          desiredInput: promptSurfaceInput(approved.rig, 'baseline'),
        })
        return createAgentImprovementActivationResult(input, {
          completedAt: '2026-07-10T01:03:01.000Z',
          outcome: {
            status: 'applied',
            transactionId: 'profile-version:3',
            targets: [
              {
                surface: 'prompt',
                identity: 'tenant/default/profile',
                beforeDigest: input.targets[0].expectedBaseDigest,
                afterDigest: input.targets[0].desiredDigest,
              },
            ],
          },
        })
      },
      now: () => new Date('2026-07-10T01:03:00.000Z'),
    })

    expect(result.outcome.status).toBe('applied')
  })

  it('clamps a skewed executor clock to the authorization time', async () => {
    const approved = await approvedPromptImprovement('activate-candidate')
    let attemptedAt = ''
    const result = await executeAgentImprovementActivation(approved, {
      transition: async (input) => {
        attemptedAt = input.attemptedAt
        return createAgentImprovementActivationResult(input, {
          completedAt: input.attemptedAt,
          outcome: { status: 'failed', code: 'TEST', message: 'No write attempted.' },
        })
      },
      now: () => new Date('2026-07-10T01:00:30.000Z'),
    })

    expect(attemptedAt).toBe(approved.activation.authorizedAt)
    expect(result.outcome.status).toBe('failed')
  })

  it('expires unused authority and marks invalid product results indeterminate', async () => {
    const expired = await approvedPromptImprovement(
      'activate-candidate',
      '2026-07-10T01:02:30.000Z',
    )
    let writes = 0
    const expiredResult = await executeAgentImprovementActivation(expired, {
      transition: async () => {
        writes += 1
        throw new Error('expired write function must not run')
      },
      now: () => new Date('2026-07-10T01:03:00.000Z'),
    })
    expect(expiredResult.outcome).toMatchObject({
      status: 'indeterminate',
      code: 'RECONCILIATION_UNAVAILABLE',
    })
    expect(writes).toBe(0)

    const reconciled = await executeAgentImprovementActivation(expired, {
      transition: async () => {
        writes += 1
        throw new Error('expired write function must not run')
      },
      reconcile: async (input) =>
        createAgentImprovementActivationResult(input, {
          completedAt: '2026-07-10T01:03:01.000Z',
          outcome: {
            status: 'already-applied',
            targets: [
              {
                surface: 'prompt',
                identity: 'tenant/default/profile',
                currentDigest: input.targets[0].desiredDigest,
              },
            ],
          },
        }),
      now: () => new Date('2026-07-10T01:03:00.000Z'),
    })
    expect(reconciled.outcome.status).toBe('already-applied')
    expect(writes).toBe(0)

    const backwardsTime = await executeAgentImprovementActivation(
      await approvedPromptImprovement('activate-candidate'),
      {
        transition: async (input) =>
          createAgentImprovementActivationResult(input, {
            completedAt: '2026-07-10T01:02:59.000Z',
            outcome: { status: 'failed', code: 'TEST', message: 'Invalid completion time.' },
          }),
        now: () => new Date('2026-07-10T01:03:00.000Z'),
      },
    )
    expect(backwardsTime.outcome).toMatchObject({
      status: 'indeterminate',
      code: 'TRANSITION_THROW',
    })

    const approved = {
      ...expired,
      activation: createAgentImprovementActivation(expired.proposal, expired.review, {
        intent: 'activate-candidate',
        targets: [
          {
            surface: 'prompt',
            identity: 'tenant/default/profile',
          },
        ],
        fundingOwner: 'tenant/default',
        authorizedBy: 'operator@example.com',
        expiresAt: '2026-07-10T01:07:00.000Z',
        now: () => new Date('2026-07-10T01:02:00.000Z'),
      }),
    }
    const invalidResult = await executeAgentImprovementActivation(approved, {
      transition: async (input) => {
        writes += 1
        return createAgentImprovementActivationResult(input, {
          completedAt: '2026-07-10T01:03:01.000Z',
          outcome: {
            status: 'already-applied',
            targets: [
              {
                surface: 'prompt',
                identity: 'tenant/default/profile',
                currentDigest: input.targets[0].expectedBaseDigest,
              },
            ],
          },
        })
      },
      now: () => new Date('2026-07-10T01:03:00.000Z'),
    })
    expect(invalidResult.outcome).toMatchObject({
      status: 'indeterminate',
      code: 'TRANSITION_THROW',
    })
    expect(writes).toBe(1)
  })
})

async function approvedPromptImprovement(
  intent: 'activate-candidate' | 'restore-baseline',
  expiresAt = '2026-07-10T01:07:00.000Z',
) {
  const rig = createCandidateExperimentFixture()
  const measured = await runAgentCandidateExperiment({
    experiment: rig.experiment,
    runId: `activation-${intent}`,
    placeCell: rig.placeCell,
  })
  const proposal = createAgentImprovementProposal({
    runId: `activation-${intent}`,
    findings: [finding],
    evaluation: measured.evaluation,
    now: () => new Date('2026-07-10T01:00:00.000Z'),
  })
  const review = reviewAgentImprovementProposal(proposal, {
    decision: 'approve',
    reviewedBy: 'operator@example.com',
    reason: 'Measured candidate approved.',
    now: () => new Date('2026-07-10T01:01:00.000Z'),
  })
  const activation = createAgentImprovementActivation(proposal, review, {
    intent,
    targets: [
      {
        surface: 'prompt',
        identity: 'tenant/default/profile',
      },
    ],
    fundingOwner: 'tenant/default',
    authorizedBy: 'operator@example.com',
    expiresAt,
    now: () => new Date('2026-07-10T01:02:00.000Z'),
  })
  return { rig, proposal, review, activation }
}

function promptSurfaceDigest(
  rig: CandidateExperimentFixture,
  arm: 'baseline' | 'candidate' = 'baseline',
): `sha256:${string}` {
  return canonicalCandidateDigest(promptSurfaceInput(rig, arm))
}

function promptSurfaceInput(
  rig: CandidateExperimentFixture,
  arm: 'baseline' | 'candidate' = 'baseline',
): { prompt: unknown } {
  const profile = agentCandidateProfileAsAgentProfile(rig.experiment[arm].profile)
  return { prompt: profile.prompt ?? null }
}
