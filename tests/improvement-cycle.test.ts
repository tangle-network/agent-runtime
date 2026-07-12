import { type AnalystFinding, InMemoryTraceStore } from '@tangle-network/agent-eval'
import type {
  DispatchContext,
  JudgeConfig,
  MutableSurface,
  Scenario,
  SurfaceProposer,
} from '@tangle-network/agent-eval/contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalystRegistryLike } from '../src/analyst-loop/types'
import { buildAgentCandidateBundle } from '../src/candidate-execution/builder'
import { InMemoryAgentCandidateExecutionClaimStore } from '../src/candidate-execution/claim'
import { assertCandidateProfileBinding } from '../src/candidate-execution/profile'
import type {
  AgentCandidateExecutorPort,
  AgentCandidateExecutorRequest,
} from '../src/candidate-execution/types'
import {
  createAgentImprovementProposal,
  executeApprovedAgentCandidate,
  proposeAgentImprovement,
  reviewAgentImprovementProposal,
  verifyAgentImprovementProposal,
  verifyAgentImprovementReview,
} from '../src/intelligence/improvement-cycle'
import {
  candidateSha,
  cleanupCandidateFixtures,
  createCandidateExecutionFixture,
  createCandidateOutputFixture,
  unchangedTaskOutcomeCapture,
} from './helpers/candidate-execution-fixture'

interface DemoScenario extends Scenario {
  kind: 'demo'
}

const scenarios: DemoScenario[] = Array.from({ length: 12 }, (_, index) => ({
  id: `scenario-${index}`,
  kind: 'demo' as const,
}))

const finding: AnalystFinding = {
  schema_version: '1.0.0',
  finding_id: 'finding-1',
  analyst_id: 'improvement',
  produced_at: '2026-07-10T00:00:00.000Z',
  severity: 'high',
  area: 'prompt',
  claim: 'The agent omits the required marker.',
  evidence_refs: [{ kind: 'span', id: 'span-1' }],
  recommended_action: 'Add the measured marker.',
  confidence: 0.9,
  subject: 'agent-profile:prompt.systemPrompt',
}

const registry = (findings: AnalystFinding[]): AnalystRegistryLike => ({
  list: () => [{ id: 'improvement' }],
  run: async (runId) => ({
    run_id: runId,
    correlation_id: `correlation-${runId}`,
    started_at: '2026-07-10T00:00:00.000Z',
    ended_at: '2026-07-10T00:00:01.000Z',
    findings,
    per_analyst: [
      {
        analyst_id: 'improvement',
        status: 'ok',
        findings_count: findings.length,
        latency_ms: 1,
        cost_usd: 0,
      },
    ],
    total_cost_usd: 0,
  }),
})

const proposer: SurfaceProposer = {
  kind: 'scripted',
  propose: async () => [
    { surface: 'PROMOTED', label: 'measured winner', rationale: 'addresses finding-1' },
  ],
}

const judge: JudgeConfig<string, DemoScenario> = {
  name: 'literal-marker',
  dimensions: [{ key: 'marker', description: 'Contains the required marker.' }],
  score: ({ artifact }) => {
    const composite = artifact.includes('PROMOTED') ? 1 : 0
    return { dimensions: { marker: composite }, composite, notes: '' }
  },
}

async function agent(
  surface: MutableSurface,
  _scenario: DemoScenario,
  context: DispatchContext,
): Promise<string> {
  context.cost.observe(0.0001, 'fixture')
  context.cost.observeTokens({ input: 1, output: 1 })
  return String(surface)
}

function fixtureProfile() {
  return {
    name: 'candidate',
    prompt: {
      systemPrompt: 'BASELINE',
      instructions: ['Inspect the repository, implement the fix, and run tests.'],
    },
    model: { default: 'provider/model', reasoningEffort: 'high' as const },
    harness: 'codex' as const,
    resources: { failOnError: true as const },
  }
}

