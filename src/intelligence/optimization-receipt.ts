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
  model?: {
    role: 'candidate'
    identity: NonNullable<AgentProfile['model']>
  }
  usage: {
    evaluations: number
    tokens?: OptimizationTokenUsage
  }
  cost: {
    totalUsd: number
    accountingComplete: boolean
    incompleteReasons: string[]
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

export const optimizationReceiptMetadataKey = 'optimizationReceipt'

/** Build a detached receipt only for methods backed by an identified external optimizer. */
export function createOptimizationActivationReceipt(
  improvement: ImproveMethodResult,
): OptimizationActivationReceipt | undefined {
  const provenance = improvement.provenance
  if (!provenance) return undefined

  return canonicalCandidateDocument<OptimizationActivationReceipt>({
    kind: 'optimization-activation-receipt',
    method: improvement.method,
    source: provenance.source,
    ...(provenance.bridge ? { bridge: provenance.bridge } : {}),
    ...(provenance.modules ? { modules: provenance.modules } : {}),
    ...(provenance.python ? { python: provenance.python } : {}),
    ...(improvement.candidate.profile.model
      ? {
          model: {
            role: 'candidate',
            identity: improvement.candidate.profile.model,
          },
        }
      : {}),
    usage: {
      evaluations: provenance.evaluationCount,
      ...(provenance.tokenUsage ? { tokens: provenance.tokenUsage } : {}),
    },
    cost: {
      totalUsd: improvement.cost.totalCostUsd,
      accountingComplete: improvement.cost.accountingComplete,
      incompleteReasons: improvement.cost.incompleteReasons,
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
    !isCandidateModel(value.model) ||
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

function isCandidateModel(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      value.role === 'candidate' &&
      agentProfileModelHintsSchema.safeParse(value.identity).success)
  )
}

function isUsage(value: unknown): boolean {
  if (!isRecord(value) || !isNonNegativeInteger(value.evaluations)) return false
  if (value.tokens === undefined) return true
  const tokens = value.tokens
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
