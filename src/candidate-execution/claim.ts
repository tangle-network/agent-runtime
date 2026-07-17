/** Durable one-shot lifecycle for candidate execution attempts. */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  type AgentCandidateArtifactRef,
  type AgentCandidateAttemptPolicy,
  type AgentCandidateFixedSpend,
  type AgentCandidateResolvedModel,
  agentCandidateResolvedModelSchema,
  type Sha256Digest,
} from '@tangle-network/agent-interface'
import {
  type AgentCandidatePreparationEvidence,
  type PersistedAgentCandidateExecutionClaim,
  type PersistedAgentCandidateExecutionPending,
  type PersistedAgentCandidateExecutionPhase,
  type PersistedAgentCandidateExecutionTerminal,
  sealCandidatePreparationEvidence,
} from './claim-file-formats'
import {
  assertRecoveryMatchesStaged,
  assertTerminalAllowedInPhase,
  assertTerminalMatchesClaim,
  recoveredTerminalRecord,
  rejectedFinish,
  rejectedStage,
  requireStagedTerminal,
  sealTerminalDigest,
  sealTerminalRecordValue,
  terminalRecord,
} from './claim-terminal'
import { candidateCleanupTimeout, candidateResultTimeout } from './cleanup'
import { canonicalCandidateDigest, immutableCandidateValue } from './digest'
import { assertExactObjectKeys as assertExactKeys } from './exact-object'

/** Non-secret identities a trusted recovery worker needs to close an abandoned attempt. */
export interface AgentCandidateExecutionCleanupHandles {
  readonly preparationId: string
  readonly modelGrantDigest: Sha256Digest
  readonly resolvedModel: AgentCandidateResolvedModel
  readonly traceRunId: string
  readonly cleanupTimeoutMs: number
  readonly memory?: {
    readonly accessDigest: Sha256Digest
    readonly effectiveNamespace: string
  }
}

/** Immutable signed identity stored for one execution attempt. */
export interface AgentCandidateExecutionClaim {
  readonly executionId: string
  readonly attempt: number
  readonly maxAttempts: number
  readonly retryPolicy: AgentCandidateAttemptPolicy['retryPolicy']
  readonly bundleDigest: Sha256Digest
  readonly executionPlanDigest: Sha256Digest
  /** Durable canonical bytes needed to reconstruct the signed preparation. */
  readonly preparationEvidence: AgentCandidatePreparationEvidence
  /** Frozen plan identity with only attempt number and per-attempt grant identity normalized. */
  readonly retryLineageDigest: Sha256Digest
  /** The winning lease stops authorizing a new terminal write at this instant. */
  readonly leaseExpiresAtMs: number
  /** Frozen budget for task verification, executable grading, and receipt construction. */
  readonly resultTimeoutMs: number
  /** Non-secret handles retained so an expired attempt can be closed and reconciled. */
  readonly cleanup: AgentCandidateExecutionCleanupHandles
}

/** Secret capability required to finish the acquired attempt. */
export interface AgentCandidateExecutionLease {
  readonly executionId: string
  readonly attempt: number
  readonly token: string
  readonly expiresAtMs: number
}

/** Only the first class is retryable, and only when the closed model ledger has zero calls. */
export type AgentCandidateExecutionFailureClass =
  | 'pre-model-infrastructure'
  | 'execution'
  | 'post-model-infrastructure'
  | 'unknown'

/** Evaluator-owned terminal facts staged durably before the terminal CAS. */
export type AgentCandidateExecutionTerminalResult =
  | {
      readonly status: 'succeeded'
      readonly usage: AgentCandidateFixedSpend
      readonly modelSettlement: AgentCandidateArtifactRef
      readonly taskOutcome: AgentCandidateArtifactRef
      readonly benchmarkResult: AgentCandidateArtifactRef
      readonly runReceipt: AgentCandidateArtifactRef
    }
  | {
      readonly status: 'failed'
      readonly failureClass: AgentCandidateExecutionFailureClass
      readonly usage: AgentCandidateFixedSpend
      readonly modelSettlement: AgentCandidateArtifactRef
      readonly failureEvidence?: AgentCandidateArtifactRef
    }

