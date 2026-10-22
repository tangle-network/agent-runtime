import type { TraceStore } from '@tangle-network/agent-eval'
import { errorMessage } from '../runtime/util'
import type {
  AgentCandidateExecutionClaim,
  AgentCandidateExecutionClaimStore,
  AgentCandidateExecutionFailureClass,
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
import {
  type ActivatedAccess,
  closeMemoryAccess,
  type ExecutionRun,
  failBeforeActivation,
  failClaimedExecution,
  finishClaim,
  joinErrors,
  protectedEnvironmentValues,
  settleModelGrant,
} from './execute-cleanup'
import { type ExecutorOutcome, runAndStopExecutor } from './execute-executor'
import { candidatePostRunWindowMs, candidateTerminalWindowMs } from './execution-window'
import { failedAgentCandidateRun, finalizeAgentCandidateRun } from './finalize'
import {
  appendAuthoritativeModelSettlementSpans,
  type SealedAgentCandidateModelSettlement,
} from './model-settlement'
import {
  type PersistedAgentCandidateModelSettlement,
  persistCandidateBenchmarkResult,
  persistCandidateModelSettlement,
  persistFailureEvidence,
  persistVerifiedAgentCandidateExecutorCapture,
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
import { createProtectedAgentCandidateTraceAccess } from './protected-trace-store'
import type {
  AgentCandidateBenchmarkGraderPort,
  AgentCandidateExecutorPort,
  AgentCandidateExecutorRequest,
  AgentCandidateOutputArtifactPort,
  AgentCandidateProtectedModelActivation,
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

/** A phase's outcome: its value, or the final result that ends the execution. */
type Step<T> = { ok: true; value: T } | { ok: false; result: AgentCandidateRunFinalization }

type AcquiredClaim = Extract<
  Awaited<ReturnType<AgentCandidateExecutionClaimStore['tryClaim']>>,
  { acquired: true }
>

interface ClaimedExecution {
  readonly acquired: AcquiredClaim
  /** The task deadline recovered from the claim's lease. */
  readonly deadlineAtMs: number
}

interface LaunchableCandidate extends ActivatedAccess {
  readonly activation: AgentCandidateProtectedModelActivation
  readonly request: AgentCandidateExecutorRequest
}

/** An executor run whose process is stopped and whose protected access is closed and settled. */
interface SettledExecution {
  readonly execution: ExecutorOutcome
  readonly settlement: SealedAgentCandidateModelSettlement
  readonly protectedValues: string[]
  readonly persistedTrace: ReturnType<
    ReturnType<typeof createProtectedAgentCandidateTraceAccess>['identity']
  >
  readonly protectedTrace: ReturnType<typeof createProtectedAgentCandidateTraceAccess>
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
  const run: ExecutionRun = {
    prepared,
    state,
    claimStore: options.claimStore,
    outputArtifacts: options.outputArtifacts,
    cleanupTimeoutMs,
    resultTimeoutMs,
  }

  const claimed = await claimExecution(run, options)
  if (!claimed.ok) return claimed.result
  const launchable = await activateAccess(run, claimed.value)
  if (!launchable.ok) return launchable.result
  const settled = await runAndSettle(run, options, claimed.value, launchable.value)
  if (!settled.ok) return settled.result

  const { execution, settlement } = settled.value
  let modelSettlement: PersistedAgentCandidateModelSettlement
  try {
    modelSettlement = await withinCandidateCleanupDeadline(
      () => persistCandidateModelSettlement(state, settlement, options.outputArtifacts),
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
        settled.value.protectedValues,
      ),
      execution.termination,
      settlement.usage,
    )
  }

  const result = await finalizeEvidence(run, options, claimed.value, settled.value, modelSettlement)
  return recordTerminal(run, claimed.value, settled.value, modelSettlement, result)
}

/** Stage and publish the attempt's terminal record, then consume the prepared execution. */
async function recordTerminal(
  run: ExecutionRun,
  claimed: ClaimedExecution,
  settled: SettledExecution,
  modelSettlement: PersistedAgentCandidateModelSettlement,
  result: AgentCandidateRunFinalization,
): Promise<AgentCandidateRunFinalization> {
  const { prepared, state } = run
  const { execution, settlement } = settled
  const { lease } = claimed.acquired
  const failureClass: AgentCandidateExecutionFailureClass =
    execution.kind === 'error' ? 'execution' : 'post-model-infrastructure'
  let terminal: AgentCandidateExecutionTerminalResult
  try {
    terminal = result.succeeded
      ? {
          status: 'succeeded',
          usage: settlement.usage,
          modelSettlement: result.artifacts.modelSettlement,
          taskOutcome: result.artifacts.taskOutcome,
          benchmarkResult: result.artifacts.benchmarkResult,
          runReceipt: result.artifacts.runReceipt,
        }
      : {
          status: 'failed',
          failureClass,
          usage: settlement.usage,
          modelSettlement: modelSettlement.artifact,
          failureEvidence: await withinCandidateCleanupDeadline(
            () =>
              persistFailureEvidence(
                state,
                result.reason,
                failureClass,
                execution.termination,
                run.outputArtifacts,
              ),
            lease.expiresAtMs,
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
        settled.protectedValues,
      ),
      execution.termination,
      settlement.usage,
    )
  }

  const finished = await finishClaim(run.claimStore, lease, terminal, lease.expiresAtMs)
  if (finished) {
    consumePreparedCandidateExecution(prepared, result.succeeded ? 'succeeded' : 'failed')
    return result
  }

  consumePreparedCandidateExecution(prepared, 'failed')
  return failedAgentCandidateRun(
    state,
    'candidate execution terminal record could not be persisted',
    execution.termination,
    settlement.usage,
  )
}

/** Persist the plan and receipt, claim the attempt, and check the claim covers the run. */
async function claimExecution(
  run: ExecutionRun,
  options: ExecutePreparedAgentCandidateOptions,
): Promise<Step<ClaimedExecution>> {
  const { prepared, state, cleanupTimeoutMs, resultTimeoutMs } = run
  try {
    // Mutable staging is only a preparation check. The executor receives the
    // detached file bytes sealed in private state, never these host paths.
    await assertPreparedCandidateWorkspaces(state)
  } catch (error) {
    return { ok: false, result: await failBeforeActivation(run, error, 'failed') }
  }

  let preparationEvidence: AgentCandidateExecutionClaim['preparationEvidence']
  try {
    const [executionPlan, materializationReceipt] = await Promise.all([
      persistCandidateOutputArtifact(options.outputArtifacts, {
        executionId: state.executionId,
        purpose: 'execution-plan',
        bytes: state.executionPlan.bytes,
      }),
      persistCandidateOutputArtifact(options.outputArtifacts, {
        executionId: state.executionId,
        purpose: 'materialization-receipt',
        bytes: state.materializationReceipt.bytes,
      }),
    ])
    preparationEvidence = Object.freeze({ executionPlan, materializationReceipt })
  } catch (error) {
    return { ok: false, result: await failBeforeActivation(run, error, 'failed') }
  }

  let acquired: Awaited<ReturnType<AgentCandidateExecutionClaimStore['tryClaim']>>
  try {
    acquired = await options.claimStore.tryClaim(
      candidateExecutionClaim(prepared, preparationEvidence),
    )
  } catch (error) {
    return { ok: false, result: await failBeforeActivation(run, error, 'failed') }
  }
  if (!acquired.acquired) {
    return {
      ok: false,
      result: await failBeforeActivation(
        run,
        new Error(
          acquired.reason === 'retry-not-eligible'
            ? `candidate execution retry is not eligible: ${acquired.detail}`
            : 'candidate execution attempt is already claimed',
        ),
        'replayed',
      ),
    }
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
    return {
      ok: false,
      result: await failClaimedExecution(
        run,
        acquired.lease,
        new Error('candidate claim no longer covers its full execution and cleanup window'),
        'pre-model-infrastructure',
      ),
    }
  }
  return { ok: true, value: { acquired, deadlineAtMs } }
}

/** Activate model and memory access, build the executor request, and persist that it may run. */
async function activateAccess(
  run: ExecutionRun,
  claimed: ClaimedExecution,
): Promise<Step<LaunchableCandidate>> {
  const { prepared, state, cleanupTimeoutMs } = run
  const { acquired, deadlineAtMs } = claimed
  const fail = async (
    error: unknown,
    failureClass: AgentCandidateExecutionFailureClass,
    access?: ActivatedAccess,
  ): Promise<Step<never>> => ({
    ok: false,
    result: await failClaimedExecution(run, acquired.lease, error, failureClass, access),
  })

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
    return fail(
      new Error('protected model activation failed', { cause: error }),
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
      return fail(
        new Error('isolated memory activation failed', { cause: error }),
        'pre-model-infrastructure',
        { activation },
      )
    }
  }
  const access = { activation, memoryActivation }

  let request: AgentCandidateExecutorRequest
  try {
    request = beginPreparedCandidateRun(prepared, activation, memoryActivation).request
  } catch (error) {
    return fail(error, 'pre-model-infrastructure', access)
  }

  try {
    const phase = await run.claimStore.markCandidateMayRun(acquired.lease)
    if (phase.phase !== 'candidate-may-run') {
      throw new Error('candidate claim did not persist the candidate-may-run phase')
    }
  } catch (error) {
    return fail(
      new Error('candidate execution phase persistence failed', { cause: error }),
      'pre-model-infrastructure',
      access,
    )
  }
  if (Date.now() >= deadlineAtMs) {
    return fail(
      new Error('candidate execution deadline elapsed while persisting its launch phase'),
      'unknown',
      access,
    )
  }
  return { ok: true, value: { ...access, request } }
}

/** Run the executor, prove its process stopped, and close and settle the protected access. */
async function runAndSettle(
  run: ExecutionRun,
  options: ExecutePreparedAgentCandidateOptions,
  claimed: ClaimedExecution,
  launchable: LaunchableCandidate,
): Promise<Step<SettledExecution>> {
  const { prepared, state, cleanupTimeoutMs } = run
  const protectedValues = protectedEnvironmentValues(
    launchable.activation,
    launchable.memoryActivation,
  )
  const protectedTrace = createProtectedAgentCandidateTraceAccess(
    options.traceStore,
    protectedValues,
  )
  const persistedTrace = protectedTrace.identity(state.trace)
  const execution = await runAndStopExecutor(
    options.executor,
    launchable.request,
    state.benchmarkTask.outcome,
    protectedTrace.store,
    claimed.deadlineAtMs,
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
  const traceClosure = withinCandidateCleanupDeadline(
    () => protectedTrace.closeWrites(),
    cleanupDeadlineAtMs,
    'candidate trace write closure',
  ).then(
    () => ({ closed: true as const, error: undefined }),
    (error: unknown) => ({ closed: false as const, error }),
  )
  const [traceClose, memoryClose, settlementResult] = await Promise.all([
    traceClosure,
    closeMemoryAccess(state, accessReason, cleanupDeadlineAtMs),
    settleModelGrant(state, accessReason, cleanupDeadlineAtMs),
  ])
  if (
    !execution.processStopped ||
    !traceClose.closed ||
    !settlementResult.settlement ||
    !memoryClose.closed
  ) {
    consumePreparedCandidateExecution(prepared, 'failed')
    return {
      ok: false,
      result: failedAgentCandidateRun(
        state,
        redactProtectedReason(
          joinErrors(
            execution.error,
            !execution.processStopped
              ? new Error('candidate process termination is not proven')
              : undefined,
            traceClose.error,
            memoryClose.error,
            settlementResult.error ??
              (!settlementResult.settlement ? new Error('model settlement failed') : undefined),
            new Error('candidate claim remains recoverable until protected cleanup is proven'),
          ),
          protectedValues,
        ),
        execution.termination,
        settlementResult.settlement?.usage ?? null,
      ),
    }
  }
  return {
    ok: true,
    value: {
      execution,
      settlement: settlementResult.settlement,
      protectedValues,
      persistedTrace,
      protectedTrace,
    },
  }
}

/** Verify and grade the captured evidence into the run's result; a failure is a failed run. */
async function finalizeEvidence(
  run: ExecutionRun,
  options: ExecutePreparedAgentCandidateOptions,
  claimed: ClaimedExecution,
  settled: SettledExecution,
  modelSettlement: PersistedAgentCandidateModelSettlement,
): Promise<AgentCandidateRunFinalization> {
  const { state, cleanupTimeoutMs, resultTimeoutMs } = run
  const { execution, settlement, protectedValues, persistedTrace, protectedTrace } = settled
  if (execution.kind === 'error') {
    return failedAgentCandidateRun(
      state,
      redactProtectedReason(errorMessage(execution.error), protectedValues),
      execution.termination,
      settlement.usage,
    )
  }
  if (!execution.finalCapture.taskOutcome) {
    return failedAgentCandidateRun(
      state,
      'candidate executor stopped without a captured task outcome',
      execution.termination,
      settlement.usage,
    )
  }
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
      claimed.acquired.lease.expiresAtMs - candidateTerminalWindowMs(cleanupTimeoutMs),
    )
    return await withinCandidateResultDeadline(
      async (signal) => {
        await appendAuthoritativeModelSettlementSpans(
          options.traceStore,
          persistedTrace.runId,
          settlement,
        )
        const { persistedCapture, taskOutcome } =
          await persistVerifiedAgentCandidateExecutorCapture(
            state,
            execution.finalCapture,
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
          persistedTrace,
          settlement,
          {
            finalCapture: execution.finalCapture,
            persistedCapture,
            modelSettlement,
            taskOutcome,
            benchmarkResult,
            outputArtifacts: options.outputArtifacts,
          },
          protectedValues,
          protectedTrace.report(),
          signal,
        )
      },
      resultDeadlineAtMs,
      'candidate evidence finalization',
    )
  } catch (error) {
    return failedAgentCandidateRun(
      state,
      redactProtectedReason(errorMessage(error), protectedValues),
      execution.termination,
      settlement.usage,
    )
  }
}
