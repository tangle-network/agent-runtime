import type { TraceStore } from '@tangle-network/agent-eval'
import type { AgentCandidateTermination } from '@tangle-network/agent-interface'

import type {
  AgentCandidateExecutionClaimStore,
  AgentCandidateExecutionFailureClass,
  AgentCandidateExecutionLease,
  AgentCandidateExecutionTerminalResult,
} from './claim'
import { candidateExecutionClaim } from './claim-plan'
import {
  candidateCleanupDeadline,
  candidateCleanupTimeout,
  candidateResultTimeout,
  withinCandidateCleanupDeadline,
  withinCandidateResultDeadline,
} from './cleanup'
import { canonicalCandidateBytes } from './digest'
import { candidatePostRunWindowMs, candidateTerminalWindowMs } from './execution-window'
import {
  sealAgentCandidateExecutorFinalCapture,
  sealAgentCandidateProtectedRunCapture,
} from './executor-capture'
import { failedAgentCandidateRun, finalizeAgentCandidateRun } from './finalize'
import {
  type SealedAgentCandidateModelSettlement,
  sealAgentCandidateModelSettlement,
} from './model-settlement'
import {
  type PersistedAgentCandidateModelSettlement,
  persistCandidateBenchmarkResult,
  persistCandidateModelSettlement,
  persistVerifiedCandidateTaskOutcome,
} from './outcome-evidence'
import { persistCandidateOutputArtifact } from './output-artifacts'
import {
  assertPreparedCandidateIntegrity,
  assertPreparedCandidateWorkspaces,
  beginPreparedCandidateClaim,
  beginPreparedCandidateRun,
  beginPreparedCandidateSettlement,
  consumePreparedCandidateExecution,
  markPreparedCandidateClaimed,
  type PreparedCandidateState,
} from './prepared-state'
import { redactProtectedReason } from './protected-redaction'
import { ProtectedAgentCandidateTraceStore } from './protected-trace-store'
import type {
  AgentCandidateBenchmarkGraderPort,
  AgentCandidateExecutorFinalCapture,
  AgentCandidateExecutorPort,
  AgentCandidateExecutorRequest,
  AgentCandidateOutputArtifactPort,
  AgentCandidateProtectedModelActivation,
  AgentCandidateProtectedRunCapture,
  AgentCandidateRunFinalization,
  PreparedAgentCandidateExecution,
} from './types'

export interface ExecutePreparedAgentCandidateOptions {
  executor: AgentCandidateExecutorPort
  grader: AgentCandidateBenchmarkGraderPort
  outputArtifacts: AgentCandidateOutputArtifactPort
  traceStore: TraceStore
  /** Long-lived evaluator-owned store shared by every process that can run this benchmark. */
  claimStore: AgentCandidateExecutionClaimStore
  /** Maximum time to prove process death and revoke protected access after a run ends. */
  cleanupTimeoutMs?: number
  /** Maximum time for task verification, executable grading, and receipt construction. */
  resultTimeoutMs?: number
}

