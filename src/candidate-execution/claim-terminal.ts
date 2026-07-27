import type {
  AgentCandidateArtifactRef,
  AgentCandidateFixedSpend,
  Sha256Digest,
} from '@tangle-network/agent-interface'
import { agentCandidateArtifactRefSchema } from '@tangle-network/agent-interface'

import type {
  AgentCandidateExecutionClaim,
  AgentCandidateExecutionFailureClass,
  AgentCandidateExecutionFinishResult,
  AgentCandidateExecutionPhase,
  AgentCandidateExecutionRecoveryEvidence,
  AgentCandidateExecutionStageResult,
  AgentCandidateExecutionTerminalRecord,
  AgentCandidateExecutionTerminalResult,
} from './claim'
import { sealCandidatePreparationEvidence } from './claim-file-formats'
import { canonicalCandidateDigest, immutableCandidateValue } from './digest'
import { assertExactObjectKeys as assertExactKeys } from './exact-object'

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/

export function terminalRecord(
  claim: AgentCandidateExecutionClaim,
  result: AgentCandidateExecutionTerminalResult,
): AgentCandidateExecutionTerminalRecord {
  const terminal = sealTerminalResult(result)
  const value = {
    executionId: claim.executionId,
    attempt: claim.attempt,
    bundleDigest: claim.bundleDigest,
    executionPlanDigest: claim.executionPlanDigest,
    preparationEvidence: claim.preparationEvidence,
    ...terminal,
  }
  return immutableCandidateValue({
    ...value,
    terminalDigest: canonicalCandidateDigest(value),
  }) as AgentCandidateExecutionTerminalRecord
}

export function recoveredTerminalRecord(
  claim: AgentCandidateExecutionClaim,
  phase: AgentCandidateExecutionPhase,
  evidence: AgentCandidateExecutionRecoveryEvidence,
): AgentCandidateExecutionTerminalRecord {
  const recovered = sealRecoveryEvidence(evidence, claim)
  return terminalRecord(claim, {
    status: 'failed',
    failureClass:
      recovered.failureClass === 'pre-model-infrastructure' && phase !== 'claimed'
        ? 'unknown'
        : recovered.failureClass,
    usage: recovered.usage,
    modelSettlement: recovered.modelSettlement,
    ...(recovered.failureEvidence ? { failureEvidence: recovered.failureEvidence } : {}),
  })
}

export function assertTerminalAllowedInPhase(
  phase: AgentCandidateExecutionPhase,
  terminal: AgentCandidateExecutionTerminalRecord,
): void {
  if (
    phase === 'candidate-may-run' &&
    terminal.status === 'failed' &&
    terminal.failureClass === 'pre-model-infrastructure'
  ) {
    throw new Error('candidate execution crossed candidate-may-run before pre-model failure')
  }
  if (
    phase === 'claimed' &&
    (terminal.status === 'succeeded' ||
      (terminal.status === 'failed' &&
        (terminal.failureClass === 'execution' ||
          terminal.failureClass === 'post-model-infrastructure')))
  ) {
    throw new Error('candidate execution terminal requires candidate-may-run phase')
  }
}

export function rejectedFinish(
  existing: AgentCandidateExecutionTerminalRecord,
  requestedTerminalDigest: Sha256Digest,
): AgentCandidateExecutionFinishResult {
  return Object.freeze({
    finished: false,
    terminal: existing,
    exactReplay: existing.terminalDigest === requestedTerminalDigest,
  })
}

export function rejectedStage(
  existing: AgentCandidateExecutionTerminalRecord,
  requested: AgentCandidateExecutionTerminalRecord,
): AgentCandidateExecutionStageResult {
  return Object.freeze({
    staged: false,
    terminal: existing,
    exactReplay: existing.terminalDigest === requested.terminalDigest,
  })
}

export function requireStagedTerminal(
  staged: AgentCandidateExecutionTerminalRecord | undefined,
  terminalDigest: Sha256Digest,
): AgentCandidateExecutionTerminalRecord {
  if (!staged) throw new Error('candidate execution terminal has not been staged')
  if (staged.terminalDigest !== terminalDigest) {
    throw new Error('candidate execution terminal digest does not match staged outbox')
  }
  return staged
}

export function sealTerminalDigest(value: Sha256Digest): Sha256Digest {
  assertSha256Digest(value, 'terminalDigest')
  return value
}