/** Durable terminal record for one acquired execution attempt. */
export type AgentCandidateExecutionTerminalRecord = AgentCandidateExecutionTerminalResult & {
  readonly executionId: string
  readonly attempt: number
  readonly bundleDigest: Sha256Digest
  readonly executionPlanDigest: Sha256Digest
  readonly preparationEvidence: AgentCandidateExecutionClaim['preparationEvidence']
  /** RFC 8785 SHA-256 of this record with `terminalDigest` omitted. */
  readonly terminalDigest: Sha256Digest
}

/** Monotonic durable phase: the second value means candidate code could have started. */
export type AgentCandidateExecutionPhase = 'claimed' | 'candidate-may-run'

/** Trusted, independently observed closure facts for one expired winning lease. */
export interface AgentCandidateExecutionRecoveryEvidence {
  readonly failureClass: AgentCandidateExecutionFailureClass
  readonly usage: AgentCandidateFixedSpend
  readonly modelSettlement: AgentCandidateArtifactRef
  readonly failureEvidence?: AgentCandidateArtifactRef
  readonly process: {
    readonly stopped: true
    readonly executionPlanDigest: Sha256Digest
  }
  readonly model: {
    readonly closed: true
    readonly preparationId: string
    readonly grantDigest: Sha256Digest
  }
  readonly memory?: {
    readonly closed: true
    readonly preparationId: string
    readonly accessDigest: Sha256Digest
    readonly effectiveNamespace: string
  }
}

export interface AgentCandidateExecutionAttemptRef {
  readonly executionId: string
  readonly attempt: number
}

/** Persisted state available to a fresh trusted recovery worker after a crash. */
export interface AgentCandidateExecutionAttemptRecord {
  readonly claim: AgentCandidateExecutionClaim
  readonly phase: AgentCandidateExecutionPhase
  /** Durable outbox content written before the terminal compare-and-set. */
  readonly staged?: AgentCandidateExecutionTerminalRecord
  readonly terminal?: AgentCandidateExecutionTerminalRecord
}

/** Result of atomically claiming one execution attempt. */
export type AgentCandidateExecutionClaimResult =
  | {
      readonly acquired: true
      readonly claim: AgentCandidateExecutionClaim
      readonly lease: AgentCandidateExecutionLease
    }
  | {
      readonly acquired: false
      readonly reason: 'already-claimed'
      /** The durable winner already occupying this execution-attempt slot. */
      readonly claim: AgentCandidateExecutionClaim
      /** True only when every signed claim field matches the durable winner. */
      readonly exactReplay: boolean
    }
  | {
      readonly acquired: false
      readonly reason: 'retry-not-eligible'
      readonly claim: AgentCandidateExecutionClaim
      readonly detail: AgentCandidateRetryRejection
    }

/** Result of atomically recording an attempt's terminal facts. */
export type AgentCandidateExecutionFinishResult =
  | {
      readonly finished: true
      readonly terminal: AgentCandidateExecutionTerminalRecord
    }
  | {
      readonly finished: false
      readonly terminal: AgentCandidateExecutionTerminalRecord
      /** True when a repeated finish supplied the same terminal digest. */
      readonly exactReplay: boolean
    }

/** Result of durably staging the one immutable terminal outbox entry. */
export type AgentCandidateExecutionStageResult =
  | {
      readonly staged: true
      readonly terminal: AgentCandidateExecutionTerminalRecord
    }
  | {
      readonly staged: false
      readonly terminal: AgentCandidateExecutionTerminalRecord
      readonly exactReplay: boolean
    }

/** Result of crossing the irreversible candidate-may-run boundary. */
export type AgentCandidateExecutionPhaseResult =
  | { readonly marked: true; readonly phase: 'candidate-may-run' }
  | { readonly marked: false; readonly phase: 'candidate-may-run' }

export type AgentCandidateRetryRejection =
  | 'prior-attempt-missing'
  | 'prior-attempt-running'
  | 'prior-attempt-succeeded'
  | 'prior-attempt-spent-model-calls'
  | 'prior-attempt-not-pre-model-infrastructure'
  | 'retry-lineage-mismatch'

/**
 * Atomic one-shot store for candidate execution attempts.
 *
 * Implementations must linearize both methods across every process sharing the
 * store. Terminal publication is deliberately two-step: `stageTerminal`
 * fsyncs the complete immutable outbox record, then `finish` publishes exactly
 * those staged bytes by digest. A crash between the two leaves recoverable
 * evidence rather than an ambiguous completed run.
 */