/** Executes and finalizes one durably claimed candidate without exposing an unproven result. */
export async function executePreparedAgentCandidate(
  prepared: PreparedAgentCandidateExecution,
  options: ExecutePreparedAgentCandidateOptions,
): Promise<AgentCandidateRunFinalization> {
  const initialState = assertPreparedCandidateIntegrity(prepared)
  const cleanupTimeoutMs = candidateCleanupTimeout(
    options.cleanupTimeoutMs ?? initialState.cleanupTimeoutMs,
  )
  if (cleanupTimeoutMs > initialState.cleanupTimeoutMs) {
    throw new Error('execution cleanup timeout exceeds the frozen preparation bound')
  }
  const resultTimeoutMs = candidateResultTimeout(
    options.resultTimeoutMs ?? initialState.resultTimeoutMs,
    initialState.resultTimeoutMs,
  )
  if (resultTimeoutMs > initialState.resultTimeoutMs) {
    throw new Error('execution result timeout exceeds the frozen preparation bound')
  }
  let state: PreparedCandidateState
  try {
    state = beginPreparedCandidateClaim(prepared)
  } catch (error) {
    return failedAgentCandidateRun(initialState, errorMessage(error))
  }

  try {
    // Mutable staging is only a preparation check. The executor receives the
    // detached file bytes sealed in private state, never these host paths.
    await assertPreparedCandidateWorkspaces(state)
  } catch (error) {
    return await failBeforeActivation(prepared, state, error, 'failed', cleanupTimeoutMs)
  }

  let acquired: Awaited<ReturnType<AgentCandidateExecutionClaimStore['tryClaim']>>
  try {
    acquired = await options.claimStore.tryClaim(candidateExecutionClaim(prepared))
  } catch (error) {
    return await failBeforeActivation(prepared, state, error, 'failed', cleanupTimeoutMs)
  }
  if (!acquired.acquired) {
    return await failBeforeActivation(
      prepared,
      state,
      new Error(
        acquired.reason === 'retry-not-eligible'
          ? `candidate execution retry is not eligible: ${acquired.detail}`
          : 'candidate execution attempt is already claimed',
      ),
      'replayed',
      cleanupTimeoutMs,
    )
  }

  markPreparedCandidateClaimed(prepared)
  const postRunWindowMs = candidatePostRunWindowMs(cleanupTimeoutMs, resultTimeoutMs)
  // A caller may shorten cleanup for this invocation, but that must never buy
  // the candidate more execution time. The claim was frozen with the prepared
  // cleanup window, so recover the original task deadline from that value.
  const deadlineAtMs =
    acquired.claim.leaseExpiresAtMs -
    candidatePostRunWindowMs(state.cleanupTimeoutMs, state.resultTimeoutMs)
  const requiredLeaseExpiry = deadlineAtMs + postRunWindowMs
  if (
    Date.now() >= deadlineAtMs ||
    deadlineAtMs > state.reservationExpiresAtMs ||
    requiredLeaseExpiry > acquired.lease.expiresAtMs
  ) {
    return await failClaimedExecution(
      prepared,
      state,
      acquired.lease,
      options.claimStore,
      options.outputArtifacts,
      new Error('candidate claim no longer covers its full execution and cleanup window'),
      'failed',
      cleanupTimeoutMs,
      'pre-model-infrastructure',
    )
  }
  let activation: AgentCandidateProtectedModelActivation
  try {
    const activated = await withinCandidateCleanupDeadline(
      () =>
        state.ports.models.activateGrant({
          executionId: state.executionId,
          preparationId: state.preparationId,
          grantDigest: state.modelReservation.digest,
          resolved: state.resolvedModel,
          deadlineAtMs,
        }),
      Math.min(deadlineAtMs, candidateCleanupDeadline(cleanupTimeoutMs)),
      'protected model activation',
    )
    activation = Object.freeze({ env: Object.freeze({ ...activated.env }) })
  } catch (error) {
    return await failClaimedExecution(
      prepared,
      state,
      acquired.lease,
      options.claimStore,
      options.outputArtifacts,
      new Error('protected model activation failed', { cause: error }),
      'failed',
      cleanupTimeoutMs,
      'pre-model-infrastructure',
    )
  }

  let memoryActivation: { env: Readonly<Record<string, string>> } | undefined
  if (state.memory.mode === 'isolated') {
    try {
      const reservation = state.memoryReservation
      if (!reservation) throw new Error('isolated memory reservation is missing')
      const activated = await withinCandidateCleanupDeadline(
        () =>
          state.ports.memory.activate({
            executionId: state.executionId,
            preparationId: reservation.preparationId,
            accessDigest: reservation.accessDigest,
            effectiveNamespace: reservation.effectiveNamespace,
            deadlineAtMs,
          }),
        Math.min(deadlineAtMs, candidateCleanupDeadline(cleanupTimeoutMs)),
        'isolated memory activation',
      )
      memoryActivation = Object.freeze({ env: Object.freeze({ ...activated.env }) })
    } catch (error) {
      return await failClaimedExecution(
        prepared,
        state,
        acquired.lease,
        options.claimStore,
        options.outputArtifacts,
        new Error('isolated memory activation failed', { cause: error }),
        'failed',
        cleanupTimeoutMs,
        'pre-model-infrastructure',
        activation,
      )
    }
  }

  let request: AgentCandidateExecutorRequest
  try {
    request = beginPreparedCandidateRun(prepared, activation, memoryActivation).request
  } catch (error) {
    return await failClaimedExecution(
      prepared,
      state,
      acquired.lease,
      options.claimStore,
      options.outputArtifacts,
      error,
      'failed',
      cleanupTimeoutMs,
      'pre-model-infrastructure',
      activation,
      memoryActivation,
    )
  }

  try {
    const phase = await options.claimStore.markCandidateMayRun(acquired.lease)
    if (phase.phase !== 'candidate-may-run') {
      throw new Error('candidate claim did not persist the candidate-may-run phase')
    }
  } catch (error) {
    return await failClaimedExecution(
      prepared,
      state,
      acquired.lease,
      options.claimStore,
      options.outputArtifacts,
      new Error('candidate execution phase persistence failed', { cause: error }),
      'failed',
      cleanupTimeoutMs,
      'pre-model-infrastructure',
      activation,
      memoryActivation,
    )
  }
  if (Date.now() >= deadlineAtMs) {
    return await failClaimedExecution(
      prepared,
      state,
      acquired.lease,
      options.claimStore,
      options.outputArtifacts,
      new Error('candidate execution deadline elapsed while persisting its launch phase'),
      'failed',
      cleanupTimeoutMs,
      'unknown',
      activation,
      memoryActivation,
    )
  }

  const protectedValues = protectedEnvironmentValues(activation, memoryActivation)
  const protectedTraceStore = new ProtectedAgentCandidateTraceStore(
    options.traceStore,
    protectedValues,
  )
  const execution = await runAndStopExecutor(
    options.executor,
    request,
    protectedTraceStore,
    deadlineAtMs,
    cleanupTimeoutMs,
  )
  beginPreparedCandidateSettlement(prepared)
  const cleanupDeadlineAtMs = candidateCleanupDeadline(cleanupTimeoutMs)

  const accessReason =
    execution.kind === 'timeout' || execution.termination?.kind === 'timeout'
      ? 'timeout'
      : execution.kind === 'capture'
        ? 'completed'
        : 'failed'
  const [memoryClose, settlementResult] = await Promise.all([
    closeMemoryAccess(state, accessReason, cleanupDeadlineAtMs),
    settleModelGrant(state, accessReason, cleanupDeadlineAtMs),
  ])
  if (!execution.processStopped || !settlementResult.settlement || !memoryClose.closed) {
    consumePreparedCandidateExecution(prepared, 'failed')
    return failedAgentCandidateRun(
      state,
      redactProtectedReason(
        joinErrors(
          execution.error,
          !execution.processStopped
            ? new Error('candidate process termination is not proven')
            : undefined,
          memoryClose.error,
          settlementResult.error ??
            (!settlementResult.settlement ? new Error('model settlement failed') : undefined),
          new Error('candidate claim remains recoverable until protected cleanup is proven'),
        ),
        protectedValues,
      ),
      execution.termination,
      settlementResult.settlement?.usage ?? null,
    )
  }

  let modelSettlement: PersistedAgentCandidateModelSettlement
  try {
    modelSettlement = await withinCandidateCleanupDeadline(
      () =>
        persistCandidateModelSettlement(
          state,
          settlementResult.settlement as SealedAgentCandidateModelSettlement,
          options.outputArtifacts,
        ),
      candidateCleanupDeadline(cleanupTimeoutMs),
      'candidate model settlement persistence',
    )
  } catch (error) {
    consumePreparedCandidateExecution(prepared, 'failed')
    return failedAgentCandidateRun(
      state,
      redactProtectedReason(
        joinErrors(
          error,
          new Error('candidate claim remains recoverable until settlement evidence is durable'),
        ),
        protectedValues,
      ),
      execution.termination,
      settlementResult.settlement.usage,
    )
  }

  let result: AgentCandidateRunFinalization
  const failureClass: AgentCandidateExecutionFailureClass =
    execution.kind === 'error' ? 'execution' : 'post-model-infrastructure'
  if (execution.kind === 'error') {
    result = failedAgentCandidateRun(
      state,
      redactProtectedReason(errorMessage(execution.error), protectedValues),
      execution.termination,
      settlementResult.settlement.usage,
    )
  } else if (!execution.finalCapture.taskOutcome) {
    result = failedAgentCandidateRun(
      state,
      'candidate executor stopped without a captured task outcome',
      execution.termination,
      settlementResult.settlement.usage,
    )
  } else {
    const capture =
      execution.kind === 'capture'
        ? execution.capture
        : {
            executionId: state.executionId,
            termination: execution.termination,
          }
    try {
      const resultDeadlineAtMs = Math.min(
        Date.now() + resultTimeoutMs,
        acquired.lease.expiresAtMs - candidateTerminalWindowMs(cleanupTimeoutMs),
      )
      result = await withinCandidateResultDeadline(
        async (signal) => {
          const taskOutcome = await persistVerifiedCandidateTaskOutcome(
            state,
            execution.finalCapture.taskOutcome!,
            options.outputArtifacts,
            protectedValues,
            signal,
          )
          const benchmarkResult = await persistCandidateBenchmarkResult(
            state,
            capture.termination,
            taskOutcome,
            options.grader,
            options.outputArtifacts,
            protectedValues,
            signal,
          )
          return await finalizeAgentCandidateRun(
            state,
            capture,
            options.traceStore,
            settlementResult.settlement as SealedAgentCandidateModelSettlement,
            {
              finalCapture: execution.finalCapture,
              modelSettlement,
              taskOutcome,
              benchmarkResult,
              outputArtifacts: options.outputArtifacts,
            },
            protectedValues,
            protectedTraceStore.report(),
            signal,
          )
        },
        resultDeadlineAtMs,
        'candidate evidence finalization',
      )
    } catch (error) {
      result = failedAgentCandidateRun(
        state,
        redactProtectedReason(errorMessage(error), protectedValues),
        execution.termination,
        settlementResult.settlement.usage,
      )
    }
  }

  let terminal: AgentCandidateExecutionTerminalResult
  try {
    terminal = result.succeeded
      ? {
          schemaVersion: 1,
          status: 'succeeded',
          usage: settlementResult.settlement.fixedUsage,
          modelSettlement: result.artifacts.modelSettlement,
          taskOutcome: result.artifacts.taskOutcome,
          benchmarkResult: result.artifacts.benchmarkResult,
          runReceipt: result.artifacts.runReceipt,
        }
      : {
          schemaVersion: 1,
          status: 'failed',
          failureClass,
          usage: settlementResult.settlement.fixedUsage,
          modelSettlement: modelSettlement.artifact,
          failureEvidence: await withinCandidateCleanupDeadline(
            () =>
              persistFailureEvidence(
                state,
                result.reason,
                failureClass,
                execution.termination,
                options.outputArtifacts,
              ),
            acquired.lease.expiresAtMs,
            'candidate failure-evidence persistence',
          ),
        }
  } catch (error) {
    consumePreparedCandidateExecution(prepared, 'failed')
    return failedAgentCandidateRun(
      state,
      redactProtectedReason(
        joinErrors(
          error,
          new Error('candidate claim remains recoverable until terminal evidence is durable'),
        ),
        protectedValues,
      ),
      execution.termination,
      settlementResult.settlement.usage,
    )
  }

  const finished = await finishClaim(
    options.claimStore,
    acquired.lease,
    terminal,
    acquired.lease.expiresAtMs,
  )
  if (finished) {
    consumePreparedCandidateExecution(prepared, result.succeeded ? 'succeeded' : 'failed')
    return result
  }

  consumePreparedCandidateExecution(prepared, 'failed')
  return failedAgentCandidateRun(
    state,
    'candidate execution terminal record could not be persisted',
    execution.termination,
    settlementResult.settlement.usage,
  )
}

