import { afterEach, describe, expect, it } from 'vitest'

import { canonicalCandidateDigest, omitTopLevelDigest } from '../src/candidate-execution/digest'
import { agentCandidateProfileAsAgentProfile } from '../src/candidate-execution/profile'
import type { ImproveMethodFactory } from '../src/improvement'
import {
  createAgentImprovementActivation,
  proposeAgentImprovement,
  reviewAgentImprovementProposal,
} from '../src/intelligence/improvement-cycle'
import {
  optimizationActivationReceiptFromMetadata,
  optimizationReceiptMetadataKey,
} from '../src/intelligence/optimization-receipt'
import { cleanupCandidateFixtures } from './helpers/candidate-execution-fixture'
import {
  cleanupCandidateExperimentFixtures,
  createCandidateExperimentFixture,
} from './helpers/candidate-experiment-fixture'
import {
  candidateExperimentMaterial,
  type ImprovementScenario,
  improvementMethod,
  improvementOptions,
  proposeTestMethodImprovement,
} from './helpers/improvement-method-fixture'

const officialImprovementMethod: ImproveMethodFactory<ImprovementScenario, string> = (context) => ({
  name: 'official-test-method',
  async optimize() {
    return {
      winnerSurface: 'PROMOTED',
      cost: { totalCostUsd: 0, accountingComplete: true, incompleteReasons: [] },
      provenance: {
        source: {
          kind: 'package',
          evidence: 'observed',
          package: 'official-optimizer',
          version: '1.2.3',
          sourceUrl: 'https://example.test/official-optimizer',
          revision: 'abc123',
          sourceSha256: 'a'.repeat(64),
        },
        bridge: {
          kind: 'package',
          evidence: 'observed',
          package: 'agent-eval-rpc',
          version: '9.8.7',
          sourceSha256: 'b'.repeat(64),
        },
        optimizerModel: 'optimizer-model',
        modules: [{ module: 'official_optimizer.engine', sourceSha256: 'c'.repeat(64) }],
        python: { implementation: 'CPython', version: '3.13.5' },
        runId: `official:${context.evaluationRef}`,
        compatibleRunId: `compatible:${context.evaluationRef}`,
        resumed: false,
        evaluationCount: 7,
        artifactDir: '/tmp/official-optimizer',
        tokenUsage: {
          inputTokens: 100,
          cachedInputTokens: 20,
          cacheWriteInputTokens: 10,
          outputTokens: 30,
          reasoningTokens: 5,
          totalTokens: 130,
          calls: 2,
        },
      },
    }
  },
})

afterEach(() => {
  cleanupCandidateExperimentFixtures()
  cleanupCandidateFixtures()
})

