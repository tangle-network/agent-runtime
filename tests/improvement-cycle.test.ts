import {
  type CostLedgerHandle,
  minimumPairsForPairedDeltaTest,
  type ProposalFinding,
} from '@tangle-network/agent-eval'
import { campaignScenarioIdentity } from '@tangle-network/agent-eval/campaign'
import {
  sealAgentProfileImprovementTask,
  sealCandidateBenchmarkSuite,
  sealCandidateBenchmarkTask,
} from '@tangle-network/agent-eval/contract'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it } from 'vitest'

import {
  canonicalCandidateDigest,
  embeddedCandidateArtifact,
} from '../src/candidate-execution/digest'
import {
  agentCandidateProfileAsAgentProfile,
  freezeGenericAgentCandidateProfile,
} from '../src/candidate-execution/profile'
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
  proposeAgentProfileImprovement,
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
import { prepareAgentImprovementProfileActivation } from '../src/intelligence/profile-activation'
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
import {
  candidateExperimentMaterial,
  improvementFinding as fixtureFinding,
  improvementOptions,
} from './helpers/improvement-method-fixture'
import {
  createProfileImprovementFixture,
  createProfileImprovementRunReceipt,
} from './helpers/profile-improvement-fixture'

afterEach(() => {
  cleanupCandidateExperimentFixtures()
  cleanupCandidateFixtures()
})
const minimumPairedRuns = minimumPairsForPairedDeltaTest(0.95)
const { proposal_origin: _fixtureOrigin, ...fixtureAnalystFinding } =
  fixtureFinding as ProposalFinding
const finding = {
  ...fixtureAnalystFinding,
  evidence_refs: [{ kind: 'span' as const, uri: 'span-1' }],
}
const productionFinding: ProposalFinding = {
  ...finding,
  proposal_origin: 'production',
}
const searchFinding: ProposalFinding = {
  ...finding,
  finding_id: 'search-finding-1',
  proposal_origin: 'search',
  derived_from_judge: true,
}