export interface AgentCandidateExecutionClaimStore {
  tryClaim(claim: AgentCandidateExecutionClaim): Promise<AgentCandidateExecutionClaimResult>
  getAttempt(
    attempt: AgentCandidateExecutionAttemptRef,
  ): Promise<AgentCandidateExecutionAttemptRecord | undefined>
  /** Persist the point after which candidate code may have run. */
  markCandidateMayRun(
    lease: AgentCandidateExecutionLease,
  ): Promise<AgentCandidateExecutionPhaseResult>
  /** Fsync the complete terminal record into the durable outbox. */
  stageTerminal(
    lease: AgentCandidateExecutionLease,
    result: AgentCandidateExecutionTerminalResult,
  ): Promise<AgentCandidateExecutionStageResult>
  /** Publish exactly the staged terminal identified by `terminalDigest`. */
  finish(
    lease: AgentCandidateExecutionLease,
    terminalDigest: Sha256Digest,
  ): Promise<AgentCandidateExecutionFinishResult>
  /**
   * Write a failed terminal only after the lease expired and a trusted worker
   * independently proved process death plus model and memory closure.
   */
  recoverExpired(
    attempt: AgentCandidateExecutionAttemptRef,
    evidence: AgentCandidateExecutionRecoveryEvidence,
  ): Promise<AgentCandidateExecutionFinishResult>
}

interface StoredClaim {
  claim: AgentCandidateExecutionClaim
  leaseDigest: Sha256Digest
  phase: AgentCandidateExecutionPhase
  staged?: AgentCandidateExecutionTerminalRecord
  terminal?: AgentCandidateExecutionTerminalRecord
}

function attemptRecord(
  claim: AgentCandidateExecutionClaim,
  phase: AgentCandidateExecutionPhase,
  staged?: AgentCandidateExecutionTerminalRecord,
  terminal?: AgentCandidateExecutionTerminalRecord,
): AgentCandidateExecutionAttemptRecord {
  return Object.freeze({
    claim,
    phase,
    ...(staged ? { staged } : {}),
    ...(terminal ? { terminal } : {}),
  })
}

export interface InMemoryAgentCandidateExecutionClaimStoreOptions {
  /** Testable evaluator clock; defaults to `Date.now`. */
  now?: () => number
}