function alignedBundle(
  bundle: Omit<ReturnType<typeof createCandidateExecutionFixture>['bundle'], 'digest'>,
  profile: { prompt?: { systemPrompt?: string } },
) {
  return {
    ...bundle,
    profile: {
      ...bundle.profile,
      prompt: {
        ...bundle.profile.prompt,
        systemPrompt: profile.prompt?.systemPrompt,
      },
    },
  }
}

function alignedSealedBundle(
  bundle: Omit<ReturnType<typeof createCandidateExecutionFixture>['bundle'], 'digest'>,
  profile: { prompt?: { systemPrompt?: string } },
) {
  const aligned = alignedBundle(bundle, profile)
  const { profileDiffIds: _profileDiffIds, ...lineage } = aligned.lineage
  return buildAgentCandidateBundle({
    profile: { kind: 'candidate-profile', profile: aligned.profile },
    code: aligned.code,
    execution: aligned.execution,
    ...(aligned.knowledge ? { knowledge: aligned.knowledge } : {}),
    memory: aligned.memory,
    lineage,
  })
}

afterEach(() => {
  cleanupCandidateFixtures()
  vi.restoreAllMocks()
})

describe('agent improvement lifecycle', () => {
  it('refuses memory persistence before human approval', async () => {
    const writeBack = vi.fn()
    await expect(
      proposeAgentImprovement({
        runId: 'analysis-run-memory-writeback',
        profile: fixtureProfile(),
        analysis: { registry: registry([finding]), inputs: {}, findingsStore: null, log: () => {} },
        improvement: {
          surface: 'memory',
          memory: {
            document: '# Durable memory\n',
            writeBack,
          },
          generator: proposer,
          scenarios,
          judge,
          agent,
          budget: { generations: 1, populationSize: 1, holdoutFraction: 0.5 },
        },
      }),
    ).rejects.toThrow('cannot write memory before human approval')
    expect(writeBack).not.toHaveBeenCalled()
  })

  it('binds typed candidate hooks to their equivalent measured profile commands', () => {
    expect(() =>
      assertCandidateProfileBinding(
        {
          hooks: {
            beforeTool: [
              {
                command: "node 'path with space.js'",
                timeoutMs: 1_000,
                env: { MODE: 'check' },
              },
            ],
          },
        },
        {
          hooks: {
            beforeTool: [
              {
                executable: 'node',
                args: [{ kind: 'public', value: 'path with space.js' }],
                timeoutMs: 1_000,
                env: { MODE: { kind: 'public', value: 'check' } },
              },
            ],
          },
        },
      ),
    ).not.toThrow()
  })

  it('analyzes, measures, approves, executes, grades, and links one exact receipt', async () => {
    const fixture = createCandidateExecutionFixture()
    const { digest: _digest, ...bundleInput } = fixture.bundle
    const profile = fixtureProfile()
    const proposed = await proposeAgentImprovement({
      runId: 'analysis-run-1',
      profile,
      analysis: { registry: registry([finding]), inputs: {}, findingsStore: null, log: () => {} },
      improvement: {
        surface: 'prompt',
        generator: proposer,
        scenarios,
        judge,
        agent,
        budget: { generations: 1, populationSize: 2, reps: 3, holdoutFraction: 0.5 },
      },
      buildCandidate: ({ improvement }) => alignedSealedBundle(bundleInput, improvement.profile),
      now: () => new Date('2026-07-10T01:00:00.000Z'),
    })

    expect(proposed.proposal.evaluation.gateDecision).toBe('ship')
    expect(proposed.proposal.evaluation.lift).toBeGreaterThan(0)
    expect(proposed.proposal.findings).toEqual([finding])
    expect(proposed.proposal.candidateProfile.prompt?.systemPrompt).toBe('PROMOTED')
    expect(proposed.proposal.candidateBundle?.digest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(verifyAgentImprovementProposal(proposed.proposal)).toEqual(proposed.proposal)
    expect(
      createAgentImprovementProposal({
        runId: 'analysis-run-1',
        surface: 'prompt',
        baselineProfile: profile,
        candidateProfile: proposed.improvement.profile,
        findings: proposed.analysis.analystResult.findings,
        evaluation: proposed.improvement.raw,
        candidateBundle: proposed.proposal.candidateBundle,
        now: () => new Date('2026-07-10T01:00:00.000Z'),
      }),
    ).toEqual(proposed.proposal)
    expect(() =>
      createAgentImprovementProposal({
        runId: 'analysis-run-unmeasured',
        surface: 'prompt',
        baselineProfile: profile,
        candidateProfile: {
          ...proposed.improvement.profile,
          prompt: { systemPrompt: 'UNMEASURED' },
        },
        findings: proposed.analysis.analystResult.findings,
        evaluation: proposed.improvement.raw,
      }),
    ).toThrow(/does not match the measured winner surface/)
    expect(() =>
      createAgentImprovementProposal({
        runId: 'analysis-run-malformed-profile',
        surface: 'agent-profile',
        baselineProfile: profile,
        candidateProfile: profile,
        findings: proposed.analysis.analystResult.findings,
        evaluation: {
          ...proposed.improvement.raw,
          winner: {
            ...proposed.improvement.raw.winner,
            surface: '{not-json',
          },
        },
      }),
    ).toThrow(/not valid JSON/)

    const review = reviewAgentImprovementProposal(proposed.proposal, {
      decision: 'approve',
      reviewedBy: 'operator@example.com',
      reason: 'Measured winner passed the held-back scenarios.',
      now: () => new Date('2026-07-10T02:00:00.000Z'),
    })
    expect(verifyAgentImprovementReview(review)).toEqual(review)

    const traceStore = new InMemoryTraceStore()
    let request: AgentCandidateExecutorRequest | undefined
    const executor: AgentCandidateExecutorPort = {
      execute: async (input) => {
        request = input
        await traceStore.appendRun({
          runId: input.trace.runId,
          scenarioId: 'approved-candidate',
          startedAt: 100,
          endedAt: 200,
          status: 'completed',
          tags: { ...input.trace.tags },
        })
        return { executionId: input.executionId, termination: { kind: 'exit', exitCode: 0 } }
      },
      stopAndCapture: async () => ({
        stopped: true,
        taskOutcome: unchangedTaskOutcomeCapture(fixture),
      }),
    }
    const outputs = createCandidateOutputFixture()
    const executed = await executeApprovedAgentCandidate({
      proposal: proposed.proposal,
      review,
      authorizeReview: async (candidateReview) => candidateReview.digest === review.digest,
      task: fixture.task,
      ports: fixture.ports,
      execution: {
        executor,
        traceStore,
        claimStore: new InMemoryAgentCandidateExecutionClaimStore(),
        ...outputs,
      },
    })

    expect(request).toBeDefined()
    expect(executed.finalization.succeeded).toBe(true)
    expect(executed.evidence).toMatchObject({
      proposalDigest: proposed.proposal.digest,
      reviewDigest: review.digest,
      bundleDigest: proposed.proposal.candidateBundle?.digest,
      executionId: fixture.task.executionId,
      succeeded: true,
      runReceiptDigest: expect.stringMatching(/^sha256:/),
    })
  })

  it('records rejection and refuses to execute it', async () => {
    const fixture = createCandidateExecutionFixture()
    const { digest: _digest, ...bundleInput } = fixture.bundle
    const proposed = await proposeAgentImprovement({
      runId: 'analysis-run-2',
      profile: fixtureProfile(),
      analysis: { registry: registry([finding]), inputs: {}, findingsStore: null, log: () => {} },
      improvement: {
        surface: 'prompt',
        generator: proposer,
        scenarios,
        judge,
        agent,
        budget: { generations: 1, populationSize: 2, reps: 3, holdoutFraction: 0.5 },
      },
      buildCandidate: ({ improvement }) => alignedBundle(bundleInput, improvement.profile),
    })
    const review = reviewAgentImprovementProposal(proposed.proposal, {
      decision: 'reject',
      reviewedBy: 'operator@example.com',
      reason: 'The change is not appropriate for this deployment.',
      feedback: 'Keep the baseline behavior.',
    })

    await expect(
      executeApprovedAgentCandidate({
        proposal: proposed.proposal,
        review,
        authorizeReview: async () => true,
        task: fixture.task,
        ports: fixture.ports,
        execution: {
          executor: {
            execute: async () => {
              throw new Error('must not execute')
            },
            stopAndCapture: async () => ({ stopped: true }),
          },
          traceStore: new InMemoryTraceStore(),
          claimStore: new InMemoryAgentCandidateExecutionClaimStore(),
          ...createCandidateOutputFixture(),
        },
      }),
    ).rejects.toThrow('not an approval')
  })

  it('rejects a sealed build candidate whose digest was tampered', async () => {
    const fixture = createCandidateExecutionFixture()
    const { digest: _digest, ...bundleInput } = fixture.bundle

    await expect(
      proposeAgentImprovement({
        runId: 'analysis-run-tampered-bundle',
        profile: fixtureProfile(),
        analysis: { registry: registry([finding]), inputs: {}, findingsStore: null, log: () => {} },
        improvement: {
          surface: 'prompt',
          generator: proposer,
          scenarios,
          judge,
          agent,
          budget: { generations: 1, populationSize: 2, reps: 3, holdoutFraction: 0.5 },
        },
        buildCandidate: ({ improvement }) => ({
          ...alignedSealedBundle(bundleInput, improvement.profile),
          digest: candidateSha('0'),
        }),
      }),
    ).rejects.toThrow('built candidate bundle digest is invalid')
  })

  it('refuses a structurally valid approval that its authority does not recognize', async () => {
    const fixture = createCandidateExecutionFixture()
    const { digest: _digest, ...bundleInput } = fixture.bundle
    const proposed = await proposeAgentImprovement({
      runId: 'analysis-run-unauthorized',
      profile: fixtureProfile(),
      analysis: { registry: registry([finding]), inputs: {}, findingsStore: null, log: () => {} },
      improvement: {
        surface: 'prompt',
        generator: proposer,
        scenarios,
        judge,
        agent,
        budget: { generations: 1, populationSize: 2, reps: 3, holdoutFraction: 0.5 },
      },
      buildCandidate: ({ improvement }) => alignedBundle(bundleInput, improvement.profile),
    })
    const review = reviewAgentImprovementProposal(proposed.proposal, {
      decision: 'approve',
      reviewedBy: 'forged@example.com',
      reason: 'Self-authored approval.',
    })

    await expect(
      executeApprovedAgentCandidate({
        proposal: proposed.proposal,
        review,
        authorizeReview: async () => false,
        task: fixture.task,
        ports: fixture.ports,
        execution: {
          executor: {
            execute: async () => {
              throw new Error('must not execute')
            },
            stopAndCapture: async () => ({ stopped: true }),
          },
          traceStore: new InMemoryTraceStore(),
          claimStore: new InMemoryAgentCandidateExecutionClaimStore(),
          ...createCandidateOutputFixture(),
        },
      }),
    ).rejects.toThrow('not authorized')
  })

  it('rejects judge-derived findings before they can steer a proposal', async () => {
    await expect(
      proposeAgentImprovement({
        runId: 'analysis-run-3',
        profile: fixtureProfile(),
        analysis: {
          registry: registry([{ ...finding, derived_from_judge: true }]),
          inputs: {},
          findingsStore: null,
          log: () => {},
        },
        improvement: {
          surface: 'prompt',
          generator: proposer,
          scenarios,
          judge,
          agent,
          budget: { generations: 1, populationSize: 2, reps: 3, holdoutFraction: 0.5 },
        },
      }),
    ).rejects.toThrow(/judge/i)
  })
})
