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
  createAgentImprovementActivation,
  createAgentImprovementActivationResult,
  createAgentImprovementProposal,
  executeAgentImprovementActivation,
  reviewAgentImprovementProposal,
  verifyAgentImprovementActivation,
  verifyAgentImprovementProposal,
  verifyAgentImprovementReview,
} from '../src/intelligence/activation'
import {
  type AgentImprovementExperimentMaterial,
  executeAgentCandidateExperimentCell,
  proposeAgentImprovement,
  proposeAgentProfileImprovement,
  runAgentCandidateExperiment,
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
  executeCandidateExperimentInput,
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

import { trainedProfile } from './helpers/trained-profile'

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
        improvement: { surface: 'memory' },
      } as never),
    ).rejects.toThrow(/supports profile surfaces or a complete agent profile/)
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
      improvement: { ...improvement, findings: [searchFinding] },
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
    expect(result.proposal.findings).toEqual([searchFinding, productionFinding])
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

  for (const arm of ['baseline', 'selected'] as const) {
    it(`refuses ${arm} training exposure to the release suite before measurement`, async () => {
      const template = createProfileImprovementFixture()
      const { digest: _digest, ...task } = template.evaluation.experiment.benchmark.tasks[0]!
      const { agent: optimize, executionRef, ...improvement } = improvementOptions()
      const untrained: AgentProfile = { prompt: { systemPrompt: 'BASELINE' } }
      const exposure = [{ benchmark: 'export', task: 'alias', contentDigest: task.scenario.digest }]
      const profile = arm === 'baseline' ? trainedProfile(untrained, exposure) : untrained
      const candidate = trainedProfile({ prompt: { systemPrompt: 'PROMOTED' } }, exposure)
      const stateDigest = ({ profile: value }: { identity: string; profile: AgentProfile }) =>
        canonicalCandidateDigest(value)
      let analysisCalls = 0
      let methodCalls = 0
      let measured = 0
      await expect(
        proposeAgentProfileImprovement({
          runId: `trained-release-${arm}`,
          budgetUsd: minimumPairedRuns * 2 + 1,
          source: {
            kind: 'platform-agent-profile',
            sourceIdentity: 'profile-support',
            sourceDigest: stateDigest({ identity: 'profile-support', profile }),
            sourceRevision: 7,
          },
          profile,
          stateDigest,
          analysis: {
            registry: {
              list: () => [{ id: 'improvement' }],
              run: async () => {
                analysisCalls++
                return {
                  run_id: 'training-exposure',
                  correlation_id: 'training-exposure',
                  started_at: '2026-07-27T00:00:00.000Z',
                  ended_at: '2026-07-27T00:00:01.000Z',
                  findings: [finding],
                  per_analyst: [],
                  total_cost_usd: 0,
                  total_cost_provenance: { kind: 'observed' as const, usd: 0 },
                }
              },
            },
            inputs: {},
            findingsStore: null,
          },
          improvement: {
            ...improvement,
            surface: 'agent-profile',
            method: {
              name: 'trained-candidate',
              async optimize() {
                methodCalls++
                return {
                  winnerSurface: JSON.stringify(candidate),
                  cost: {
                    totalCostUsd: 0,
                    costProvenance: { kind: 'observed', usd: 0 },
                    accountingComplete: true,
                    incompleteReasons: [],
                  },
                }
              },
            },
          },
          benchmark: {
            tasks: [task],
            reps: minimumPairedRuns,
            seeds: Array.from({ length: minimumPairedRuns }, (_, i) => i + 51) as [
              number,
              ...number[],
            ],
            policy: template.evaluation.experiment.policy,
          },
          executor: {
            executionRef: {
              kind: 'agent-profile-improvement-execution-ref',
              identity: 'test',
              digest: executionRef,
            },
            optimize,
            measure: async (input) => {
              measured++
              return createProfileImprovementRunReceipt(input, input.arm === 'candidate' ? 1 : 0)
            },
          },
        }),
      ).rejects.toThrow(/training exposure/)
      expect(measured).toBe(0)
      expect(analysisCalls).toBe(arm === 'baseline' ? 0 : 1)
      expect(methodCalls).toBe(arm === 'baseline' ? 0 : 1)
    })
  }

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

  it('rejects final-evaluation input before analysis runs', async () => {
    let registryCalls = 0
    await expect(
      proposeAgentImprovement({
        runId: 'judge-input',
        profile: {} as AgentProfile,
        analysis: {
          registry: {
            list: () => [],
            run: async () => {
              registryCalls += 1
              throw new Error('judge input must fail before analysis')
            },
          },
          inputs: { judgeInput: {} },
          findingsStore: null,
        },
      } as never),
    ).rejects.toThrow('measured agent improvement analysis must not receive judge input')
    expect(registryCalls).toBe(0)
  })

  it('rejects judge-derived production analysis before optimization', async () => {
    await expect(
      proposeAgentImprovement({
        runId: 'judge-derived-analysis',
        profile: {} as AgentProfile,
        analysis: {
          registry: {
            list: () => [{ id: 'improvement' }],
            run: async () => ({
              run_id: 'judge-derived-analysis',
              correlation_id: 'judge-derived-analysis',
              started_at: '2026-07-10T00:00:00.000Z',
              ended_at: '2026-07-10T00:00:01.000Z',
              findings: [{ ...finding, derived_from_judge: true }],
              per_analyst: [],
              total_cost_usd: 0,
              total_cost_provenance: { kind: 'observed', usd: 0 },
            }),
          },
          inputs: {},
          findingsStore: null,
        },
        improvement: improvementOptions(),
      } as never),
    ).rejects.toThrow(/must not produce judge-derived findings/)
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
    expect(result.proposal.findings).toEqual([searchFinding, productionFinding])
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
  })

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

  it.each([
    {
      intent: 'replacement',
      prompt: { systemPrompt: 'Use the measured Prime instructions.' },
      file: '.tangle/system-prompt.md',
    },
    {
      intent: 'addition',
      prompt: { appendSystemPrompt: 'Keep the native prompt and add measured instructions.' },
      file: '.tangle/append-system-prompt.md',
    },
  ] as const)(
    'verifies Prime $intent prompt evidence through the executed cell',
    async (testCase) => {
      const base = candidateBundle({
        harness: 'prime',
        launch: { kind: 'container-command', executable: 'prime-agent' },
      })
      const baseline = redigestCandidateBundle(base, {
        profile: {
          ...base.profile,
          harness: 'prime',
        },
      })
      const candidate = redigestCandidateBundle(baseline, {
        profile: {
          ...baseline.profile,
          prompt: { ...baseline.profile.prompt, ...testCase.prompt },
        },
      })
      const rig = createCandidateExperimentFixture({ baseline, candidate })
      const task = rig.experiment.benchmark.tasks[0]
      if (!task) throw new Error('expected candidate benchmark task')
      const benchmarkCell = {
        suiteDigest: rig.experiment.benchmark.suite.digest,
        taskIndex: 0,
        repetition: 0,
      }
      const input = {
        experiment: rig.experiment,
        arm: 'candidate' as const,
        bundle: rig.experiment.candidate,
        task,
        benchmarkCell,
        seed: 101,
      }
      const evidence = await executeCandidateExperimentInput(
        input,
        rig.placeCell,
        executeAgentCandidateExperimentCell,
      )

      expect(
        evidence.materializationReceipt.profileActivation.files.map((file) => file.path),
      ).toContain(testCase.file)
      expect(
        verifyCandidateExecutionEvidence(evidence, {
          experiment: rig.experiment,
          arm: 'candidate',
          benchmarkCell,
          seed: 101,
        }),
      ).toEqual(evidence)
    },
  )

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
})

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