type ExecutorOutcome =
  | {
      kind: 'capture'
      capture: AgentCandidateProtectedRunCapture
      termination: AgentCandidateTermination
      finalCapture: AgentCandidateExecutorFinalCapture
      processStopped: true
      error?: undefined
    }
  | {
      kind: 'timeout'
      termination: AgentCandidateTermination & { kind: 'timeout' }
      finalCapture: AgentCandidateExecutorFinalCapture
      processStopped: true
      error?: undefined
    }
  | {
      kind: 'error'
      error: unknown
      termination?: AgentCandidateTermination
      finalCapture?: AgentCandidateExecutorFinalCapture
      processStopped: boolean
    }

async function runAndStopExecutor(
  executor: AgentCandidateExecutorPort,
  request: AgentCandidateExecutorRequest,
  traceStore: TraceStore,
  deadlineAtMs: number,
  cleanupTimeoutMs: number,
): Promise<ExecutorOutcome> {
  const timeoutMs = request.hardLimits.timeoutMs
  const timeoutError = new CandidateExecutionDeadlineError(timeoutMs)
  if (Date.now() >= deadlineAtMs) {
    return {
      kind: 'error',
      error: timeoutError,
      termination: { kind: 'timeout', timeoutMs },
      processStopped: true,
    }
  }
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  let capture: AgentCandidateProtectedRunCapture | undefined
  let executionError: unknown
  const executionPromise = Promise.resolve().then(() =>
    executor.execute(request, {
      traceStore,
      signal: controller.signal,
      deadlineAtMs,
    }),
  )
  // A stopped process may still leave a buggy adapter promise pending. Attach a
  // terminal handler now so the deadline path cannot create an unhandled rejection.
  void executionPromise.catch(() => undefined)
  const deadlinePromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => {
        timedOut = true
        controller.abort(timeoutError)
        reject(timeoutError)
      },
      Math.max(0, deadlineAtMs - Date.now()),
    )
  })
  void deadlinePromise.catch(() => undefined)
  try {
    capture = sealAgentCandidateProtectedRunCapture(
      await Promise.race([executionPromise, deadlinePromise]),
    )
  } catch (error) {
    executionError = error
  }

  if (!timedOut && capture && capture.executionId !== request.executionId) {
    executionError = new Error('candidate execution capture id does not match the request')
    capture = undefined
  } else if (!timedOut && capture && Date.now() >= deadlineAtMs) {
    timedOut = true
    executionError = timeoutError
    capture = undefined
  } else if (!timedOut && capture?.termination.kind === 'timeout') {
    executionError = new Error('candidate executor cannot declare the runtime-owned timeout')
    capture = undefined
  }

  if (!capture || timedOut) controller.abort(executionError)
  const stopReason = timedOut ? 'timeout' : capture ? 'completed' : 'failed'
  let stopped: unknown
  try {
    stopped = await withinCandidateCleanupDeadline(
      () =>
        executor.stopAndCapture(
          {
            executionId: request.executionId,
            executionPlanDigest: request.executionPlan.value.digest,
          },
          {
            traceStore,
            reason: stopReason,
            signal: controller.signal,
            deadlineAtMs,
          },
        ),
      Date.now() + cleanupTimeoutMs,
      'candidate process termination',
    )
    if (
      !stopped ||
      typeof stopped !== 'object' ||
      (stopped as { stopped?: unknown }).stopped !== true
    ) {
      throw new Error('candidate executor did not acknowledge exact process termination')
    }
  } catch (stopError) {
    if (timer) clearTimeout(timer)
    controller.abort(stopError)
    return {
      kind: 'error',
      error: new Error(joinErrors(executionError, stopError)),
      ...(timedOut ? { termination: { kind: 'timeout', timeoutMs } } : {}),
      processStopped: false,
    }
  }

  let finalCapture: AgentCandidateExecutorFinalCapture
  try {
    finalCapture = sealAgentCandidateExecutorFinalCapture(stopped)
  } catch (captureError) {
    if (timer) clearTimeout(timer)
    controller.abort(captureError)
    return {
      kind: 'error',
      error: new Error(joinErrors(executionError, captureError)),
      ...(timedOut ? { termination: { kind: 'timeout', timeoutMs } } : {}),
      processStopped: true,
    }
  }

  if (Date.now() >= deadlineAtMs) {
    timedOut = true
    executionError = timeoutError
    capture = undefined
    controller.abort(timeoutError)
  }
  if (timer) clearTimeout(timer)

  if (timedOut) {
    return {
      kind: 'timeout',
      termination: { kind: 'timeout', timeoutMs },
      finalCapture,
      processStopped: true,
    }
  }
  if (executionError || !capture) {
    return {
      kind: 'error',
      error: executionError ?? new Error('candidate executor returned no capture'),
      finalCapture,
      processStopped: true,
    }
  }
  return {
    kind: 'capture',
    capture,
    termination: capture.termination,
    finalCapture,
    processStopped: true,
  }
}