export function assertRecoveryMatchesStaged(
  staged: AgentCandidateExecutionTerminalRecord,
  recovered: AgentCandidateExecutionTerminalRecord,
): void {
  if (
    canonicalCandidateDigest(staged.usage) !== canonicalCandidateDigest(recovered.usage) ||
    canonicalCandidateDigest(staged.modelSettlement) !==
      canonicalCandidateDigest(recovered.modelSettlement)
  ) {
    throw new Error('candidate execution recovery evidence does not match staged model evidence')
  }
}

export function sealTerminalRecordValue(
  value: Record<string, unknown>,
  label: string,
): AgentCandidateExecutionTerminalRecord {
  const status = requireTerminalStatus(value.status, label)
  assertExactKeys(
    value,
    status === 'succeeded'
      ? [
          'executionId',
          'attempt',
          'bundleDigest',
          'executionPlanDigest',
          'preparationEvidence',
          'terminalDigest',
          'status',
          'usage',
          'modelSettlement',
          'taskOutcome',
          'benchmarkResult',
          'runReceipt',
        ]
      : [
          'executionId',
          'attempt',
          'bundleDigest',
          'executionPlanDigest',
          'preparationEvidence',
          'terminalDigest',
          'status',
          'failureClass',
          'usage',
          'modelSettlement',
          ...(value.failureEvidence ? ['failureEvidence'] : []),
        ],
    label,
  )
  const executionPlanDigest = requireString(
    value.executionPlanDigest,
    label,
    'executionPlanDigest',
  ) as Sha256Digest
  const identity = {
    executionId: requireString(value.executionId, label, 'executionId'),
    attempt: requireNumber(value.attempt, label, 'attempt'),
    bundleDigest: requireString(value.bundleDigest, label, 'bundleDigest') as Sha256Digest,
    executionPlanDigest,
    preparationEvidence: sealCandidatePreparationEvidence(
      value.preparationEvidence,
      executionPlanDigest,
    ),
  }
  assertExecutionId(identity.executionId)
  if (!Number.isSafeInteger(identity.attempt) || identity.attempt < 1) {
    throw new Error(`${label} has invalid attempt`)
  }
  assertSha256Digest(identity.bundleDigest, 'bundleDigest')
  assertSha256Digest(identity.executionPlanDigest, 'executionPlanDigest')
  if (identity.preparationEvidence.executionPlan.sha256 !== identity.executionPlanDigest) {
    throw new Error(`${label} execution plan artifact does not match executionPlanDigest`)
  }
  const result = sealTerminalResult(
    status === 'succeeded'
      ? {
          status,
          usage: requireObject(value.usage, label, 'usage') as unknown as AgentCandidateFixedSpend,
          modelSettlement: requireArtifactRef(value.modelSettlement, label, 'modelSettlement'),
          taskOutcome: requireArtifactRef(value.taskOutcome, label, 'taskOutcome'),
          benchmarkResult: requireArtifactRef(value.benchmarkResult, label, 'benchmarkResult'),
          runReceipt: requireArtifactRef(value.runReceipt, label, 'runReceipt'),
        }
      : {
          status,
          failureClass: requireFailureClass(value.failureClass, label),
          usage: requireObject(value.usage, label, 'usage') as unknown as AgentCandidateFixedSpend,
          modelSettlement: requireArtifactRef(value.modelSettlement, label, 'modelSettlement'),
          ...(value.failureEvidence
            ? {
                failureEvidence: requireArtifactRef(
                  value.failureEvidence,
                  label,
                  'failureEvidence',
                ),
              }
            : {}),
        },
  )
  const material = { ...identity, ...result }
  const terminalDigest = requireString(
    value.terminalDigest,
    label,
    'terminalDigest',
  ) as Sha256Digest
  assertSha256Digest(terminalDigest, 'terminalDigest')
  if (terminalDigest !== canonicalCandidateDigest(material)) {
    throw new Error(`${label} has invalid terminalDigest`)
  }
  return immutableCandidateValue({
    ...material,
    terminalDigest,
  }) as AgentCandidateExecutionTerminalRecord
}

export function assertTerminalMatchesClaim(
  terminal: AgentCandidateExecutionTerminalRecord,
  claim: AgentCandidateExecutionClaim,
  path: string,
): void {
  if (
    terminal.executionId !== claim.executionId ||
    terminal.attempt !== claim.attempt ||
    terminal.bundleDigest !== claim.bundleDigest ||
    terminal.executionPlanDigest !== claim.executionPlanDigest ||
    canonicalCandidateDigest(terminal.preparationEvidence) !==
      canonicalCandidateDigest(claim.preparationEvidence)
  ) {
    throw new Error(`candidate execution terminal record at ${path} does not match its claim`)
  }
}