/** Single-process lifecycle implementation. */
export class InMemoryAgentCandidateExecutionClaimStore
  implements AgentCandidateExecutionClaimStore
{
  private readonly claims = new Map<string, StoredClaim>()
  private readonly now: () => number

  constructor(options: InMemoryAgentCandidateExecutionClaimStoreOptions = {}) {
    this.now = options.now ?? Date.now
  }

  async tryClaim(
    requested: AgentCandidateExecutionClaim,
  ): Promise<AgentCandidateExecutionClaimResult> {
    const claim = sealClaim(requested)
    const slot = claimSlot(claim)
    const existing = this.claims.get(slot)
    if (existing) return rejectedExistingClaim(existing.claim, claim)
    assertUnexpiredLease(claim.leaseExpiresAtMs, this.now())

    const retryRejection = retryRejectionFromMemory(this.claims, claim)
    if (retryRejection) return rejectedRetry(claim, retryRejection)

    const lease = newLease(claim)
    // No await may occur between the read and write: this is the linearization
    // point for every caller sharing this store instance.
    this.claims.set(slot, {
      claim,
      leaseDigest: leaseDigest(lease),
      phase: 'claimed',
    })
    return Object.freeze({ acquired: true, claim, lease })
  }

  async getAttempt(
    requestedAttempt: AgentCandidateExecutionAttemptRef,
  ): Promise<AgentCandidateExecutionAttemptRecord | undefined> {
    const attempt = sealAttemptRef(requestedAttempt)
    const stored = this.claims.get(claimSlot(attempt))
    return stored
      ? attemptRecord(stored.claim, stored.phase, stored.staged, stored.terminal)
      : undefined
  }

  async markCandidateMayRun(
    requestedLease: AgentCandidateExecutionLease,
  ): Promise<AgentCandidateExecutionPhaseResult> {
    const lease = sealLease(requestedLease)
    const stored = this.requireClaim(lease)
    assertLease(stored.leaseDigest, stored.claim.leaseExpiresAtMs, lease)
    if (stored.phase === 'candidate-may-run') {
      return Object.freeze({ marked: false, phase: 'candidate-may-run' })
    }
    if (stored.staged || stored.terminal) {
      throw new Error('candidate execution terminal was staged before candidate-may-run phase')
    }
    assertUnexpiredLease(stored.claim.leaseExpiresAtMs, this.now())
    stored.phase = 'candidate-may-run'
    return Object.freeze({ marked: true, phase: 'candidate-may-run' })
  }

  async stageTerminal(
    requestedLease: AgentCandidateExecutionLease,
    result: AgentCandidateExecutionTerminalResult,
  ): Promise<AgentCandidateExecutionStageResult> {
    const lease = sealLease(requestedLease)
    const stored = this.requireClaim(lease)
    assertLease(stored.leaseDigest, stored.claim.leaseExpiresAtMs, lease)
    const terminal = terminalRecord(stored.claim, result)
    if (stored.staged) return rejectedStage(stored.staged, terminal)
    assertTerminalAllowedInPhase(stored.phase, terminal)
    assertUnexpiredLease(stored.claim.leaseExpiresAtMs, this.now())
    stored.staged = terminal
    return Object.freeze({ staged: true, terminal })
  }

  async finish(
    requestedLease: AgentCandidateExecutionLease,
    requestedTerminalDigest: Sha256Digest,
  ): Promise<AgentCandidateExecutionFinishResult> {
    const lease = sealLease(requestedLease)
    const terminalDigest = sealTerminalDigest(requestedTerminalDigest)
    const stored = this.requireClaim(lease)
    assertLease(stored.leaseDigest, stored.claim.leaseExpiresAtMs, lease)
    const staged = requireStagedTerminal(stored.staged, terminalDigest)
    if (stored.terminal) return rejectedFinish(stored.terminal, terminalDigest)
    assertUnexpiredLease(stored.claim.leaseExpiresAtMs, this.now())

    // The terminal assignment is the in-memory finish linearization point and
    // publishes the exact immutable object already present in the outbox.
    stored.terminal = staged
    return Object.freeze({ finished: true, terminal: staged })
  }

  async recoverExpired(
    requestedAttempt: AgentCandidateExecutionAttemptRef,
    evidence: AgentCandidateExecutionRecoveryEvidence,
  ): Promise<AgentCandidateExecutionFinishResult> {
    const attempt = sealAttemptRef(requestedAttempt)
    const stored = this.requireClaim(attempt, 'candidate execution recovery')
    const recovered = recoveredTerminalRecord(stored.claim, stored.phase, evidence)
    if (stored.staged) assertRecoveryMatchesStaged(stored.staged, recovered)
    const requestedDigest = stored.staged?.terminalDigest ?? recovered.terminalDigest
    if (stored.terminal) return rejectedFinish(stored.terminal, requestedDigest)
    assertExpiredLease(stored.claim.leaseExpiresAtMs, this.now())
    const terminal = stored.staged ?? recovered
    assertRecoveryMatchesStaged(terminal, recovered)
    stored.staged ??= terminal
    stored.terminal = terminal
    return Object.freeze({ finished: true, terminal })
  }

  private requireClaim(
    attempt: Pick<AgentCandidateExecutionLease, 'executionId' | 'attempt'>,
    operation = 'candidate execution lease',
  ): StoredClaim {
    const stored = this.claims.get(claimSlot(attempt))
    if (!stored) throw new Error(`${operation} does not name an acquired attempt`)
    return stored
  }
}

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/
const LEASE_TOKEN_PATTERN = /^candidate-execution-lease\.[A-Za-z0-9_-]{43}$/
const PREPARATION_ID_PATTERN = /^candidate-preparation\.[A-Za-z0-9_-]{43}$/

