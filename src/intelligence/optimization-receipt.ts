import type {
  OptimizationMethodComparison,
  OptimizationPackageSource,
  OptimizationTokenUsage,
} from '@tangle-network/agent-eval/campaign'
import {
  type AgentCandidateJsonValue,
  type AgentImprovementMeasuredComparison,
  type AgentProfile,
  agentProfileModelHintsSchema,
  type Sha256Digest,
} from '@tangle-network/agent-interface'

import {
  canonicalCandidateDigest,
  canonicalCandidateDocument,
  immutableCandidateValue,
  omitTopLevelDigest,
} from '../candidate-execution/digest'
import type { ImproveMethodResult } from '../improvement/improve'

type OptimizationProvenance = NonNullable<OptimizationMethodComparison['best']['provenance']>

export interface OptimizationActivationReceipt {
  kind: 'optimization-activation-receipt'
  method: string
  source: OptimizationPackageSource
  bridge?: OptimizationPackageSource
  modules?: OptimizationProvenance['modules']
  python?: OptimizationProvenance['python']
  models?: {
    candidate?: NonNullable<AgentProfile['model']>
    optimizer?: string
  }
  usage: {
    optimizerEvaluations: number
    optimizerTokens?: OptimizationTokenUsage
  }
  cost: {
    optimization: OptimizationReceiptCost
    finalTest: OptimizationReceiptCost
    total: OptimizationReceiptCost
  }
  invocation: {
    runtimeInvocationId: string
    optimizerRunId: string
    compatibleOptimizerRunId?: string
    resumed: boolean
    artifactDir: string
  }
  developmentDataDigest: Sha256Digest
  digest: Sha256Digest
}

export interface OptimizationReceiptCost {
  totalUsd: number
  accountingComplete: boolean
  incompleteReasons: string[]
}

export const optimizationReceiptMetadataKey = 'optimizationReceipt'

/** Build a detached receipt only for methods backed by an identified external optimizer. */
export function createOptimizationActivationReceipt(
  improvement: ImproveMethodResult,
): OptimizationActivationReceipt | undefined {
  const provenance = improvement.provenance
  if (!provenance) return undefined
  const optimizerModel = provenance.optimizerModel
  const candidateModel = improvement.candidate.profile.model

  return canonicalCandidateDocument<OptimizationActivationReceipt>({
    kind: 'optimization-activation-receipt',
    method: improvement.method,
    source: provenance.source,
    ...(provenance.bridge ? { bridge: provenance.bridge } : {}),
    ...(provenance.modules ? { modules: provenance.modules } : {}),
    ...(provenance.python ? { python: provenance.python } : {}),
    ...(candidateModel || optimizerModel
      ? {
          models: {
            ...(candidateModel ? { candidate: candidateModel } : {}),
            ...(optimizerModel ? { optimizer: optimizerModel } : {}),
          },
        }
      : {}),
    usage: {
      optimizerEvaluations: provenance.evaluationCount,
      ...(provenance.tokenUsage ? { optimizerTokens: provenance.tokenUsage } : {}),
    },
    cost: {
      optimization: receiptCost(improvement.raw.optimizationCost),
      finalTest: receiptCost(improvement.raw.testCost),
      total: receiptCost(improvement.raw.totalCost),
    },
    invocation: {
      runtimeInvocationId: improvement.lineage.invocationId,
      optimizerRunId: provenance.runId,
      ...(provenance.compatibleRunId
        ? { compatibleOptimizerRunId: provenance.compatibleRunId }
        : {}),
      resumed: provenance.resumed,
      artifactDir: provenance.artifactDir,
    },
    developmentDataDigest: improvement.lineage.developmentSplitDigest,
  }).value
}

/** Add Runtime-owned optimizer evidence without aliasing caller metadata. */
export function attachOptimizationActivationReceipt(
  metadata: AgentImprovementMeasuredComparison['metadata'],
  receipt: OptimizationActivationReceipt,
): NonNullable<AgentImprovementMeasuredComparison['metadata']> {
  assertNoCallerOptimizationReceipt(metadata)
  return immutableCandidateValue({
    ...(metadata ?? {}),
    [optimizationReceiptMetadataKey]: receipt as unknown as AgentCandidateJsonValue,
  })
}

export function assertNoCallerOptimizationReceipt(
  metadata: AgentImprovementMeasuredComparison['metadata'],
): void {
  if (metadata && Object.hasOwn(metadata, optimizationReceiptMetadataKey)) {
    throw new Error(`candidate metadata reserves '${optimizationReceiptMetadataKey}' for Runtime`)
  }
}

/** Read and verify the optimizer evidence carried by a measured proposal. */
export function optimizationActivationReceiptFromMetadata(
  metadata: AgentImprovementMeasuredComparison['metadata'],
): OptimizationActivationReceipt | undefined {
  const value = metadata?.[optimizationReceiptMetadataKey]
  if (value === undefined) return undefined
  return immutableCandidateValue(parseOptimizationActivationReceipt(value))
}

