import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import {
  type CostLedgerHandle,
  minimumPairsForPairedDeltaTest,
  type ProposalFinding,
} from '@tangle-network/agent-eval'
import { campaignScenarioIdentity, gitWorktreeAdapter } from '@tangle-network/agent-eval/campaign'
import {
  sealAgentProfileImprovementTask,
  sealCandidateBenchmarkSuite,
  sealCandidateBenchmarkTask,
} from '@tangle-network/agent-eval/contract'
import {
  type AgentProfile,
  agentProfileImprovementExpectedModel,
} from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildAgentCandidateBundle,
  captureAgentCodeCandidateWorkspace,
} from '../src/candidate-execution'
import {
  canonicalCandidateDigest,
  embeddedCandidateArtifact,
} from '../src/candidate-execution/digest'
import {
  agentCandidateProfileAsAgentProfile,
  freezeGenericAgentCandidateProfile,
} from '../src/candidate-execution/profile'
import type { ReadonlyAgentProfile } from '../src/improvement'
import { proposeAgentProfileImprovement as proposeProfile } from '../src/intelligence'
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
  createCandidateExecutionFixture,
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
import { makeTempRoot } from './helpers/temp-root'
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
  it('defers code-search final cases and measures the exact finalized trees only through the outer experiment', async () => {
    // This producer is an actual deterministic child process, not an LLM.
    // Its zero inference cost does not qualify subscription model execution.
    const source = createCandidateExecutionFixture(true)
    const repoRoot = source.task.stagingRoots.taskRoot
    const directory = makeTempRoot('deferred-code-lifecycle-')
    const profile = agentCandidateProfileAsAgentProfile(source.bundle.profile)
    let measured: CandidateExperimentFixture | undefined
    const scored: string[] = []
    const cells: string[] = []
    try {
      const result = await proposeAgentImprovement<{ id: string; kind: string }, string>({
        runId: 'deferred-code-lifecycle',
        profile,
        analysis: {
          registry: {
            list: () => [],
            run: async () => ({
              run_id: 'deferred-code-lifecycle',
              correlation_id: 'deferred-code-lifecycle',
              started_at: '2026-07-10T00:00:00.000Z',
              ended_at: '2026-07-10T00:00:00.000Z',
              findings: [],
              per_analyst: [],
              total_cost_usd: 0,
              total_cost_provenance: { kind: 'observed', usd: 0 },
            }),
          },
          inputs: {},
          findingsStore: null,
        },
        improvement: {
          surface: 'code',
          runDir: join(directory, 'search'),
          scenarios: [{ id: 'code-train', kind: 'deterministic-code' }],
          model: 'deterministic-child@2026-11-12',
          expectUsage: 'off',
          budget: { generations: 1, populationSize: 1, reps: 1, holdout: 'deferred' },
          analyzeGeneration: null,
          agent: async (surface, scenario) => {
            scored.push(scenario.id)
            if (typeof surface !== 'object' || surface.kind !== 'code')
              throw new Error('expected code')
            return readFileSync(join(surface.worktreeRef, 'source.ts'), 'utf8')
          },
          judge: {
            name: 'deterministic-code-read',
            dimensions: [{ key: 'quality', description: 'Exact code bytes' }],
            score: ({ artifact }) => {
              const score = artifact === 'export const value = 2\n' ? 1 : 0
              return { dimensions: { quality: score }, composite: score, notes: '' }
            },
          },
          code: {
            repoRoot,
            baseRef: 'HEAD',
            worktreeDir: join(directory, 'worktrees'),
            profile: { ...profile, model: { ...profile.model, provider: 'offline' } },
            generator: {
              kind: 'deterministic-child',
              proposesWithoutFindings: true,
              async generate({ worktreePath }) {
                execFileSync(
                  process.execPath,
                  [
                    '-e',
                    "require('node:fs').writeFileSync('source.ts','export const value = 2\\n')",
                  ],
                  { cwd: worktreePath },
                )
                return { applied: true, summary: 'Correct exact code value' }
              },
            },
          },
        },
        buildExperiment: async ({ improvement }) => {
          if (improvement.mode !== 'code') throw new Error('expected code result')
          expect(improvement.decision).toBe('hold')
          expect(improvement.lift).toBeUndefined()
          expect(improvement.raw.raw.holdout).toBe('deferred')
          const surface = improvement.candidate.value
          if (typeof surface !== 'object' || surface.kind !== 'code')
            throw new Error('expected code winner')
          const adapter = gitWorktreeAdapter({ repoRoot, worktreeDir: join(directory, 'baseline') })
          const baseline = await adapter.create({
            baseRef: surface.baseCommit,
            label: 'outer-baseline',
          })
          try {
            const before = await adapter.finalize(baseline, 'Unchanged outer baseline')
            const compile = async (exact: typeof surface) => {
              const code = {
                kind: 'code-surface' as const,
                surface: exact,
                repository: { kind: 'github' as const, owner: 'owner', repo: 'repo' },
              }
              const workspace = await captureAgentCodeCandidateWorkspace(code)
              return buildAgentCandidateBundle({
                profile: { kind: 'candidate-profile', profile: source.bundle.profile },
                code,
                execution: { ...source.bundle.execution, workspace: workspace.snapshot },
                memory: source.bundle.memory,
              })
            }
            measured = createCandidateExperimentFixture({
              baseline: await compile(before),
              candidate: await compile(surface),
              configureFixture: (fixture) => {
                fixture.ports.repositories.resolve = async () => repoRoot
              },
              scoreForRequest: (request) => {
                const bytes = request.inputs.candidate?.files.find(
                  (file) => file.path === 'source.ts',
                )?.bytes
                return bytes && Buffer.from(bytes).toString('utf8') === 'export const value = 2\n'
                  ? 1
                  : 0
              },
            })
            return candidateExperimentMaterial(measured.experiment)
          } finally {
            await adapter.discard(baseline)
          }
        },
        placeCell: (input) => {
          if (!measured) throw new Error('expected sealed code experiment')
          const placement = measured.placeCell(input)
          const candidateRoot = makeTempRoot('deferred-code-cell-')
          cells.push(candidateRoot)
          return {
            ...placement,
            executionRoots: { ...placement.executionRoots, candidateRoot: '/workspace/candidate' },
            stagingRoots: { ...placement.stagingRoots, candidateRoot },
          }
        },
      })
      try {
        expect(scored.length).toBeGreaterThan(0)
        expect(new Set(scored)).toEqual(new Set(['code-train']))
        expect(result.improvement.decision).toBe('hold')
        expect(result.experiment.candidateLineage.runIds).toContain(
          result.improvement.lineage.runId,
        )
        expect(result.measurements.length).toBeGreaterThan(0)
        expect(result.proposal.evaluation).toBeDefined()
        expect(readFileSync(join(repoRoot, 'source.ts'), 'utf8')).not.toContain('value = 2')
      } finally {
        await result.improvement.dispose()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
      for (const root of cells) rmSync(root, { recursive: true, force: true })
    }
  }, 120_000)

  it('seals one resolved model treatment and preserves incomplete HTTP measurements without a proposal', async () => {
    // The HTTP peer is a deterministic process boundary, not a model service.
    const template = createProfileImprovementFixture()
    const { digest: _taskDigest, ...task } = template.evaluation.experiment.benchmark.tasks[0]!
    const baselineModel = task.model
    const baseline: AgentProfile = {
      name: 'support-agent',
      harness: 'cli-base',
      model: {
        default: baselineModel.requested,
        provider: baselineModel.provider,
        reasoningEffort: baselineModel.reasoningEffort,
      },
      prompt: { systemPrompt: 'BASELINE' },
    }
    const candidate: AgentProfile = {
      ...baseline,
      model: {
        ...baseline.model,
        default: 'anthropic/candidate-model-2026-11-12',
        reasoningEffort: 'high',
      },
      prompt: { systemPrompt: 'PROMOTED' },
    }
    const candidateModel = {
      ...baselineModel,
      requested: candidate.model!.default!,
      model: 'candidate-model-2026-11-12',
      snapshot: '2026-11-12',
      reasoningEffort: 'high' as const,
    }
    let missingIdentity = false
    let wrongObservedModel = false
    let incomplete = false
    let resolverCalls = 0
    const measured: string[] = []
    const server = createServer(async (request, response) => {
      let bytes = ''
      for await (const chunk of request) bytes += chunk
      const body = bytes ? JSON.parse(bytes) : {}
      const value =
        request.url === '/candidate'
          ? candidate
          : request.url === '/resolve'
            ? {
                kind: 'profile-default',
                baseline: { authored: body.baseline.model, resolved: baselineModel },
                candidate: {
                  authored: body.candidate.model,
                  resolved: { ...candidateModel, ...(missingIdentity ? { snapshot: null } : {}) },
                },
              }
            : wrongObservedModel
              ? baselineModel
              : body.profile.model.default === baselineModel.requested
                ? baselineModel
                : candidateModel
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(value))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    const call = async (path: string, body: unknown) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(`HTTP identity peer refused ${response.status}`)
      return response.json()
    }
    const stateDigest = ({ profile }: { identity: string; profile: AgentProfile }) =>
      canonicalCandidateDigest(profile)
    const options = () => {
      const { agent: optimize, executionRef, ...improvement } = improvementOptions()
      return {
        runId: 'profile-http-model-lifecycle',
        source: {
          kind: 'platform-agent-profile',
          sourceIdentity: 'profile-support',
          sourceDigest: stateDigest({ identity: 'profile-support', profile: baseline }),
          sourceRevision: 1,
        },
        profile: baseline,
        stateDigest,
        budgetUsd: minimumPairedRuns * 2 + 1,
        analysis: {
          registry: {
            list: () => [{ id: 'improvement' }],
            run: async () => ({
              run_id: 'profile-http-model-lifecycle',
              correlation_id: 'profile-http-model-lifecycle',
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
        improvement: {
          ...improvement,
          surface: 'agent-profile' as const,
          method: {
            name: 'http-complete-profile',
            optimize: async () => ({
              winnerSurface: JSON.stringify(await call('/candidate', {})),
              cost: {
                totalCostUsd: 0,
                costProvenance: { kind: 'observed' as const, usd: 0 },
                accountingComplete: true,
                incompleteReasons: [],
              },
            }),
          },
        },
        benchmark: {
          tasks: [task] as [typeof task],
          reps: minimumPairedRuns,
          seeds: Array.from({ length: minimumPairedRuns }, (_, index) => index + 41) as [
            number,
            ...number[],
          ],
          policy: template.evaluation.experiment.policy,
        },
        modelBinding: async (profiles: {
          baseline: ReadonlyAgentProfile
          candidate: ReadonlyAgentProfile
        }) => {
          resolverCalls++
          expect(Object.isFrozen(profiles.baseline)).toBe(true)
          expect(Object.isFrozen(profiles.candidate.model)).toBe(true)
          expect(Reflect.set(profiles.candidate.model!, 'default', 'unmeasured')).toBe(false)
          return call('/resolve', profiles)
        },
        executor: {
          executionRef: {
            kind: 'agent-profile-improvement-execution-ref' as const,
            identity: 'http-profile-executor',
            digest: executionRef,
          },
          optimize,
          measure: async (
            input: Parameters<typeof createProfileImprovementRunReceipt>[0] & {
              profile: AgentProfile
            },
          ) => {
            expect(Object.isFrozen(input.profile)).toBe(true)
            expect(Object.isFrozen(input.experiment)).toBe(true)
            const expected = agentProfileImprovementExpectedModel(
              input.experiment,
              input.task,
              input.arm,
              input.profile,
            )
            const observed = await call('/execute', { profile: input.profile })
            measured.push(input.arm)
            expect(expected.requested).toBe(input.profile.model!.default)
            const { digest: _digest, ...material } = createProfileImprovementRunReceipt(
              input,
              input.arm === 'candidate' ? 1 : 0,
            )
            const record = {
              ...material,
              resolvedModel: observed,
              ...(incomplete
                ? {
                    usage: {
                      availability: 'unavailable' as const,
                      reason: 'Native cache, reasoning and billing unavailable',
                      facts: {
                        inputTokens: material.usage.inputTokens,
                        outputTokens: material.usage.outputTokens,
                        cachedInputTokens: null,
                        reasoningTokens: null,
                        modelCalls: material.usage.modelCalls,
                        costUsdNanos: null,
                        costProvenance: null,
                      },
                    },
                  }
                : {}),
            }
            return { ...record, digest: canonicalCandidateDigest(record) }
          },
        },
      }
    }
    try {
      const complete = await proposeProfile({ ...options(), allowIncomplete: true })
      if ('status' in complete) throw new Error('Unexpected incomplete HTTP identity proof')
      expect(resolverCalls).toBe(1)
      expect(complete.proposal.evaluation.decision.outcome).toBe('ship')
      expect(
        complete.measurements.every(
          (pair) => pair.baseline.resolvedModel.model !== pair.candidate.resolvedModel.model,
        ),
      ).toBe(true)
      await complete.improvement.dispose()
      incomplete = true
      const retained = await proposeProfile({ ...options(), allowIncomplete: true })
      if (!('status' in retained)) throw new Error('Expected explicit incomplete outcome')
      expect(resolverCalls).toBe(2)
      expect(retained.status).toBe('incomplete')
      expect(retained.decision).toBe('hold')
      expect('proposal' in retained).toBe(false)
      expect(retained.measurements).toHaveLength(minimumPairedRuns)
      expect(retained.measurement.cost).toBeNull()
      const accounting = retained.measurements[0]!.candidate.usage
      if (!('availability' in accounting)) throw new Error('Missing native accounting gaps')
      expect(accounting.facts.inputTokens).toBe(10)
      expect(accounting.facts.cachedInputTokens).toBeNull()
      expect(accounting.facts.costUsdNanos).toBeNull()
      expect(() => verifyAgentImprovementProposal(retained)).toThrow()
      await retained.improvement.dispose()
      const beforeMissing = measured.length
      missingIdentity = true
      await expect(proposeProfile({ ...options(), allowIncomplete: true })).rejects.toThrow()
      expect(measured).toHaveLength(beforeMissing)
      missingIdentity = false
      incomplete = false
      wrongObservedModel = true
      await expect(proposeProfile({ ...options(), allowIncomplete: true })).rejects.toThrow(
        /task contract/,
      )
      wrongObservedModel = false
      const reused = options()
      const identity = campaignScenarioIdentity(reused.improvement.trainScenarios![0]!)
      const beforeReuse = measured.length
      const beforeResolve = resolverCalls
      await expect(
        proposeProfile({
          ...reused,
          allowIncomplete: true,
          benchmark: {
            ...reused.benchmark,
            tasks: [
              {
                ...task,
                scenario: { id: identity.id, kind: identity.kind, digest: identity.scenarioDigest },
              },
            ],
          },
        }),
      ).rejects.toThrow(/reuses/)
      expect(resolverCalls).toBe(beforeResolve)
      expect(measured).toHaveLength(beforeReuse)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
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