function sealClaim(claim: AgentCandidateExecutionClaim): AgentCandidateExecutionClaim {
  assertExactKeys(
    claim,
    [
      'executionId',
      'attempt',
      'maxAttempts',
      'retryPolicy',
      'bundleDigest',
      'executionPlanDigest',
      'preparationEvidence',
      'retryLineageDigest',
      'leaseExpiresAtMs',
      'resultTimeoutMs',
      'cleanup',
    ],
    'candidate execution claim',
  )
  assertExecutionId(claim.executionId)
  if (!Number.isSafeInteger(claim.attempt) || claim.attempt < 1) {
    throw new Error('candidate execution claim attempt must be a positive safe integer')
  }
  if (!Number.isSafeInteger(claim.maxAttempts) || claim.maxAttempts < 1) {
    throw new Error('candidate execution claim maxAttempts must be a positive safe integer')
  }
  if (claim.attempt > claim.maxAttempts) {
    throw new Error('candidate execution claim attempt exceeds maxAttempts')
  }
  if (!['none', 'pre-model-infrastructure-only'].includes(claim.retryPolicy)) {
    throw new Error('candidate execution claim retryPolicy is invalid')
  }
  if (claim.retryPolicy === 'none' && claim.maxAttempts !== 1) {
    throw new Error('candidate execution claim retryPolicy none requires maxAttempts 1')
  }
  assertSha256Digest(claim.bundleDigest, 'bundleDigest')
  assertSha256Digest(claim.executionPlanDigest, 'executionPlanDigest')
  const preparationEvidence = sealCandidatePreparationEvidence(
    claim.preparationEvidence,
    claim.executionPlanDigest,
  )
  assertSha256Digest(claim.retryLineageDigest, 'retryLineageDigest')
  assertPositiveTimestamp(claim.leaseExpiresAtMs, 'leaseExpiresAtMs')
  candidateResultTimeout(claim.resultTimeoutMs, claim.resultTimeoutMs)
  const cleanup = sealCleanupHandles(claim.cleanup)
  return Object.freeze({
    executionId: claim.executionId,
    attempt: claim.attempt,
    maxAttempts: claim.maxAttempts,
    retryPolicy: claim.retryPolicy,
    bundleDigest: claim.bundleDigest,
    executionPlanDigest: claim.executionPlanDigest,
    preparationEvidence,
    retryLineageDigest: claim.retryLineageDigest,
    leaseExpiresAtMs: claim.leaseExpiresAtMs,
    resultTimeoutMs: claim.resultTimeoutMs,
    cleanup,
  })
}

function sealCleanupHandles(
  cleanup: AgentCandidateExecutionCleanupHandles,
): AgentCandidateExecutionCleanupHandles {
  assertExactKeys(
    cleanup,
    cleanup.memory
      ? [
          'preparationId',
          'modelGrantDigest',
          'resolvedModel',
          'traceRunId',
          'cleanupTimeoutMs',
          'memory',
        ]
      : ['preparationId', 'modelGrantDigest', 'resolvedModel', 'traceRunId', 'cleanupTimeoutMs'],
    'candidate execution cleanup handles',
  )
  if (!PREPARATION_ID_PATTERN.test(cleanup.preparationId)) {
    throw new Error('candidate execution cleanup preparationId is invalid')
  }
  assertSha256Digest(cleanup.modelGrantDigest, 'cleanup modelGrantDigest')
  const resolvedModel = immutableCandidateValue(
    agentCandidateResolvedModelSchema.parse(cleanup.resolvedModel),
  )
  assertBoundedIdentifier(cleanup.traceRunId, 'cleanup traceRunId', 512)
  const cleanupTimeoutMs = candidateCleanupTimeout(cleanup.cleanupTimeoutMs)
  const memory = cleanup.memory ? sealMemoryCleanupHandle(cleanup.memory) : undefined
  return Object.freeze({
    preparationId: cleanup.preparationId,
    modelGrantDigest: cleanup.modelGrantDigest,
    resolvedModel,
    traceRunId: cleanup.traceRunId,
    cleanupTimeoutMs,
    ...(memory ? { memory } : {}),
  })
}

function sealMemoryCleanupHandle(
  memory: NonNullable<AgentCandidateExecutionCleanupHandles['memory']>,
): NonNullable<AgentCandidateExecutionCleanupHandles['memory']> {
  assertExactKeys(
    memory,
    ['accessDigest', 'effectiveNamespace'],
    'candidate execution memory cleanup handle',
  )
  assertSha256Digest(memory.accessDigest, 'memory accessDigest')
  assertBoundedIdentifier(memory.effectiveNamespace, 'memory effectiveNamespace', 1_024)
  return Object.freeze({
    accessDigest: memory.accessDigest,
    effectiveNamespace: memory.effectiveNamespace,
  })
}