function parseOptimizationActivationReceipt(
  value: AgentCandidateJsonValue,
): OptimizationActivationReceipt {
  if (!isRecord(value) || value.kind !== 'optimization-activation-receipt') {
    throw new Error('optimization receipt must be an optimization-activation-receipt')
  }
  if (
    !isNonEmptyString(value.method) ||
    !isPackageSource(value.source) ||
    (value.bridge !== undefined && !isPackageSource(value.bridge)) ||
    !isModules(value.modules) ||
    !isPythonRuntime(value.python) ||
    !isModels(value.models) ||
    !isUsage(value.usage) ||
    !isCost(value.cost) ||
    !isInvocation(value.invocation) ||
    !isSha256Digest(value.developmentDataDigest) ||
    !isSha256Digest(value.digest)
  ) {
    throw new Error('optimization receipt contains invalid evidence')
  }
  const receipt = value as unknown as OptimizationActivationReceipt
  if (canonicalCandidateDigest(omitTopLevelDigest(receipt)) !== receipt.digest) {
    throw new Error('optimization receipt digest does not match its evidence')
  }
  return receipt
}

function isPackageSource(value: unknown): value is OptimizationPackageSource {
  if (
    !isRecord(value) ||
    value.kind !== 'package' ||
    (value.evidence !== 'observed' && value.evidence !== 'declared') ||
    !isNonEmptyString(value.package) ||
    !isNonEmptyString(value.version)
  ) {
    return false
  }
  return (
    isOptionalNonEmptyString(value.sourceUrl) &&
    isOptionalNonEmptyString(value.revision) &&
    (value.sourceSha256 === undefined ||
      (typeof value.sourceSha256 === 'string' && /^[0-9a-f]{64}$/.test(value.sourceSha256)))
  )
}

function isModules(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (module) =>
          isRecord(module) &&
          isNonEmptyString(module.module) &&
          typeof module.sourceSha256 === 'string' &&
          /^[0-9a-f]{64}$/.test(module.sourceSha256),
      ))
  )
}

function isPythonRuntime(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) && isNonEmptyString(value.implementation) && isNonEmptyString(value.version))
  )
}

function isModels(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      (value.candidate === undefined ||
        agentProfileModelHintsSchema.safeParse(value.candidate).success) &&
      isOptionalNonEmptyString(value.optimizer) &&
      (value.candidate !== undefined || value.optimizer !== undefined))
  )
}

function isUsage(value: unknown): boolean {
  if (!isRecord(value) || !isNonNegativeInteger(value.optimizerEvaluations)) return false
  if (value.optimizerTokens === undefined) return true
  const tokens = value.optimizerTokens
  if (!isRecord(tokens)) return false
  const inputTokens = tokens.inputTokens
  const outputTokens = tokens.outputTokens
  const totalTokens = tokens.totalTokens
  const calls = tokens.calls
  if (
    !isNonNegativeInteger(inputTokens) ||
    !isNonNegativeInteger(outputTokens) ||
    !isNonNegativeInteger(totalTokens) ||
    !isNonNegativeInteger(calls)
  ) {
    return false
  }
  if (
    !isOptionalNonNegativeInteger(tokens.cachedInputTokens) ||
    !isOptionalNonNegativeInteger(tokens.cacheWriteInputTokens) ||
    !isOptionalNonNegativeInteger(tokens.reasoningTokens)
  ) {
    return false
  }
  const cachedInputTokens =
    typeof tokens.cachedInputTokens === 'number' ? tokens.cachedInputTokens : 0
  const cacheWriteInputTokens =
    typeof tokens.cacheWriteInputTokens === 'number' ? tokens.cacheWriteInputTokens : 0
  const reasoningTokens = typeof tokens.reasoningTokens === 'number' ? tokens.reasoningTokens : 0
  return (
    totalTokens === inputTokens + outputTokens &&
    cachedInputTokens + cacheWriteInputTokens <= inputTokens &&
    reasoningTokens <= outputTokens &&
    (totalTokens === 0 || calls > 0)
  )
}

function isCost(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !isCostPart(value.optimization) ||
    !isCostPart(value.finalTest) ||
    !isCostPart(value.total)
  ) {
    return false
  }
  const optimization = value.optimization as unknown as OptimizationReceiptCost
  const finalTest = value.finalTest as unknown as OptimizationReceiptCost
  const total = value.total as unknown as OptimizationReceiptCost
  return (
    approximatelyEqual(total.totalUsd, optimization.totalUsd + finalTest.totalUsd) &&
    total.accountingComplete === (optimization.accountingComplete && finalTest.accountingComplete)
  )
}

function isCostPart(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.totalUsd === 'number' &&
    Number.isFinite(value.totalUsd) &&
    value.totalUsd >= 0 &&
    typeof value.accountingComplete === 'boolean' &&
    Array.isArray(value.incompleteReasons) &&
    value.incompleteReasons.every((reason) => typeof reason === 'string')
  )
}

function receiptCost(value: {
  totalCostUsd: number
  accountingComplete: boolean
  incompleteReasons: string[]
}): OptimizationReceiptCost {
  return {
    totalUsd: value.totalCostUsd,
    accountingComplete: value.accountingComplete,
    incompleteReasons: [...value.incompleteReasons],
  }
}

function approximatelyEqual(left: number, right: number): boolean {
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 8
  return Math.abs(left - right) <= tolerance
}

function isInvocation(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.runtimeInvocationId) &&
    isNonEmptyString(value.optimizerRunId) &&
    isOptionalNonEmptyString(value.compatibleOptimizerRunId) &&
    typeof value.resumed === 'boolean' &&
    isNonEmptyString(value.artifactDir)
  )
}

function isRecord(value: unknown): value is Record<string, AgentCandidateJsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isOptionalNonEmptyString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isOptionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || isNonNegativeInteger(value)
}

function isSha256Digest(value: unknown): value is Sha256Digest {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value)
}