async function failBeforeActivation(
  prepared: PreparedAgentCandidateExecution,
  state: PreparedCandidateState,
  error: unknown,
  reason: 'failed' | 'replayed',
  cleanupTimeoutMs: number,
): Promise<AgentCandidateRunFinalization> {
  beginPreparedCandidateSettlement(prepared)
  const cleanupDeadlineAtMs = candidateCleanupDeadline(cleanupTimeoutMs)
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

async function failClaimedExecution(
  prepared: PreparedAgentCandidateExecution,
  state: PreparedCandidateState,
  lease: AgentCandidateExecutionLease,
  claimStore: AgentCandidateExecutionClaimStore,
  outputArtifacts: AgentCandidateOutputArtifactPort,
  error: unknown,
  reason: 'failed',
  cleanupTimeoutMs: number,
  failureClass: AgentCandidateExecutionFailureClass,
  activation?: AgentCandidateProtectedModelActivation,
  memoryActivation?: { env: Readonly<Record<string, string>> },
): Promise<AgentCandidateRunFinalization> {
  beginPreparedCandidateSettlement(prepared)
  const cleanupDeadlineAtMs = candidateCleanupDeadline(cleanupTimeoutMs)
  const [memoryClose, settled] = await Promise.all([
    closeMemoryAccess(state, reason, cleanupDeadlineAtMs),
    settleModelGrant(state, reason, cleanupDeadlineAtMs),
  ])
  const protectedValues = protectedEnvironmentValues(activation, memoryActivation)
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
          schemaVersion: 1,
          status: 'failed',
          failureClass,
          usage: settled.settlement.fixedUsage,
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

async function closeMemoryAccess(
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

async function settleModelGrant(
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

async function finishClaim(
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

async function persistFailureEvidence(
  state: PreparedCandidateState,
  reason: string,
  failureClass: AgentCandidateExecutionFailureClass,
  termination: AgentCandidateTermination | undefined,
  outputArtifacts: AgentCandidateOutputArtifactPort,
) {
  const bytes = canonicalCandidateBytes({
    schemaVersion: 1,
    kind: 'agent-candidate-execution-failure',
    executionId: state.executionId,
    bundleDigest: state.bundle.digest,
    executionPlanDigest: state.executionPlan.value.digest,
    failureClass,
    reason,
    ...(termination ? { termination } : {}),
  })
  return await persistCandidateOutputArtifact(outputArtifacts, {
    executionId: state.executionId,
    purpose: 'failure-evidence',
    bytes,
  })
}

function protectedEnvironmentValues(
  activation?: AgentCandidateProtectedModelActivation,
  memoryActivation?: { env: Readonly<Record<string, string>> },
): string[] {
  return [...Object.values(activation?.env ?? {}), ...Object.values(memoryActivation?.env ?? {})]
}

function joinErrors(...errors: unknown[]): string {
  return errors
    .filter((error) => error !== undefined)
    .map(errorMessage)
    .join('; ')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

class CandidateExecutionDeadlineError extends Error {
  constructor(timeoutMs: number) {
    super(`candidate execution reached its frozen ${timeoutMs}ms deadline`)
    this.name = 'CandidateExecutionDeadlineError'
  }
}
