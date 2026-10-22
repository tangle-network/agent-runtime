/**
 * Failure and cleanup paths of an execution: closing isolated memory, settling the model grant,
 * recording a failed attempt's terminal result, and reporting why a run failed.
 */

import { errorMessage } from '../runtime/util'
import type {
  AgentCandidateExecutionClaimStore,
  AgentCandidateExecutionFailureClass,
  AgentCandidateExecutionLease,
  AgentCandidateExecutionTerminalResult,
} from './claim'
import { candidateCleanupDeadline, withinCandidateCleanupDeadline } from './cleanup'
import { failedAgentCandidateRun } from './finalize'
import {
  type SealedAgentCandidateModelSettlement,
  sealAgentCandidateModelSettlement,
} from './model-settlement'
import { persistCandidateModelSettlement, persistFailureEvidence } from './outcome-evidence'
import {
  beginPreparedCandidateSettlement,
  consumePreparedCandidateExecution,
  type PreparedCandidateState,
} from './prepared-state'
import { redactProtectedReason } from './protected-redaction'
import type {
  AgentCandidateOutputArtifactPort,
  AgentCandidateProtectedModelActivation,
  AgentCandidateRunFinalization,
  PreparedAgentCandidateExecution,
} from './types'

/** What every phase of one execution reads. */
export interface ExecutionRun {
  readonly prepared: PreparedAgentCandidateExecution
  readonly state: PreparedCandidateState
  readonly claimStore: AgentCandidateExecutionClaimStore
  readonly outputArtifacts: AgentCandidateOutputArtifactPort
  readonly cleanupTimeoutMs: number
  readonly resultTimeoutMs: number
}

/** The protected access a run activated, in the order it was activated. */
export interface ActivatedAccess {
  readonly activation?: AgentCandidateProtectedModelActivation
  readonly memoryActivation?: { env: Readonly<Record<string, string>> }
}

export async function failBeforeActivation(
  run: ExecutionRun,
  error: unknown,
  reason: 'failed' | 'replayed',
): Promise<AgentCandidateRunFinalization> {
  const { prepared, state } = run
  beginPreparedCandidateSettlement(prepared)
  const cleanupDeadlineAtMs = candidateCleanupDeadline(run.cleanupTimeoutMs)
  const [memoryClose, settled] = await Promise.all([
    closeMemoryAccess(state, reason, cleanupDeadlineAtMs),
    settleModelGrant(state, reason, cleanupDeadlineAtMs),
  ])
  const cleanupProven = memoryClose.closed && settled.settlement !== undefined
  consumePreparedCandidateExecution(prepared, cleanupProven ? 'failed' : 'cleanup-failed')
  return failedAgentCandidateRun(
    state,
    redactProtectedReason(
      joinErrors(
        error,
        memoryClose.error,
        settled.error,
        !cleanupProven
          ? new Error('prepared access cleanup remains incomplete and may be retried by disposal')
          : undefined,
      ),
      [],
    ),
    undefined,
    settled.settlement?.usage ?? null,
  )
}

/** Fail a claimed attempt before the candidate may run: clean up, then record the failure. */
export async function failClaimedExecution(
  run: ExecutionRun,
  lease: AgentCandidateExecutionLease,
  error: unknown,
  failureClass: AgentCandidateExecutionFailureClass,
  access: ActivatedAccess = {},
): Promise<AgentCandidateRunFinalization> {
  const { prepared, state, claimStore, outputArtifacts } = run
  beginPreparedCandidateSettlement(prepared)
  const cleanupDeadlineAtMs = candidateCleanupDeadline(run.cleanupTimeoutMs)
  const [memoryClose, settled] = await Promise.all([
    closeMemoryAccess(state, 'failed', cleanupDeadlineAtMs),
    settleModelGrant(state, 'failed', cleanupDeadlineAtMs),
  ])
  const protectedValues = protectedEnvironmentValues(access.activation, access.memoryActivation)
  const safeReason = redactProtectedReason(
    joinErrors(error, memoryClose.error, settled.error),
    protectedValues,
  )
  let finishFailed = false
  let persistenceFailure: unknown
  if (settled.settlement && memoryClose.closed) {
    try {
      const modelSettlement = await withinCandidateCleanupDeadline(
        () => persistCandidateModelSettlement(state, settled.settlement!, outputArtifacts),
        lease.expiresAtMs,
        'candidate pre-run model-settlement persistence',
      )
      const failureEvidence = await withinCandidateCleanupDeadline(
        () => persistFailureEvidence(state, safeReason, failureClass, undefined, outputArtifacts),
        lease.expiresAtMs,
        'candidate pre-run failure-evidence persistence',
      )
      finishFailed = !(await finishClaim(
        claimStore,
        lease,
        {
          status: 'failed',
          failureClass,
          usage: settled.settlement.usage,
          modelSettlement: modelSettlement.artifact,
          failureEvidence,
        },
        lease.expiresAtMs,
      ))
    } catch (persistenceError) {
      finishFailed = true
      persistenceFailure = persistenceError
    }
  }
  consumePreparedCandidateExecution(prepared, 'failed')
  return failedAgentCandidateRun(
    state,
    redactProtectedReason(
      joinErrors(
        safeReason,
        persistenceFailure,
        memoryClose.error,
        settled.error,
        !memoryClose.closed || !settled.settlement
          ? new Error('candidate claim remains recoverable until protected cleanup is proven')
          : undefined,
        finishFailed
          ? new Error('candidate execution terminal record could not be persisted')
          : undefined,
      ),
      protectedValues,
    ),
    undefined,
    settled.settlement?.usage ?? null,
  )
}

