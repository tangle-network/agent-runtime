import { type AnalystFinding, InMemoryTraceStore } from '@tangle-network/agent-eval'
import type {
  CodeSurface,
  DispatchContext,
  JudgeConfig,
  MutableSurface,
  Scenario,
  SurfaceProposer,
} from '@tangle-network/agent-eval/contract'
import type { CandidateExecutionEvidence } from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalystRegistryLike } from '../src/analyst-loop/types'
import { buildAgentCandidateBundle } from '../src/candidate-execution/builder'
import { sealAgentCandidateBundle } from '../src/candidate-execution/bundle'
import { InMemoryAgentCandidateExecutionClaimStore } from '../src/candidate-execution/claim'
import {
  canonicalCandidateDocument,
  embeddedCandidateArtifact,
} from '../src/candidate-execution/digest'
import { assertCandidateProfileBinding } from '../src/candidate-execution/profile'
import type {
  AgentCandidateExecutorPort,
  AgentCandidateExecutorRequest,
} from '../src/candidate-execution/types'
import {
  createAgentImprovementMeasuredComparison,
  createAgentImprovementProposal,
  executeApprovedAgentCandidate,
  proposeAgentImprovement,
  reviewAgentImprovementProposal,
  verifyAgentImprovementProposal,
  verifyAgentImprovementReview,
  verifyCandidateExecutionEvidence,
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

    expect(proposed.proposal.evaluation.decision.outcome).toBe('ship')
    expect(proposed.proposal.evaluation.overall.delta).toBeGreaterThan(0)
    expect(proposed.proposal.changedSurfaces).toEqual(['prompt'])
    expect(proposed.proposal.findings).toEqual([finding])
    expect(proposed.proposal.candidateBundle?.profile.prompt?.systemPrompt).toBe('PROMOTED')
    expect(proposed.proposal.candidateBundle?.digest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(verifyAgentImprovementProposal(proposed.proposal)).toEqual(proposed.proposal)
    expect(() =>
      verifyAgentImprovementProposal({ ...proposed.proposal, runId: 'tampered-run' }),
    ).toThrow(/proposal digest does not match/)
    expect(
      createAgentImprovementProposal({
        runId: 'analysis-run-1',
        baselineProfile: profile,
        findings: proposed.analysis.analystResult.findings,
        evaluation: proposed.proposal.evaluation,
        candidateBundle: proposed.proposal.candidateBundle,
        now: () => new Date('2026-07-10T01:00:00.000Z'),
      }),
    ).toEqual(proposed.proposal)
    expect(() =>
      createAgentImprovementProposal({
        runId: 'analysis-run-unmeasured',
        baselineProfile: profile,
        findings: proposed.analysis.analystResult.findings,
        evaluation: proposed.proposal.evaluation,
        candidateBundle: alignedBundle(bundleInput, {
          ...proposed.improvement.profile,
          prompt: { systemPrompt: 'UNMEASURED' },
        }),
      }),
    ).toThrow(/does not bind the exact candidate bundle/)
    expect(() =>
      createAgentImprovementProposal({
        runId: 'analysis-run-baseline-drift',
        baselineProfile: { ...profile, name: 'different-baseline' },
        findings: proposed.analysis.analystResult.findings,
        evaluation: proposed.proposal.evaluation,
        candidateBundle: proposed.proposal.candidateBundle,
      }),
    ).toThrow(/does not bind the included baseline profile/)

    const firstMeasuredCell = proposed.improvement.raw.raw.baselineOnHoldout.cells[0]
    if (!firstMeasuredCell) throw new Error('expected a measured heldout cell')
    const primaryObjective = Object.keys(firstMeasuredCell.judgeScores)[0]
    const primaryScore = primaryObjective
      ? firstMeasuredCell.judgeScores[primaryObjective]
      : undefined
    const primaryDimension = primaryScore ? Object.keys(primaryScore.dimensions)[0] : undefined
    if (!primaryObjective || !primaryScore || !primaryDimension) {
      throw new Error('expected a measured objective and dimension')
    }
    const addSecondJudge = (cell: typeof firstMeasuredCell) => ({
      ...cell,
      judgeScores: {
        ...cell.judgeScores,
        secondary: {
          composite: cell.judgeScores[primaryObjective]!.composite,
          dimensions: { ...cell.judgeScores[primaryObjective]!.dimensions },
        },
      },
    })
    const multiJudgeResult = {
      ...proposed.improvement.raw,
      raw: {
        ...proposed.improvement.raw.raw,
        baselineOnHoldout: {
          ...proposed.improvement.raw.raw.baselineOnHoldout,
          cells: proposed.improvement.raw.raw.baselineOnHoldout.cells.map(addSecondJudge),
        },
        winnerOnHoldout: {
          ...proposed.improvement.raw.raw.winnerOnHoldout,
          cells: proposed.improvement.raw.raw.winnerOnHoldout.cells.map(addSecondJudge),
        },
      },
    }
    const multiJudgeComparison = createAgentImprovementMeasuredComparison({
      result: multiJudgeResult,
      measuredSurface: 'prompt',
      baselineProfile: profile,
      candidateBundle: proposed.proposal.candidateBundle,
    })
    expect(multiJudgeComparison.objectives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'objective', name: primaryObjective }),
        expect.objectContaining({ kind: 'objective', name: 'secondary' }),
        expect.objectContaining({
          kind: 'dimension',
          objective: primaryObjective,
          name: primaryDimension,
        }),
        expect.objectContaining({
          kind: 'dimension',
          objective: 'secondary',
          name: primaryDimension,
        }),
      ]),
    )

    const compoundProfile = {
      ...proposed.improvement.profile,
      tools: { inspect_repository: true },
    }
    const compoundInput = alignedBundle(bundleInput, compoundProfile)
    const compoundBundle = sealAgentCandidateBundle({
      ...compoundInput,
      profile: { ...compoundInput.profile, tools: compoundProfile.tools },
    })
    const compoundComparison = createAgentImprovementMeasuredComparison({
      result: {
        ...proposed.improvement.raw,
        winner: {
          ...proposed.improvement.raw.winner,
          surface: JSON.stringify(compoundProfile),
        },
      },
      measuredSurface: 'agent-profile',
      baselineProfile: profile,
      candidateBundle: compoundBundle,
    })
    const compoundProposal = createAgentImprovementProposal({
      runId: 'analysis-run-compound-profile',
      baselineProfile: profile,
      findings: proposed.analysis.analystResult.findings,
      evaluation: compoundComparison,
      candidateBundle: compoundBundle,
    })
    expect(compoundProposal.changedSurfaces).toEqual(['prompt', 'tools'])
    const { digest: _compoundDigest, ...compoundWithoutDigest } = compoundProposal
    const omittedSurfaceProposal = canonicalCandidateDocument<typeof compoundProposal>({
      ...compoundWithoutDigest,
      changedSurfaces: ['prompt'],
    }).value
    expect(() => verifyAgentImprovementProposal(omittedSurfaceProposal)).toThrow(
      /changed surfaces do not match/,
    )

    const codeFixture = createCandidateExecutionFixture(true)
    const { digest: _codeDigest, ...codeBundleInput } = codeFixture.bundle
    if (!codeFixture.task.repository) throw new Error('expected repository fixture')
    const patch = Buffer.from('diff --git a/source.ts b/source.ts\n', 'utf8')
    const candidateTree = 'f'.repeat(codeFixture.task.repository.baseTree.length)
    const codeSurface: CodeSurface = {
      kind: 'code',
      worktreeRef: '/tmp/measured-code-winner',
      baseRef: 'main',
      baseCommit: codeFixture.task.repository.baseCommit,
      baseTree: codeFixture.task.repository.baseTree,
      candidateCommit: 'e'.repeat(codeFixture.task.repository.baseCommit.length),
      candidateTree,
      patch: {
        format: 'git-diff-binary',
        sha256: embeddedCandidateArtifact(patch).sha256,
        byteLength: patch.byteLength,
      },
    }
    const codeBundle = sealAgentCandidateBundle({
      ...alignedBundle(codeBundleInput, profile),
      code: {
        kind: 'git-patch',
        repository: { kind: 'github', owner: 'owner', repo: 'repo' },
        baseCommit: codeSurface.baseCommit,
        baseTree: codeSurface.baseTree,
        candidateTree: codeSurface.candidateTree,
        patch: { format: 'git-diff-binary', artifact: embeddedCandidateArtifact(patch) },
      },
    })
    const codeResult = {
      ...proposed.improvement.raw,
      winner: { ...proposed.improvement.raw.winner, surface: codeSurface },
    }
    const codeComparison = createAgentImprovementMeasuredComparison({
      result: codeResult,
      measuredSurface: 'code',
      baselineProfile: profile,
      candidateBundle: codeBundle,
    })
    const codeProposal = createAgentImprovementProposal({
      runId: 'analysis-run-code',
      baselineProfile: profile,
      findings: proposed.analysis.analystResult.findings,
      evaluation: codeComparison,
      candidateBundle: codeBundle,
      now: () => new Date('2026-07-10T01:30:00.000Z'),
    })
    expect(codeProposal.changedSurfaces).toEqual(['code'])
    expect(
      reviewAgentImprovementProposal(codeProposal, {
        decision: 'approve',
        reviewedBy: 'operator@example.com',
        reason: 'The measured code winner matches the sealed patch.',
      }).decision,
    ).toBe('approve')
    expect(() =>
      createAgentImprovementMeasuredComparison({
        result: {
          ...codeResult,
          winner: {
            ...codeResult.winner,
            surface: { ...codeSurface, candidateTree: '0'.repeat(candidateTree.length) },
          },
        },
        measuredSurface: 'code',
        baselineProfile: profile,
        candidateBundle: codeBundle,
      }),
    ).toThrow(/does not match the measured code winner/)
    expect(() =>
      createAgentImprovementMeasuredComparison({
        result: {
          ...proposed.improvement.raw,
          winner: { ...proposed.improvement.raw.winner, surface: 'measured memory' },
        },
        measuredSurface: 'memory',
        baselineProfile: profile,
        candidateBundle: proposed.proposal.candidateBundle,
      }),
    ).toThrow(/memory improvement proposals require a content-addressed bundle binding/)
    expect(() =>
      createAgentImprovementMeasuredComparison({
        result: {
          ...proposed.improvement.raw,
          winner: {
            ...proposed.improvement.raw.winner,
            surface: '# Measured skill document',
          },
        },
        measuredSurface: 'skills',
        baselineProfile: profile,
        candidateBundle: proposed.proposal.candidateBundle,
      }),
    ).toThrow(/skill-document improvement proposals require a content-addressed bundle binding/)

    const review = reviewAgentImprovementProposal(proposed.proposal, {
      decision: 'approve',
      reviewedBy: 'operator@example.com',
      reason: 'Measured winner passed the held-back scenarios.',
      now: () => new Date('2026-07-10T02:00:00.000Z'),
    })
    expect(verifyAgentImprovementReview(review)).toEqual(review)
    expect(() =>
      verifyAgentImprovementReview({ ...review, reason: 'Tampered after review.' }),
    ).toThrow(/review digest does not match/)

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
      stop: async () => ({ stopped: true }),
      capture: async () => ({
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
    if (!executed.finalization.succeeded) throw new Error('expected successful finalization')
    expect(executed.evidence).toMatchObject({
      proposalDigest: proposed.proposal.digest,
      reviewDigest: review.digest,
      executionId: fixture.task.executionId,
      succeeded: true,
      receipt: {
        bundleDigest: proposed.proposal.candidateBundle?.digest,
        executionPlanDigest: expect.stringMatching(/^sha256:/),
        materializationReceiptDigest: expect.stringMatching(/^sha256:/),
        digest: expect.stringMatching(/^sha256:/),
      },
      materializationReceipt: {
        digest: executed.finalization.receipt.value.materializationReceiptDigest,
        profilePlan: { material: { files: expect.any(Array) } },
      },
    })
    expect(
      verifyCandidateExecutionEvidence([executed.evidence], {
        proposal: proposed.proposal,
        review,
        expectedCount: 1,
      }),
    ).toEqual([executed.evidence])
    expect(() =>
      verifyCandidateExecutionEvidence([executed.evidence, executed.evidence], {
        proposal: proposed.proposal,
        review,
        expectedCount: 2,
      }),
    ).toThrow(/reuses an execution id/)
    expect(() =>
      verifyCandidateExecutionEvidence([{ ...executed.evidence, succeeded: false }], {
        proposal: proposed.proposal,
        review,
        expectedCount: 1,
      }),
    ).toThrow()
    expect(() =>
      verifyCandidateExecutionEvidence([forgeProfileActivation(executed.evidence)], {
        proposal: proposed.proposal,
        review,
        expectedCount: 1,
      }),
    ).toThrow(/profile activation file path, mode, and content must match the canonical plan/)
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
            stop: async () => ({ stopped: true }),
            capture: async () => ({}),
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
            stop: async () => ({ stopped: true }),
            capture: async () => ({}),
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

function forgeProfileActivation(evidence: CandidateExecutionEvidence): CandidateExecutionEvidence {
  const { digest: _activationDigest, ...activationWithoutDigest } = evidence.profileActivation
  const first = evidence.profileActivation.files[0]
  if (!first) throw new Error('expected a materialized profile file')
  const profileActivation = canonicalCandidateDocument<
    CandidateExecutionEvidence['profileActivation']
  >({
    ...activationWithoutDigest,
    files: [
      { ...first, content: `${first.content}\nforged` },
      ...evidence.profileActivation.files.slice(1),
    ],
  }).value
  const { digest: _evidenceDigest, ...evidenceWithoutDigest } = evidence
  return canonicalCandidateDocument<CandidateExecutionEvidence>({
    ...evidenceWithoutDigest,
    profileActivation,
  }).value
}