export function assertTerminalMatchesStaged(
  terminal: AgentCandidateExecutionTerminalRecord,
  staged: AgentCandidateExecutionTerminalRecord,
  path: string,
): void {
  if (
    terminal.terminalDigest !== staged.terminalDigest ||
    canonicalCandidateDigest(terminal) !== canonicalCandidateDigest(staged)
  ) {
    throw new Error(`candidate execution terminal record at ${path} differs from staged outbox`)
  }
}

function sealRecoveryEvidence(
  evidence: AgentCandidateExecutionRecoveryEvidence,
  claim: AgentCandidateExecutionClaim,
): AgentCandidateExecutionRecoveryEvidence {
  assertExactKeys(
    evidence,
    [
      'failureClass',
      'usage',
      'modelSettlement',
      'process',
      'model',
      ...(evidence.failureEvidence ? ['failureEvidence'] : []),
      ...(evidence.memory ? ['memory'] : []),
    ],
    'candidate execution recovery evidence',
  )
  assertFailureClass(evidence.failureClass)
  const usage = sealUsage(evidence.usage)
  if (evidence.failureClass === 'pre-model-infrastructure' && usage.modelCalls !== 0) {
    throw new Error('pre-model infrastructure failure cannot contain model calls')
  }
  const modelSettlement = sealArtifactRef(evidence.modelSettlement, 'modelSettlement')
  const failureEvidence = evidence.failureEvidence
    ? sealArtifactRef(evidence.failureEvidence, 'failureEvidence')
    : undefined
  assertExactKeys(
    evidence.process,
    ['stopped', 'executionPlanDigest'],
    'candidate execution process closure evidence',
  )
  if (
    evidence.process.stopped !== true ||
    evidence.process.executionPlanDigest !== claim.executionPlanDigest
  ) {
    throw new Error('candidate execution recovery does not prove the claimed process stopped')
  }
  assertExactKeys(
    evidence.model,
    ['closed', 'preparationId', 'grantDigest'],
    'candidate execution model closure evidence',
  )
  if (
    evidence.model.closed !== true ||
    evidence.model.preparationId !== claim.cleanup.preparationId ||
    evidence.model.grantDigest !== claim.cleanup.modelGrantDigest
  ) {
    throw new Error('candidate execution recovery does not prove the claimed model grant closed')
  }
  if (claim.cleanup.memory) {
    if (!evidence.memory) {
      throw new Error('candidate execution recovery is missing memory closure evidence')
    }
    assertExactKeys(
      evidence.memory,
      ['closed', 'preparationId', 'accessDigest', 'effectiveNamespace'],
      'candidate execution memory closure evidence',
    )
    if (
      evidence.memory.closed !== true ||
      evidence.memory.preparationId !== claim.cleanup.preparationId ||
      evidence.memory.accessDigest !== claim.cleanup.memory.accessDigest ||
      evidence.memory.effectiveNamespace !== claim.cleanup.memory.effectiveNamespace
    ) {
      throw new Error(
        'candidate execution recovery does not prove the claimed memory access closed',
      )
    }
  } else if (evidence.memory !== undefined) {
    throw new Error('candidate execution recovery has unexpected memory closure evidence')
  }
  return Object.freeze({
    failureClass: evidence.failureClass,
    usage,
    modelSettlement,
    ...(failureEvidence ? { failureEvidence } : {}),
    process: Object.freeze({ ...evidence.process }),
    model: Object.freeze({ ...evidence.model }),
    ...(evidence.memory ? { memory: Object.freeze({ ...evidence.memory }) } : {}),
  })
}