// These exercise the whole improvement lifecycle — real content-addressing, real file I/O, a
// paired matrix — and on CI the slowest already burn ~4.3s of the 5s default. That leaves the
// file one scheduling hiccup from red regardless of what changed. Size the timeout to the work
// these tests actually do rather than leaving them at the edge of the default.
describe('agent improvement lifecycle', { timeout: 30_000 }, () => {
  it('applies and restores an opaque profile improvement through the shared activation path', async () => {
    const fixture = createProfileImprovementFixture()
    const proposal = createAgentImprovementProposal({
      runId: 'profile-improvement-1',
      findings: [productionFinding],
      evaluation: fixture.evaluation,
      now: () => new Date('2026-07-24T00:00:00.000Z'),
    })
    const experiment = proposal.evaluation.experiment
    if (proposal.evaluation.kind !== 'agent-profile-improvement-measured-comparison') {
      throw new Error('expected profile improvement proposal')
    }
    expect(verifyAgentImprovementProposal(proposal)).toEqual(proposal)
    expect(experiment.baseline).toEqual({ stateDigest: experiment.baseline.stateDigest })
    expect(experiment.candidate).toEqual({ stateDigest: experiment.candidate.stateDigest })
    const { digest: _proposalDigest, ...proposalMaterial } = proposal
    const reorderedProposalMaterial = {
      ...proposalMaterial,
      changedSurfaces: ['skills', 'prompt'] as const,
    }
    const reorderedProposal = {
      ...reorderedProposalMaterial,
      digest: canonicalCandidateDigest(reorderedProposalMaterial),
    }
    expect(verifyAgentImprovementProposal(reorderedProposal)).toEqual(reorderedProposal)

    const review = reviewAgentImprovementProposal(proposal, {
      decision: 'approve',
      reviewedBy: 'operator@example.com',
      reason: 'The exact profile change passed paired held-out work.',
      now: () => new Date('2026-07-24T00:01:00.000Z'),
    })
    const activationInput = {
      intent: 'activate-candidate',
      targets: [
        { surface: 'prompt', identity: 'tenant/default/profile' },
        { surface: 'skills', identity: 'tenant/default/profile' },
      ],
      fundingOwner: 'tenant/default',
      authorizedBy: 'operator@example.com',
      expiresAt: '2026-07-24T00:10:00.000Z',
      now: () => new Date('2026-07-24T00:02:00.000Z'),
    } as const
    const activate = createAgentImprovementActivation(proposal, review, activationInput)
    expect(verifyAgentImprovementActivation({ proposal, review, activation: activate })).toEqual(
      activate,
    )
    expect(activate.executionRef).toBeUndefined()
    expect(() =>
      createAgentImprovementActivation(proposal, review, {
        ...activationInput,
        executionRef: experiment.executionRef,
      }),
    ).toThrow('profile activation executionRef is valid only for agent-profile targets')
    const { digest: _activationDigest, ...activationMaterial } = activate
    expect(() =>
      createAgentImprovementActivation(proposal, review, {
        intent: 'activate-candidate',
        targets: [
          { surface: 'prompt', identity: 'tenant/default/profile-a' },
          { surface: 'skills', identity: 'tenant/default/profile-b' },
        ],
        fundingOwner: 'tenant/default',
        authorizedBy: 'operator@example.com',
        expiresAt: '2026-07-24T00:10:00.000Z',
        now: () => new Date('2026-07-24T00:02:00.000Z'),
      }),
    ).toThrow('profile improvement activation targets must name one profile identity')
    const [promptTarget, skillsTarget] = activate.targets
    if (!skillsTarget) throw new Error('expected profile activation targets')
    const splitActivationMaterial = {
      ...activationMaterial,
      targets: [promptTarget, { ...skillsTarget, identity: 'tenant/default/profile-b' }],
    }
    const splitActivation = {
      ...splitActivationMaterial,
      digest: canonicalCandidateDigest(splitActivationMaterial),
    }
    expect(() =>
      verifyAgentImprovementActivation({ proposal, review, activation: splitActivation }),
    ).toThrow('profile improvement activation targets must name one profile identity')

    let currentProfile = fixture.baselineProfile
    const applyResult = await executeAgentImprovementActivation(
      { proposal, review, activation: activate },
      {
        transition: async (input) => {
          expect(input.kind).toBe('profile-improvement')
          if (input.kind !== 'profile-improvement') throw new Error('expected profile transition')
          expect('candidateBundle' in input).toBe(false)
          expect('bundle' in input).toBe(false)
          expect(input.experiment.baseline).toEqual({
            stateDigest: experiment.baseline.stateDigest,
          })
          expect(input.sourceStateDigest).toBe(experiment.baseline.stateDigest)
          expect(input.desiredStateDigest).toBe(experiment.candidate.stateDigest)
          expect(input.operation).toEqual({
            kind: 'apply-change',
            changes: experiment.change,
          })
          const prepared = prepareAgentImprovementProfileActivation({
            currentByIdentity: new Map([['tenant/default/profile', currentProfile]]),
            profileTransition: input,
            stateDigest: ({ profile }) => fixture.stateDigest(profile),
          })
          expect(prepared.status).toBe('apply')
          if (prepared.status !== 'apply') throw new Error('expected profile replacement')
          expect(prepared.replacements).toEqual([
            { identity: 'tenant/default/profile', profile: fixture.candidateProfile },
          ])
          currentProfile = prepared.replacements[0].profile
          return createAgentImprovementActivationResult(input, {
            completedAt: '2026-07-24T00:03:00.000Z',
            outcome: {
              status: 'applied',
              transactionId: 'profile-version:8',
              targets: prepared.targets,
            },
          })
        },
        now: () => new Date('2026-07-24T00:03:00.000Z'),
      },
    )
    expect(applyResult.outcome.status).toBe('applied')
    expect(fixture.stateDigest(currentProfile)).toBe(experiment.candidate.stateDigest)

    const restore = createAgentImprovementActivation(proposal, review, {
      intent: 'restore-baseline',
      targets: [
        { surface: 'prompt', identity: 'tenant/default/profile' },
        { surface: 'skills', identity: 'tenant/default/profile' },
      ],
      fundingOwner: 'tenant/default',
      authorizedBy: 'operator@example.com',
      expiresAt: '2026-07-24T00:12:00.000Z',
      now: () => new Date('2026-07-24T00:04:00.000Z'),
    })
    const restoreResult = await executeAgentImprovementActivation(
      { proposal, review, activation: restore },
      {
        transition: async (input) => {
          expect(input.kind).toBe('profile-improvement')
          if (input.kind !== 'profile-improvement') throw new Error('expected profile transition')
          expect(input.sourceStateDigest).toBe(experiment.candidate.stateDigest)
          expect(input.desiredStateDigest).toBe(experiment.baseline.stateDigest)
          expect(input.operation).toEqual({ kind: 'restore-state' })
          const unavailable = prepareAgentImprovementProfileActivation({
            currentByIdentity: new Map([['tenant/default/profile', currentProfile]]),
            profileTransition: input,
            stateDigest: ({ profile }) => fixture.stateDigest(profile),
          })
          expect(unavailable).toMatchObject({
            status: 'unavailable',
            code: 'PROFILE_STATE_UNAVAILABLE',
            requiredStateDigest: experiment.baseline.stateDigest,
          })
          const prepared = prepareAgentImprovementProfileActivation({
            currentByIdentity: new Map([['tenant/default/profile', currentProfile]]),
            profileTransition: input,
            stateDigest: ({ profile }) => fixture.stateDigest(profile),
            resolveState: ({ stateDigest }) =>
              stateDigest === experiment.baseline.stateDigest ? fixture.baselineProfile : undefined,
          })
          expect(prepared.status).toBe('apply')
          if (prepared.status !== 'apply') throw new Error('expected profile restoration')
          expect(prepared.replacements).toEqual([
            { identity: 'tenant/default/profile', profile: fixture.baselineProfile },
          ])
          currentProfile = prepared.replacements[0].profile
          return createAgentImprovementActivationResult(input, {
            completedAt: '2026-07-24T00:05:00.000Z',
            outcome: {
              status: 'applied',
              transactionId: 'profile-version:7',
              targets: prepared.targets,
            },
          })
        },
        now: () => new Date('2026-07-24T00:05:00.000Z'),
      },
    )

    expect(restoreResult.outcome.status).toBe('applied')
    expect(fixture.stateDigest(currentProfile)).toBe(experiment.baseline.stateDigest)
    expect(
      verifyAgentImprovementActivationResult({
        proposal,
        review,
        activation: restore,
        result: restoreResult,
      }),
    ).toEqual(restoreResult)
  })

  it('builds a source-bound profile proposal without product experiment wiring', async () => {
    const template = createProfileImprovementFixture()
    const task = template.evaluation.experiment.benchmark.tasks[0]
    if (!task) throw new Error('expected a profile improvement task')
    const { digest: _taskDigest, ...taskMaterial } = task
    const { agent: optimize, executionRef, ...improvement } = improvementOptions()
    const executorRef = {
      kind: 'agent-profile-improvement-execution-ref' as const,
      identity: 'profile-proposal-test-runner',
      digest: executionRef,
    }
    const profile: AgentProfile = {
      name: 'support-agent',
      prompt: { systemPrompt: 'BASELINE' },
    }
    const stateDigest = ({ profile: state }: { identity: string; profile: AgentProfile }) =>
      canonicalCandidateDigest({ definition: state, recommendedSize: 'small' })
    const source = {
      kind: 'platform-agent-profile',
      sourceIdentity: 'profile-support',
      sourceDigest: stateDigest({ identity: 'profile-support', profile }),
      sourceRevision: 7,
    }
    await expect(
      proposeAgentProfileImprovement({
        source,
        improvement: { surface: 'tools' },
      } as never),
    ).rejects.toThrow(/supports prompt or skills/)
    const {
      agent: rejectedOptimize,
      executionRef: rejectedExecutionDigest,
      ...rejectedImprovement
    } = improvementOptions()
    const rejectedExecutorRef = {
      kind: 'agent-profile-improvement-execution-ref' as const,
      identity: 'profile-uncaptured-cost-runner',
      digest: rejectedExecutionDigest,
    }
    let rejectedMeasurements = 0
    let rejectedOptimizerCalls = 0
    const countedRejectedOptimize = async (...args: Parameters<typeof rejectedOptimize>) => {
      rejectedOptimizerCalls += 1
      return rejectedOptimize(...args)
    }
    await expect(
      proposeAgentProfileImprovement({
        runId: 'profile-uncaptured-cost-run',
        budgetUsd: 7,
        source,
        profile,
        stateDigest,
        analysis: {
          registry: {
            list: () => [{ id: 'improvement' }],
            run: async () => ({
              run_id: 'profile-uncaptured-cost-run',
              correlation_id: 'profile-uncaptured-cost-run',
              started_at: '2026-07-27T00:00:00.000Z',
              ended_at: '2026-07-27T00:00:01.000Z',
              findings: [finding],
              per_analyst: [],
              total_cost_usd: 0,
              total_cost_provenance: { kind: 'uncaptured' as const, usd: null },
            }),
          },
          inputs: {},
          findingsStore: null,
        },
        improvement: rejectedImprovement,
        benchmark: {
          tasks: [taskMaterial],
          reps: 3,
          seeds: [31, 32, 33],
          policy: template.evaluation.experiment.policy,
        },
        executor: {
          executionRef: rejectedExecutorRef,
          optimize: countedRejectedOptimize,
          measure: async () => {
            rejectedMeasurements += 1
            throw new Error('uncaptured analysis cost must stop before profile measurement')
          },
        },
      }),
    ).rejects.toThrow('agent improvement analysis cost is uncaptured')
    expect(rejectedOptimizerCalls).toBe(0)
    expect(rejectedMeasurements).toBe(0)
    const executed: Array<{ arm: 'baseline' | 'candidate'; prompt: string | undefined }> = []

    const result = await proposeAgentProfileImprovement({
      runId: 'profile-proposal-run',
      budgetUsd: minimumPairedRuns * 2 + 1,
      source,
      profile,
      stateDigest,
      analysis: {
        registry: {
          list: () => [{ id: 'improvement' }],
          run: async (_runId, _inputs, registryOptions) => {
            const costLedger = registryOptions?.costLedger as CostLedgerHandle | undefined
            if (!costLedger) throw new Error('profile analysis requires the shared account')
            const paid = await costLedger.runPaidCall({
              callId: 'profile-proposal-analysis',
              channel: 'analyst',
              phase: 'profile-improvement-analysis',
              actor: 'profile-proposal-analyst',
              model: 'profile-proposal-analyst',
              maximumCharge: { externallyEnforcedMaximumUsd: 0.25 },
              execute: async () => undefined,
              receipt: () => ({
                model: 'profile-proposal-analyst',
                inputTokens: 0,
                outputTokens: 0,
                actualCostUsd: 0.25,
              }),
            })
            if (!paid.succeeded) throw paid.error
            return {
              run_id: 'profile-proposal-run',
              correlation_id: 'profile-proposal-run',
              started_at: '2026-07-27T00:00:00.000Z',
              ended_at: '2026-07-27T00:00:01.000Z',
              findings: [finding],
              per_analyst: [],
              total_cost_usd: 0.25,
              total_cost_provenance: { kind: 'observed' as const, usd: 0.25 },
            }
          },
        },
        inputs: {},
        findingsStore: null,
      },
      improvement,
      benchmark: {
        tasks: [taskMaterial],
        reps: minimumPairedRuns,
        seeds: Array.from({ length: minimumPairedRuns }, (_, index) => 41 + index) as [
          number,
          ...number[],
        ],
        policy: template.evaluation.experiment.policy,
      },
      executor: {
        executionRef: executorRef,
        optimize,
        measure: async (input) => {
          executed.push({ arm: input.arm, prompt: input.profile.prompt?.systemPrompt })
          return createProfileImprovementRunReceipt(input, input.arm === 'candidate' ? 1 : 0)
        },
      },
      now: () => new Date('2026-07-27T00:02:00.000Z'),
    })

    expect(executed).toHaveLength(minimumPairedRuns * 2)
    expect(executed.filter((entry) => entry.arm === 'baseline')).toEqual(
      Array.from({ length: minimumPairedRuns }, () => ({
        arm: 'baseline',
        prompt: 'BASELINE',
      })),
    )
    expect(executed.filter((entry) => entry.arm === 'candidate')).toEqual(
      Array.from({ length: minimumPairedRuns }, () => ({
        arm: 'candidate',
        prompt: 'PROMOTED',
      })),
    )
    expect(result.experiment.source).toEqual(source)
    expect(result.experiment.executionRef).toEqual(executorRef)
    expect(result.proposal.changedSurfaces).toEqual(['prompt'])
    expect(result.proposal.evaluation).toMatchObject({
      kind: 'agent-profile-improvement-measured-comparison',
      metadata: { agentImprovementSource: source },
      overall: { baseline: 0, candidate: 1, n: minimumPairedRuns },
    })
    expect(result.proposal.evaluation.evaluation.preparation.cost.provenance).toBe('observed')
    expect(result.proposal.evaluation.evaluation.preparation.cost.usd).toBeCloseTo(0.2508)
    expect(result.proposal.evaluation.evaluation.total.cost.usd).toBeCloseTo(
      result.proposal.evaluation.evaluation.preparation.cost.usd +
        result.proposal.evaluation.evaluation.measurement.cost.usd,
    )
    await result.improvement.dispose()

    const {
      agent: budgetOptimize,
      executionRef: budgetExecutionDigest,
      ...budgetImprovement
    } = improvementOptions()
    let budgetMeasurements = 0
    await expect(
      proposeAgentProfileImprovement({
        runId: 'profile-budget-refusal-run',
        budgetUsd: 6,
        source,
        profile,
        stateDigest,
        analysis: {
          registry: {
            list: () => [{ id: 'improvement' }],
            run: async () => ({
              run_id: 'profile-budget-refusal-run',
              correlation_id: 'profile-budget-refusal-run',
              started_at: '2026-07-27T00:00:00.000Z',
              ended_at: '2026-07-27T00:00:01.000Z',
              findings: [finding],
              per_analyst: [],
              total_cost_usd: 0,
              total_cost_provenance: { kind: 'observed' as const, usd: 0 },
            }),
          },
          inputs: {},
          findingsStore: null,
        },
        improvement: budgetImprovement,
        benchmark: {
          tasks: [taskMaterial],
          reps: 3,
          seeds: [51, 52, 53],
          policy: template.evaluation.experiment.policy,
        },
        executor: {
          executionRef: {
            kind: 'agent-profile-improvement-execution-ref',
            identity: 'profile-budget-refusal-runner',
            digest: budgetExecutionDigest,
          },
          optimize: budgetOptimize,
          measure: async () => {
            budgetMeasurements += 1
            throw new Error('insufficient budget must stop before profile measurement')
          },
        },
      }),
    ).rejects.toThrow(/would exceed ceiling 6/)
    expect(budgetMeasurements).toBe(0)
  })

  it('rejects a profile measurement task previously visible to the optimizer', async () => {
    const template = createProfileImprovementFixture()
    const task = template.evaluation.experiment.benchmark.tasks[0]
    if (!task) throw new Error('expected a profile improvement task')
    const { digest: _taskDigest, ...taskMaterial } = task
    const { agent: optimize, executionRef, ...improvement } = improvementOptions()
    const executorRef = {
      kind: 'agent-profile-improvement-execution-ref' as const,
      identity: 'profile-overlap-test-runner',
      digest: executionRef,
    }
    const searchedScenario = campaignScenarioIdentity(improvement.testScenarios[0]!)
    const overlappingTask = sealAgentProfileImprovementTask({
      ...taskMaterial,
      scenario: {
        id: searchedScenario.id,
        kind: searchedScenario.kind,
        digest: searchedScenario.scenarioDigest,
      },
    })
    const { digest: _overlappingTaskDigest, ...overlappingTaskMaterial } = overlappingTask
    const profile: AgentProfile = {
      name: 'support-agent',
      prompt: { systemPrompt: 'BASELINE' },
    }
    const stateDigest = ({ profile: state }: { identity: string; profile: AgentProfile }) =>
      canonicalCandidateDigest({ definition: state, recommendedSize: 'small' })
    const source = {
      kind: 'platform-agent-profile' as const,
      sourceIdentity: 'profile-support',
      sourceDigest: stateDigest({ identity: 'profile-support', profile }),
      sourceRevision: 7,
    }
    let measuredCells = 0

    await expect(
      proposeAgentProfileImprovement({
        runId: 'profile-overlap-run',
        budgetUsd: 7,
        source,
        profile,
        stateDigest,
        analysis: {
          registry: {
            list: () => [{ id: 'improvement' }],
            run: async () => ({
              run_id: 'profile-overlap-run',
              correlation_id: 'profile-overlap-run',
              started_at: '2026-07-27T00:00:00.000Z',
              ended_at: '2026-07-27T00:00:01.000Z',
              findings: [finding],
              per_analyst: [],
              total_cost_usd: 0,
              total_cost_provenance: { kind: 'observed', usd: 0 },
            }),
          },
          inputs: {},
          findingsStore: null,
        },
        improvement,
        benchmark: {
          tasks: [overlappingTaskMaterial],
          reps: 3,
          seeds: [41, 42, 43],
          policy: template.evaluation.experiment.policy,
        },
        executor: {
          executionRef: executorRef,
          optimize,
          measure: async () => {
            measuredCells += 1
            throw new Error('reused held-out work must fail before profile execution')
          },
        },
      }),
    ).rejects.toThrow(
      /release benchmark reuses optimizer scenario\(s\): \[improvement-8 \(final-test\)\]/,
    )
    expect(measuredCells).toBe(0)
  })

  it('rejects malformed optimizer evidence on profile comparisons', () => {
    const fixture = createProfileImprovementFixture()

    expect(() =>
      createAgentImprovementProposal({
        runId: 'profile-improvement-1',
        findings: [productionFinding],
        evaluation: {
          ...fixture.evaluation,
          metadata: { optimizationReceipt: { kind: 'caller-authored' } },
        },
      }),
    ).toThrow(/optimization receipt/)
  })

  it('rejects unmetered proposal sources before analysis runs', async () => {
    let registryCalls = 0
    let proposalCalls = 0
    await expect(
      proposeAgentImprovement({
        runId: 'unmetered-analysis-source',
        profile: {} as AgentProfile,
        analysis: {
          registry: {
            list: () => [],
            run: async () => {
              registryCalls += 1
              throw new Error('proposal sources must fail before analysis runs')
            },
          },
          inputs: {},
          findingsStore: null,
          knowledgeProposalSource: {
            proposeFromFindings: () => {
              proposalCalls += 1
              return { proposals: [], skipped: 0, errors: [] }
            },
          },
        },
      } as never),
    ).rejects.toThrow('measured agent improvement analysis must not run proposal sources')
    expect(registryCalls).toBe(0)
    expect(proposalCalls).toBe(0)
  })

  it('rejects unclassified caller findings before analysis runs', async () => {
    let registryCalls = 0
    await expect(
      proposeAgentImprovement({
        runId: 'unclassified-proposal-finding',
        profile: {} as AgentProfile,
        analysis: {
          registry: {
            list: () => [],
            run: async () => {
              registryCalls += 1
              throw new Error('invalid input must fail before analysis')
            },
          },
          inputs: {},
          findingsStore: null,
        },
        improvement: { ...improvementOptions(), findings: [finding] },
      } as never),
    ).rejects.toThrow(/proposal_origin/)
    expect(registryCalls).toBe(0)
  })

  it('rejects unmetered analysis callbacks before analysis runs', async () => {
    for (const callbacks of [{ onEvent: async () => {} }, { log: () => {} }]) {
      let registryCalls = 0
      await expect(
        proposeAgentImprovement({
          runId: 'unmetered-analysis-callback',
          profile: {} as AgentProfile,
          analysis: {
            registry: {
              list: () => [],
              run: async () => {
                registryCalls += 1
                throw new Error('callbacks must fail before analysis runs')
              },
            },
            inputs: {},
            findingsStore: null,
            ...callbacks,
          },
        } as never),
      ).rejects.toThrow('measured agent improvement analysis must not run callbacks')
      expect(registryCalls).toBe(0)
    }
  })

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
            total_cost_usd: 0.25,
            total_cost_provenance: { kind: 'observed', usd: 0.25 },
          }),
        },
        inputs: {},
        findingsStore: null,
      },
      improvement: { ...improvementOptions(), findings: [searchFinding] },
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
    expect(result.proposal.evaluation.evaluation.preparation.cost.provenance).toBe('estimated')
    expect(result.proposal.evaluation.evaluation.preparation.cost.usd).toBeCloseTo(0.2508)
    expect(result.proposal.evaluation.evaluation.total.cost.usd).toBeCloseTo(
      result.proposal.evaluation.evaluation.preparation.cost.usd +
        result.proposal.evaluation.evaluation.measurement.cost.usd,
    )
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
              total_cost_provenance: { kind: 'observed', usd: 0 },
            }),
          },
          inputs: {},
          findingsStore: null,
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
              total_cost_provenance: { kind: 'observed', usd: 0 },
            }),
          },
          inputs: {},
          findingsStore: null,
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
              total_cost_provenance: { kind: 'observed', usd: 0 },
            }),
          },
          inputs: {},
          findingsStore: null,
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

    expect(executed.sort()).toEqual(
      (['baseline', 'candidate'] as const).flatMap((arm) =>
        Array.from({ length: minimumPairedRuns }, (_, repetition) => `${arm}:${repetition}`),
      ),
    )
    expect(result.measurements).toHaveLength(minimumPairedRuns)
    expect(result.evaluation).toMatchObject({
      experiment: { digest: rig.experiment.digest },
      overall: { baseline: 0, candidate: 1, delta: 1, n: minimumPairedRuns },
      decision: { outcome: 'ship' },
      evaluation: {
        preparation: {
          wallDurationMs: 0,
          cost: { usd: 0, provenance: 'observed' },
        },
      },
    })

    const proposal = createAgentImprovementProposal({
      runId: 'paired-run-1',
      findings: [productionFinding],
      evaluation: result.evaluation,
      now: () => new Date('2026-07-10T01:00:00.000Z'),
    })
    expect(proposal.changedSurfaces).toEqual(['prompt'])
    expect(verifyAgentImprovementProposal(proposal)).toEqual(proposal)
    const { digest: _proposalDigest, ...proposalWithoutDigest } = proposal
    const searchFeedbackProposalWithoutDigest = {
      ...proposalWithoutDigest,
      findings: [searchFinding],
    }
    const searchFeedbackProposal = {
      ...searchFeedbackProposalWithoutDigest,
      digest: canonicalCandidateDigest(searchFeedbackProposalWithoutDigest),
    }
    expect(verifyAgentImprovementProposal(searchFeedbackProposal)).toEqual(searchFeedbackProposal)
    const unclassifiedProposalWithoutDigest = {
      ...proposalWithoutDigest,
      findings: proposal.findings.map(({ proposal_origin: _origin, ...item }) => item),
    }
    const unclassifiedProposal = {
      ...unclassifiedProposalWithoutDigest,
      digest: canonicalCandidateDigest(unclassifiedProposalWithoutDigest),
    }
    expect(() => verifyAgentImprovementProposal(unclassifiedProposal)).toThrow(/proposal_origin/)

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

    expect(result.measurements).toHaveLength(minimumPairedRuns)
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
      findings: [productionFinding],
      evaluation: result.evaluation,
    })

    expect(proposal.changedSurfaces).toEqual(['memory'])
    expect(result.measurements).toHaveLength(minimumPairedRuns)
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
    findings: [productionFinding],
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