describe('optimization activation receipt', { timeout: 30_000 }, () => {
  it('retains immutable official optimizer evidence through sealing and promotion', async () => {
    const result = await proposeTestMethodImprovement(
      'official-receipt-run',
      officialImprovementMethod,
      (profile) => {
        profile.model = {
          provider: 'test-provider',
          default: 'provider/model',
          reasoningEffort: 'high',
        }
      },
    )

    const receipt = optimizationActivationReceiptFromMetadata(result.proposal.evaluation.metadata)
    expect(receipt).toMatchObject({
      kind: 'optimization-activation-receipt',
      method: 'official-test-method',
      source: {
        package: 'official-optimizer',
        version: '1.2.3',
        sourceSha256: 'a'.repeat(64),
      },
      bridge: {
        package: 'agent-eval-rpc',
        version: '9.8.7',
        sourceSha256: 'b'.repeat(64),
      },
      python: { implementation: 'CPython', version: '3.13.5' },
      models: {
        candidate: {
          provider: 'test-provider',
          default: 'provider/model',
          reasoningEffort: 'high',
        },
        optimizer: 'optimizer-model',
      },
      usage: {
        optimizerEvaluations: 7,
        optimizerTokens: { inputTokens: 100, outputTokens: 30, totalTokens: 130, calls: 2 },
      },
      cost: {
        optimization: {
          totalUsd: result.improvement.raw.optimizationCost.totalCostUsd,
          accountingComplete: true,
          incompleteReasons: [],
        },
        finalTest: {
          totalUsd: result.improvement.raw.testCost.totalCostUsd,
          accountingComplete: true,
          incompleteReasons: [],
        },
        total: {
          totalUsd: result.improvement.cost.totalCostUsd,
          accountingComplete: true,
          incompleteReasons: [],
        },
      },
      invocation: {
        runtimeInvocationId: result.improvement.lineage.invocationId,
        optimizerRunId: expect.stringMatching(/^official:sha256:/),
        compatibleOptimizerRunId: expect.stringMatching(/^compatible:sha256:/),
        resumed: false,
        artifactDir: '/tmp/official-optimizer',
      },
      developmentDataDigest: result.improvement.lineage.developmentSplitDigest,
      finalTestDataDigest: result.improvement.lineage.finalTestSplitDigest,
      scenarioPartitions: result.improvement.lineage.scenarioPartitions,
    })
    expect(Object.isFrozen(receipt)).toBe(true)
    expect(Object.isFrozen(receipt?.source)).toBe(true)

    if (!result.improvement.provenance) throw new Error('expected optimizer provenance')
    expect(receipt?.source).not.toBe(result.improvement.provenance.source)
    expect(() => {
      if (receipt) receipt.source.version = 'mutated-receipt'
    }).toThrow(TypeError)
    if (!receipt) throw new Error('expected optimization receipt')
    const tamperedReceipt = structuredClone(receipt)
    tamperedReceipt.source.version = 'tampered'
    expect(() =>
      optimizationActivationReceiptFromMetadata({
        [optimizationReceiptMetadataKey]: tamperedReceipt,
      } as unknown as Parameters<typeof optimizationActivationReceiptFromMetadata>[0]),
    ).toThrow(/digest does not match/)
    const invalidReceipt = structuredClone(receipt)
    invalidReceipt.modules = [{ module: '', sourceSha256: 'c'.repeat(64) }]
    invalidReceipt.digest = canonicalCandidateDigest(omitTopLevelDigest(invalidReceipt))
    expect(() =>
      optimizationActivationReceiptFromMetadata({
        [optimizationReceiptMetadataKey]: invalidReceipt,
      } as unknown as Parameters<typeof optimizationActivationReceiptFromMetadata>[0]),
    ).toThrow(/invalid evidence/)
    const invalidUsageReceipt = structuredClone(receipt)
    if (!invalidUsageReceipt.usage.optimizerTokens)
      throw new Error('expected optimizer token usage')
    invalidUsageReceipt.usage.optimizerTokens.totalTokens += 1
    invalidUsageReceipt.digest = canonicalCandidateDigest(omitTopLevelDigest(invalidUsageReceipt))
    expect(() =>
      optimizationActivationReceiptFromMetadata({
        [optimizationReceiptMetadataKey]: invalidUsageReceipt,
      } as unknown as Parameters<typeof optimizationActivationReceiptFromMetadata>[0]),
    ).toThrow(/invalid evidence/)
    const invalidCostReceipt = structuredClone(receipt)
    invalidCostReceipt.cost.total.totalUsd += 1
    invalidCostReceipt.digest = canonicalCandidateDigest(omitTopLevelDigest(invalidCostReceipt))
    expect(() =>
      optimizationActivationReceiptFromMetadata({
        [optimizationReceiptMetadataKey]: invalidCostReceipt,
      } as unknown as Parameters<typeof optimizationActivationReceiptFromMetadata>[0]),
    ).toThrow(/invalid evidence/)
    const invalidPartitionReceipt = structuredClone(receipt)
    invalidPartitionReceipt.scenarioPartitions.finalTest[0]!.scenarioDigest =
      canonicalCandidateDigest({
        different: 'task',
      })
    invalidPartitionReceipt.digest = canonicalCandidateDigest(
      omitTopLevelDigest(invalidPartitionReceipt),
    )
    expect(() =>
      optimizationActivationReceiptFromMetadata({
        [optimizationReceiptMetadataKey]: invalidPartitionReceipt,
      } as unknown as Parameters<typeof optimizationActivationReceiptFromMetadata>[0]),
    ).toThrow(/task identities do not match its split digests/)

    const review = reviewAgentImprovementProposal(result.proposal, {
      decision: 'approve',
      reviewedBy: 'operator@example.com',
      reason: 'Official optimizer evidence retained.',
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
    expect(activation.proposalDigest).toBe(result.proposal.digest)
    expect(optimizationActivationReceiptFromMetadata(result.proposal.evaluation.metadata)).toEqual(
      receipt,
    )
    await result.improvement.dispose()
  })

  it('changes its digest when official package evidence changes', async () => {
    const run = async (version: string) => {
      const method: ImproveMethodFactory<ImprovementScenario, string> = (context) => {
        const base = officialImprovementMethod(context)
        return {
          ...base,
          async optimize(input) {
            const output = await base.optimize(input)
            if (!output.provenance) throw new Error('expected optimizer provenance')
            return {
              ...output,
              provenance: {
                ...output.provenance,
                source: { ...output.provenance.source, version },
              },
            }
          },
        }
      }
      const result = await proposeTestMethodImprovement(`receipt-digest-${version}`, method)
      const receipt = optimizationActivationReceiptFromMetadata(result.proposal.evaluation.metadata)
      await result.improvement.dispose()
      return receipt
    }

    const first = await run('1.2.3')
    const second = await run('1.2.4')
    expect(first?.digest).not.toBe(second?.digest)
  })

  it('leaves local optimizer proposals without receipt metadata', async () => {
    const result = await proposeTestMethodImprovement('local-method-no-receipt', improvementMethod)

    expect(result.proposal.evaluation.metadata).toBeUndefined()
    await result.improvement.dispose()
  })

  it('rejects caller-authored receipt metadata before analysis', async () => {
    const seed = createCandidateExperimentFixture()
    let analysisCalls = 0

    await expect(
      proposeAgentImprovement({
        runId: 'forged-receipt',
        profile: agentCandidateProfileAsAgentProfile(seed.experiment.baseline.profile),
        analysis: {
          registry: {
            list: () => [{ id: 'improvement' }],
            run: async () => {
              analysisCalls += 1
              throw new Error('analysis must not run')
            },
          },
          inputs: {},
          findingsStore: null,
        },
        improvement: improvementOptions(),
        buildExperiment: () => candidateExperimentMaterial(seed.experiment),
        placeCell: seed.placeCell,
        metadata: {
          [optimizationReceiptMetadataKey]: { kind: 'caller-authored' },
        },
      }),
    ).rejects.toThrow(/reserves 'optimizationReceipt' for Runtime/)
    expect(analysisCalls).toBe(0)
  })
})