function sealTerminalResult(
  result: AgentCandidateExecutionTerminalResult,
): AgentCandidateExecutionTerminalResult {
  if (result.status !== 'succeeded' && result.status !== 'failed') {
    throw new Error('candidate execution terminal status is invalid')
  }
  assertExactKeys(
    result,
    result.status === 'succeeded'
      ? ['status', 'usage', 'modelSettlement', 'taskOutcome', 'benchmarkResult', 'runReceipt']
      : [
          'status',
          'failureClass',
          'usage',
          'modelSettlement',
          ...(result.failureEvidence ? ['failureEvidence'] : []),
        ],
    'candidate execution terminal result',
  )
  const usage = sealUsage(result.usage)
  const modelSettlement = sealArtifactRef(result.modelSettlement, 'modelSettlement')
  if (result.status === 'succeeded') {
    return Object.freeze({
      status: 'succeeded',
      usage,
      modelSettlement,
      taskOutcome: sealArtifactRef(result.taskOutcome, 'taskOutcome'),
      benchmarkResult: sealArtifactRef(result.benchmarkResult, 'benchmarkResult'),
      runReceipt: sealArtifactRef(result.runReceipt, 'runReceipt'),
    })
  }
  assertFailureClass(result.failureClass)
  if (result.failureClass === 'pre-model-infrastructure' && usage.modelCalls !== 0) {
    throw new Error('pre-model infrastructure failure cannot contain model calls')
  }
  return Object.freeze({
    status: 'failed',
    failureClass: result.failureClass,
    usage,
    modelSettlement,
    ...(result.failureEvidence
      ? { failureEvidence: sealArtifactRef(result.failureEvidence, 'failureEvidence') }
      : {}),
  })
}

function sealUsage(usage: AgentCandidateFixedSpend): AgentCandidateFixedSpend {
  assertExactKeys(
    usage,
    [
      'costUsdNanos',
      'inputTokens',
      'outputTokens',
      'cachedInputTokens',
      'reasoningTokens',
      'modelCalls',
      'costProvenance',
    ],
    'candidate execution terminal usage',
  )
  for (const field of [
    'costUsdNanos',
    'inputTokens',
    'outputTokens',
    'cachedInputTokens',
    'reasoningTokens',
    'modelCalls',
  ] as const) {
    assertCount(usage[field], `terminal usage ${field}`)
  }
  if (usage.costProvenance !== 'observed' && usage.costProvenance !== 'estimated') {
    throw new Error('terminal usage costProvenance must be observed or estimated')
  }
  return Object.freeze({
    costUsdNanos: usage.costUsdNanos,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    reasoningTokens: usage.reasoningTokens,
    modelCalls: usage.modelCalls,
    costProvenance: usage.costProvenance,
  })
}

function sealArtifactRef(ref: AgentCandidateArtifactRef, label: string): AgentCandidateArtifactRef {
  const parsed = agentCandidateArtifactRefSchema.parse(ref)
  if (!Number.isSafeInteger(parsed.byteLength)) {
    throw new Error(`candidate execution terminal ${label} byteLength exceeds safe integer range`)
  }
  return immutableCandidateValue(parsed)
}

function requireArtifactRef(
  value: unknown,
  path: string,
  field: string,
): AgentCandidateArtifactRef {
  return requireObject(value, path, field) as unknown as AgentCandidateArtifactRef
}

function requireString(value: unknown, path: string, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`candidate execution record at ${path} has invalid ${field}`)
  }
  return value
}

function requireNumber(value: unknown, path: string, field: string): number {
  if (typeof value !== 'number') {
    throw new Error(`candidate execution record at ${path} has invalid ${field}`)
  }
  return value
}

function requireObject(value: unknown, path: string, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`candidate execution record at ${path} has invalid ${field}`)
  }
  return value as Record<string, unknown>
}

function requireTerminalStatus(
  value: unknown,
  path: string,
): AgentCandidateExecutionTerminalResult['status'] {
  if (value !== 'succeeded' && value !== 'failed') {
    throw new Error(`candidate execution terminal record at ${path} has invalid status`)
  }
  return value
}

function requireFailureClass(value: unknown, path: string): AgentCandidateExecutionFailureClass {
  try {
    assertFailureClass(value)
    return value
  } catch (error) {
    throw new Error(`candidate execution terminal record at ${path} has invalid failureClass`, {
      cause: error,
    })
  }
}

function assertFailureClass(value: unknown): asserts value is AgentCandidateExecutionFailureClass {
  if (
    value !== 'pre-model-infrastructure' &&
    value !== 'execution' &&
    value !== 'post-model-infrastructure' &&
    value !== 'unknown'
  ) {
    throw new Error('candidate execution failureClass is invalid')
  }
}

function assertExecutionId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(value)) {
    throw new Error('candidate execution claim executionId is invalid')
  }
}

function assertSha256Digest(value: string, field: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`candidate execution claim ${field} must be a lowercase sha256 digest`)
  }
}

function assertCount(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`candidate execution ${label} must be a non-negative safe integer`)
  }
}