function sealAttemptRef(
  attempt: AgentCandidateExecutionAttemptRef,
): AgentCandidateExecutionAttemptRef {
  assertExactKeys(attempt, ['executionId', 'attempt'], 'candidate execution attempt reference')
  assertExecutionId(attempt.executionId)
  if (!Number.isSafeInteger(attempt.attempt) || attempt.attempt < 1) {
    throw new Error('candidate execution attempt reference must have a positive safe attempt')
  }
  return Object.freeze({ executionId: attempt.executionId, attempt: attempt.attempt })
}

function sealLease(lease: AgentCandidateExecutionLease): AgentCandidateExecutionLease {
  assertExactKeys(
    lease,
    ['executionId', 'attempt', 'token', 'expiresAtMs'],
    'candidate execution lease',
  )
  if (lease.executionId.length === 0 || !Number.isSafeInteger(lease.attempt) || lease.attempt < 1) {
    throw new Error('candidate execution lease identity is invalid')
  }
  if (!LEASE_TOKEN_PATTERN.test(lease.token)) {
    throw new Error('candidate execution lease token is invalid')
  }
  assertPositiveTimestamp(lease.expiresAtMs, 'lease expiresAtMs')
  return Object.freeze({
    executionId: lease.executionId,
    attempt: lease.attempt,
    token: lease.token,
    expiresAtMs: lease.expiresAtMs,
  })
}

function newLease(claim: AgentCandidateExecutionClaim): AgentCandidateExecutionLease {
  return Object.freeze({
    executionId: claim.executionId,
    attempt: claim.attempt,
    token: `candidate-execution-lease.${randomBytes(32).toString('base64url')}`,
    expiresAtMs: claim.leaseExpiresAtMs,
  })
}

function leaseDigest(lease: AgentCandidateExecutionLease): Sha256Digest {
  return sha256(lease.token)
}

function assertLease(
  expectedDigest: Sha256Digest,
  expectedExpiresAtMs: number,
  lease: AgentCandidateExecutionLease,
): void {
  const expected = Buffer.from(expectedDigest)
  const actual = Buffer.from(leaseDigest(lease))
  if (
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual) ||
    lease.expiresAtMs !== expectedExpiresAtMs
  ) {
    throw new Error('candidate execution lease is invalid')
  }
}

function claimSlot(claim: Pick<AgentCandidateExecutionClaim, 'executionId' | 'attempt'>): string {
  return createHash('sha256')
    .update(JSON.stringify([claim.executionId, claim.attempt]), 'utf8')
    .digest('hex')
}

function retryRejectionFromMemory(
  claims: ReadonlyMap<string, StoredClaim>,
  claim: AgentCandidateExecutionClaim,
): AgentCandidateRetryRejection | undefined {
  if (claim.attempt === 1) return undefined
  const prior = claims.get(
    claimSlot({ executionId: claim.executionId, attempt: claim.attempt - 1 }),
  )
  return retryRejection(claim, prior)
}

function retryRejection(
  claim: AgentCandidateExecutionClaim,
  prior:
    | {
        claim: AgentCandidateExecutionClaim
        terminal?: AgentCandidateExecutionTerminalRecord
      }
    | undefined,
): AgentCandidateRetryRejection | undefined {
  if (!prior) return 'prior-attempt-missing'
  if (
    claim.retryPolicy !== 'pre-model-infrastructure-only' ||
    prior.claim.retryPolicy !== claim.retryPolicy ||
    prior.claim.maxAttempts !== claim.maxAttempts ||
    prior.claim.bundleDigest !== claim.bundleDigest ||
    prior.claim.retryLineageDigest !== claim.retryLineageDigest
  ) {
    return 'retry-lineage-mismatch'
  }
  if (!prior.terminal) return 'prior-attempt-running'
  if (prior.terminal.status === 'succeeded') return 'prior-attempt-succeeded'
  if (prior.terminal.usage.modelCalls !== 0) return 'prior-attempt-spent-model-calls'
  if (prior.terminal.failureClass !== 'pre-model-infrastructure') {
    return 'prior-attempt-not-pre-model-infrastructure'
  }
  return undefined
}

