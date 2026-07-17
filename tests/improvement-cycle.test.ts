import type { AnalystFinding } from '@tangle-network/agent-eval'
import { afterEach, describe, expect, it } from 'vitest'

import { canonicalCandidateDigest } from '../src/candidate-execution/digest'
import { agentCandidateProfileAsAgentProfile } from '../src/candidate-execution/profile'
import {
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
import { cleanupCandidateFixtures } from './helpers/candidate-execution-fixture'
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

afterEach(() => {
  cleanupCandidateExperimentFixtures()
  cleanupCandidateFixtures()
})

describe('agent improvement lifecycle', () => {
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

    const review = reviewAgentImprovementProposal(proposal, {
      decision: 'approve',
      reviewedBy: 'operator@example.com',
      reason: 'All three paired tasks improved.',
      now: () => new Date('2026-07-10T01:01:00.000Z'),
    })
    expect(verifyAgentImprovementReview(review)).toEqual(review)

    const activation = createAgentImprovementActivation(proposal, review, {
      targets: [
        {
          surface: 'prompt',
          identity: 'tenant/default/profile',
          expectedBaseDigest: promptSurfaceDigest(rig),
        },
      ],
      fundingOwner: 'tenant/default',
      authorizedBy: 'operator@example.com',
      now: () => new Date('2026-07-10T01:02:00.000Z'),
    })
    expect(verifyAgentImprovementActivation({ proposal, review, activation })).toEqual(activation)
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
        targets: [
          {
            surface: 'prompt',
            identity: 'tenant/default/profile',
            expectedBaseDigest: canonicalCandidateDigest('stale-profile'),
          },
        ],
        fundingOwner: 'tenant/default',
        authorizedBy: 'operator@example.com',
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
        targets: [
          {
            surface: 'prompt',
            identity: 'tenant/default/profile',
            expectedBaseDigest: promptSurfaceDigest(rig),
          },
        ],
        fundingOwner: 'tenant/default',
        authorizedBy: 'operator@example.com',
      }),
    ).toThrow(/requires an approval/)
  })

  it('blocks optimizer write-back before measurement and approval', async () => {
    await expect(
      proposeAgentImprovement({
        runId: 'unsafe-memory-write',
        profile: { name: 'fixture' },
        analysis: {} as never,
        improvement: { memory: { writeBack: async () => undefined } } as never,
        buildExperiment: async () => {
          throw new Error('must not build an experiment')
        },
        placeCell: () => {
          throw new Error('must not place a cell')
        },
      }),
    ).rejects.toThrow(/cannot write memory before approval/)
  })
})

function promptSurfaceDigest(rig: CandidateExperimentFixture): `sha256:${string}` {
  const profile = agentCandidateProfileAsAgentProfile(rig.experiment.baseline.profile)
  return canonicalCandidateDigest({
    prompt: profile.prompt ?? null,
    instructions: profile.resources?.instructions ?? null,
  })
}