export async function closeMemoryAccess(
  state: PreparedCandidateState,
  reason: 'completed' | 'failed' | 'timeout' | 'replayed',
  cleanupDeadlineAtMs: number,
): Promise<{ closed: true; error?: undefined } | { closed: false; error: unknown }> {
  if (state.memory.mode === 'disabled') return { closed: true }
  try {
    const reservation = state.memoryReservation
    if (!reservation) throw new Error('isolated memory reservation is missing')
    const closed = await withinCandidateCleanupDeadline(
      () =>
        state.ports.memory.close({
          executionId: state.executionId,
          preparationId: reservation.preparationId,
          accessDigest: reservation.accessDigest,
          effectiveNamespace: reservation.effectiveNamespace,
          reason,
        }),
      cleanupDeadlineAtMs,
      'isolated memory closure',
    )
    if (closed.closed !== true || Object.keys(closed).some((key) => key !== 'closed')) {
      throw new Error('isolated memory access did not acknowledge closure')
    }
    return { closed: true }
  } catch (error) {
    return { closed: false, error }
  }
}

export async function settleModelGrant(
  state: PreparedCandidateState,
  reason: 'completed' | 'failed' | 'timeout' | 'replayed',
  cleanupDeadlineAtMs: number,
): Promise<{
  settlement?: SealedAgentCandidateModelSettlement
  error?: unknown
}> {
  try {
    const value = await withinCandidateCleanupDeadline(
      () =>
        state.ports.models.settleGrant({
          executionId: state.executionId,
          preparationId: state.preparationId,
          grantDigest: state.modelReservation.digest,
          resolved: state.resolvedModel,
          reason,
        }),
      cleanupDeadlineAtMs,
      'protected model settlement',
    )
    return {
      settlement: sealAgentCandidateModelSettlement(value, {
        preparationId: state.preparationId,
        grantDigest: state.modelReservation.digest,
        model: state.resolvedModel.model,
      }),
    }
  } catch (error) {
    return { error: new Error('protected model settlement failed', { cause: error }) }
  }
}

export async function finishClaim(
  store: AgentCandidateExecutionClaimStore,
  lease: AgentCandidateExecutionLease,
  terminal: AgentCandidateExecutionTerminalResult,
  deadlineAtMs?: number,
): Promise<boolean> {
  try {
    const staged = await withinCandidateCleanupDeadline(
      () => store.stageTerminal(lease, terminal),
      deadlineAtMs ?? lease.expiresAtMs,
      'candidate terminal staging',
    )
    if (!staged.staged && !staged.exactReplay) return false
    const result = await withinCandidateCleanupDeadline(
      () => store.finish(lease, staged.terminal.terminalDigest),
      deadlineAtMs ?? lease.expiresAtMs,
      'candidate terminal publication',
    )
    return result.finished || result.exactReplay
  } catch {
    return false
  }
}

export function protectedEnvironmentValues(
  activation?: AgentCandidateProtectedModelActivation,
  memoryActivation?: { env: Readonly<Record<string, string>> },
): string[] {
  return [...Object.values(activation?.env ?? {}), ...Object.values(memoryActivation?.env ?? {})]
}

export function joinErrors(...errors: unknown[]): string {
  return errors
    .filter((error) => error !== undefined)
    .map(errorMessage)
    .join('; ')
}