function rejectedExistingClaim(
  existing: AgentCandidateExecutionClaim,
  requested: AgentCandidateExecutionClaim,
): AgentCandidateExecutionClaimResult {
  return Object.freeze({
    acquired: false,
    reason: 'already-claimed',
    claim: existing,
    exactReplay: canonicalCandidateDigest(existing) === canonicalCandidateDigest(requested),
  })
}

function rejectedRetry(
  claim: AgentCandidateExecutionClaim,
  detail: AgentCandidateRetryRejection,
): AgentCandidateExecutionClaimResult {
  return Object.freeze({ acquired: false, reason: 'retry-not-eligible', claim, detail })
}

async function readClaim(path: string): Promise<StoredClaim> {
  const parsed = await readJsonObject(path, 'claim')
  const record = parsed as Partial<PersistedAgentCandidateExecutionClaim>
  assertExactKeys(
    parsed,
    [
      'executionId',
      'attempt',
      'maxAttempts',
      'retryPolicy',
      'bundleDigest',
      'executionPlanDigest',
      'preparationEvidence',
      'retryLineageDigest',
      'leaseExpiresAtMs',
      'resultTimeoutMs',
      'cleanup',
      'phase',
      'leaseDigest',
    ],
    `candidate execution claim at ${path}`,
  )
  const claim = sealClaim({
    executionId: requireString(record.executionId, path, 'executionId'),
    attempt: requireNumber(record.attempt, path, 'attempt'),
    maxAttempts: requireNumber(record.maxAttempts, path, 'maxAttempts'),
    retryPolicy: requireRetryPolicy(record.retryPolicy, path),
    bundleDigest: requireString(record.bundleDigest, path, 'bundleDigest') as Sha256Digest,
    executionPlanDigest: requireString(
      record.executionPlanDigest,
      path,
      'executionPlanDigest',
    ) as Sha256Digest,
    preparationEvidence: requireObject(
      record.preparationEvidence,
      path,
      'preparationEvidence',
    ) as unknown as AgentCandidateExecutionClaim['preparationEvidence'],
    retryLineageDigest: requireString(
      record.retryLineageDigest,
      path,
      'retryLineageDigest',
    ) as Sha256Digest,
    leaseExpiresAtMs: requireNumber(record.leaseExpiresAtMs, path, 'leaseExpiresAtMs'),
    resultTimeoutMs: requireNumber(record.resultTimeoutMs, path, 'resultTimeoutMs'),
    cleanup: requireObject(
      record.cleanup,
      path,
      'cleanup',
    ) as unknown as AgentCandidateExecutionCleanupHandles,
  })
  const persistedLeaseDigest = requireString(
    record.leaseDigest,
    path,
    'leaseDigest',
  ) as Sha256Digest
  assertSha256Digest(persistedLeaseDigest, 'leaseDigest')
  if (record.phase !== 'claimed') {
    throw new Error(`candidate execution claim at ${path} has invalid initial phase`)
  }
  return { claim, leaseDigest: persistedLeaseDigest, phase: 'claimed' }
}

async function readClaimIfPresent(path: string): Promise<StoredClaim | undefined> {
  try {
    return await readClaim(path)
  } catch (error) {
    if (isMissingError(error)) return undefined
    throw error
  }
}

async function readTerminal(path: string): Promise<AgentCandidateExecutionTerminalRecord> {
  const parsed = await readJsonObject(path, 'terminal record')
  const record = parsed as Partial<PersistedAgentCandidateExecutionTerminal>
  assertExactKeys(parsed, ['terminal'], `candidate execution terminal record at ${path}`)
  return sealTerminalRecordValue(
    requireObject(record.terminal, path, 'terminal'),
    `candidate execution terminal record at ${path}`,
  )
}

async function readTerminalIfPresent(
  path: string,
): Promise<AgentCandidateExecutionTerminalRecord | undefined> {
  try {
    return await readTerminal(path)
  } catch (error) {
    if (isMissingError(error)) return undefined
    throw error
  }
}

type ReadCandidateExecutionTransition =
  | { kind: 'phase' }
  | { kind: 'pending'; terminal: AgentCandidateExecutionTerminalRecord }

async function readTransitionIfPresent(
  path: string,
  claim: AgentCandidateExecutionClaim,
): Promise<ReadCandidateExecutionTransition | undefined> {
  let parsed: Record<string, unknown>
  try {
    parsed = await readJsonObject(path, 'transition record')
  } catch (error) {
    if (isMissingError(error)) return undefined
    throw error
  }
  if (parsed.kind === 'candidate-execution-phase') {
    const record = parsed as unknown as PersistedAgentCandidateExecutionPhase
    assertExactKeys(
      parsed,
      ['kind', 'executionId', 'attempt', 'executionPlanDigest', 'phase'],
      `candidate execution phase record at ${path}`,
    )
    if (
      record.executionId !== claim.executionId ||
      record.attempt !== claim.attempt ||
      record.executionPlanDigest !== claim.executionPlanDigest ||
      record.phase !== 'candidate-may-run'
    ) {
      throw new Error(`candidate execution phase record at ${path} does not match its claim`)
    }
    return { kind: 'phase' }
  }
  if (parsed.kind === 'candidate-execution-pending-terminal') {
    const record = parsed as unknown as PersistedAgentCandidateExecutionPending
    assertExactKeys(parsed, ['kind', 'terminal'], `candidate execution pending record at ${path}`)
    const terminal = sealTerminalRecordValue(
      requireObject(record.terminal, path, 'terminal'),
      `candidate execution pending record at ${path}`,
    )
    assertTerminalMatchesClaim(terminal, claim, path)
    return { kind: 'pending', terminal }
  }
  throw new Error(`candidate execution transition record at ${path} has invalid kind`)
}

async function readJsonObject(path: string, kind: string): Promise<Record<string, unknown>> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (isMissingError(error)) throw error
    throw new Error(`candidate execution ${kind} at ${path} is unreadable`, { cause: error })
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`candidate execution ${kind} at ${path} is not an object`)
  }
  return parsed as Record<string, unknown>
}

function assertSameSlot(
  existing: Pick<AgentCandidateExecutionClaim, 'executionId' | 'attempt'>,
  requested: Pick<AgentCandidateExecutionClaim, 'executionId' | 'attempt'>,
  path: string,
): void {
  if (existing.executionId !== requested.executionId || existing.attempt !== requested.attempt) {
    throw new Error(`candidate execution record at ${path} does not match its claim slot`)
  }
}

function assertSha256Digest(value: string, field: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`candidate execution claim ${field} must be a lowercase sha256 digest`)
  }
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

function requireRetryPolicy(
  value: unknown,
  path: string,
): AgentCandidateAttemptPolicy['retryPolicy'] {
  if (value !== 'none' && value !== 'pre-model-infrastructure-only') {
    throw new Error(`candidate execution record at ${path} has invalid retryPolicy`)
  }
  return value
}

function assertExecutionId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(value)) {
    throw new Error('candidate execution claim executionId is invalid')
  }
}

function assertBoundedIdentifier(
  value: unknown,
  label: string,
  maxLength: number,
): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength ||
    hasControlCharacter(value)
  ) {
    throw new Error(`candidate execution ${label} is invalid`)
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

function assertPositiveTimestamp(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`candidate execution ${label} must be a positive safe timestamp`)
  }
}

function assertClock(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('candidate execution claim-store clock returned an invalid timestamp')
  }
}

function assertUnexpiredLease(expiresAtMs: number, nowMs: number): void {
  assertClock(nowMs)
  if (nowMs >= expiresAtMs) throw new Error('candidate execution lease has expired')
}

function assertExpiredLease(expiresAtMs: number, nowMs: number): void {
  assertClock(nowMs)
  if (nowMs < expiresAtMs) throw new Error('candidate execution lease has not expired')
}

function sha256(value: string): Sha256Digest {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`
}

function isMissingError(error: unknown): boolean {
  return isNodeError(error, 'ENOENT')
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  )
}

export const candidateClaimFileInternals = Object.freeze({
  assertExpiredLease,
  assertLease,
  assertSameSlot,
  assertUnexpiredLease,
  attemptRecord,
  claimSlot,
  leaseDigest,
  newLease,
  readClaim,
  readClaimIfPresent,
  readTerminal,
  readTerminalIfPresent,
  readTransitionIfPresent,
  rejectedExistingClaim,
  rejectedRetry,
  retryRejection,
  sealAttemptRef,
  sealClaim,
  sealLease,
})

export { candidateExecutionClaim } from './claim-plan'
